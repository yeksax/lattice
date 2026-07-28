package main

// sync.go - keeping one conversation in two stores.
//
// A summary that was never shared is a private document: its threads and its
// page state live in the sidecars comments.go and state.go own, and nobody else
// can see them. Sharing it adds a second audience with its own store - readers
// write into the hosted backend's D1, because that is the only place a public
// snapshot can write to. Two stores, one document.
//
// So the daemon double-writes. Everything the dashboard saves for a shared
// summary is written locally first (the filesystem stays the source of truth,
// and it is the copy that survives being offline, logged out, or unshared) and
// then pushed to the backend. Reads merge both sides.
//
// The dedupe key is the id this machine already mints for every row. It rides
// along as `signature`, the backend stores it, and a row that comes back
// carrying a signature we recognise is not a second comment - it is our own,
// seen from the other side. That is what keeps a push retry, a re-read, or a
// summary that was commented on from both places from counting twice.
//
// What is deliberately one-way: a thread born on the hosted side (a reader's
// comment) stays there. It shows up in the merge and can be replied to, but it
// is not copied into the local file - a public reader's words are not this
// machine's to own, and a second copy would be the fork this file exists to
// prevent.

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const (
	// How long a slug's share binding is trusted before asking the backend
	// again. Short enough that `lattice share` from a terminal starts feeding
	// the double write almost immediately, long enough that a page polling its
	// state does not turn into a listing request per poll.
	shareBindingTTL = 15 * time.Second

	// How long a hosted read is reused. The dashboard polls state on a timer
	// and re-lists threads after every write; without this each of those would
	// be a round trip to the backend for an answer that cannot have changed.
	hostedReadTTL = 5 * time.Second
)

// --- which summaries have a second home --------------------------------------

var (
	bindingMu      sync.Mutex
	bindingCache   map[string]string // slug -> public subdomain
	bindingChecked time.Time
	bindingFlight  bool
)

func bindingsPath() string { return filepath.Join(summariesDir(), ".lattice", "shared.json") }

// sharedSlug reports whether a summary is published, and under which subdomain.
//
// The answer is mirrored to disk because being logged out or offline is not an
// answer: a summary shared yesterday still has readers writing into D1 today,
// and a daemon that boots without a network must not conclude "not shared" and
// quietly start a second, invisible conversation.
func sharedSlug(slug string) (string, bool) {
	refreshBindings(false)
	bindingMu.Lock()
	defer bindingMu.Unlock()
	loadBindingsLocked()
	sub, ok := bindingCache[slug]
	return sub, ok
}

// syncedSlug is the question every read and write below actually asks: does
// this summary have a second store, can we reach it, and does it speak the
// protocol that keeps the two copies from multiplying?
func syncedSlug(slug, feature string) bool {
	if _, shared := sharedSlug(slug); !shared {
		return false
	}
	c := loadConfig()
	// Logged out: the binding stands - the hosted copy is still out there, and
	// forking it would be worse than being briefly out of date - but there is
	// nothing to read it with until the token comes back.
	return c.Hosted.Token != "" && hostedCan(c, feature)
}

func loadBindingsLocked() {
	if bindingCache != nil {
		return
	}
	bindingCache = map[string]string{}
	b, err := os.ReadFile(bindingsPath())
	if err != nil {
		return
	}
	var out map[string]string
	if json.Unmarshal(b, &out) == nil && out != nil {
		bindingCache = out
	}
}

// refreshBindings re-reads the share listing. The first check of a daemon's
// life blocks - there is nothing else to answer with - and every later one runs
// in the background, so a stale binding costs a request its freshness, never
// its latency.
func refreshBindings(force bool) {
	c := loadConfig()
	if c.Hosted.Token == "" {
		return
	}
	bindingMu.Lock()
	loadBindingsLocked()
	cold := bindingChecked.IsZero()
	if bindingFlight || (!force && !cold && time.Since(bindingChecked) < shareBindingTTL) {
		bindingMu.Unlock()
		return
	}
	bindingFlight = true
	// Stamped before the call, not after: a backend that is down must back off
	// for the TTL like a successful one, or every request pays its timeout.
	bindingChecked = time.Now()
	bindingMu.Unlock()

	fetch := func() {
		shares, err := hostedList(c)
		bindingMu.Lock()
		bindingFlight = false
		if err == nil {
			next := map[string]string{}
			for _, share := range shares {
				sub := share.Sub
				if sub == "" {
					sub = share.Slug
				}
				next[share.Slug] = sub
			}
			bindingCache = next
			writeBindings(next)
		}
		bindingMu.Unlock()
	}
	if cold || force {
		fetch()
		return
	}
	go fetch()
}

func writeBindings(m map[string]string) {
	dir := filepath.Dir(bindingsPath())
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return
	}
	tmp, err := os.CreateTemp(dir, "shared-*.tmp")
	if err != nil {
		return
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return
	}
	if tmp.Close() != nil {
		return
	}
	os.Rename(name, bindingsPath())
}

// --- what the backend can do --------------------------------------------------

// The double write only works against a backend that stores dedupe signatures.
// Pushing into one that does not would create a fresh row on every read, so a
// daemon newer than its Worker degrades to the local-only behaviour instead -
// loudly, once, rather than by quietly growing a copy of every comment.
var (
	capabilityMu      sync.Mutex
	capabilitySet     map[string]bool
	capabilityChecked time.Time
	capabilityAnswer  bool // the last probe reached the backend
	capabilityWarned  bool
)

const (
	capabilityTTL      = 5 * time.Minute
	capabilityRetryTTL = 30 * time.Second // the backend was unreachable
)

func hostedCan(c Config, feature string) bool {
	capabilityMu.Lock()
	defer capabilityMu.Unlock()
	ttl := capabilityTTL
	if !capabilityAnswer {
		// Nothing answered last time. That is a laptop on a train, not an old
		// deployment, and the outbox should flush as soon as the network is
		// back rather than at the end of a five-minute window.
		ttl = capabilityRetryTTL
	}
	if capabilitySet == nil || time.Since(capabilityChecked) > ttl {
		capabilityChecked = time.Now()
		capabilitySet = map[string]bool{}
		resp, err := apiClient().Get(c.resolvedAPIBase() + "/health")
		capabilityAnswer = err == nil
		if err == nil {
			var out struct {
				Capabilities []string `json:"capabilities"`
			}
			json.NewDecoder(resp.Body).Decode(&out)
			resp.Body.Close()
			for _, name := range out.Capabilities {
				capabilitySet[name] = true
			}
		}
	}
	if capabilitySet[feature] {
		return true
	}
	// Only a backend that answered and still lacks the feature is worth saying
	// out loud - an unreachable one says nothing about what it can do.
	if capabilityAnswer && !capabilityWarned {
		capabilityWarned = true
		log.Printf("sync: %s is missing %q - comments and state stay local until the current Worker is deployed",
			c.resolvedAPIBase(), feature)
	}
	return false
}

// --- cached hosted reads ------------------------------------------------------

type hostedCache[T any] struct {
	mu    sync.Mutex
	value map[string]struct {
		data T
		at   time.Time
	}
}

func (h *hostedCache[T]) get(slug string) (T, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	entry, ok := h.value[slug]
	if !ok || time.Since(entry.at) > hostedReadTTL {
		var zero T
		return zero, false
	}
	return entry.data, true
}

func (h *hostedCache[T]) put(slug string, data T) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.value == nil {
		h.value = map[string]struct {
			data T
			at   time.Time
		}{}
	}
	h.value[slug] = struct {
		data T
		at   time.Time
	}{data: data, at: time.Now()}
}

func (h *hostedCache[T]) drop(slug string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.value, slug)
}

var (
	threadCache hostedCache[[]hostedThread]
	stateCache  hostedCache[stateFile]
)

func cachedHostedThreads(c Config, slug string) ([]hostedThread, error) {
	if threads, ok := threadCache.get(slug); ok {
		return threads, nil
	}
	threads, err := hostedThreads(c, slug)
	if err != nil {
		return nil, err
	}
	threadCache.put(slug, threads)
	return threads, nil
}

func cachedHostedState(c Config, slug string) (stateFile, error) {
	if doc, ok := stateCache.get(slug); ok {
		return doc, nil
	}
	doc, err := hostedStateMeta(c, slug)
	if err != nil {
		return stateFile{}, err
	}
	stateCache.put(slug, doc)
	return doc, nil
}

// --- discussion: reads --------------------------------------------------------

// mergedThreads is what every reader of a summary gets: this machine's threads
// plus the hosted ones, with our own pushed copies collapsed into a single row.
// It doubles as the outbox - anything the backend has not seen goes up here,
// which is also how a summary commented on before it was shared catches up.
func mergedThreads(slug string) ([]any, error) {
	local, err := readLocalThreads(slug)
	if err != nil {
		return nil, err
	}
	if !syncedSlug(slug, "thread-signature") {
		markLocalCommentPermissions(local)
		return localThreadsAsAny(local), nil
	}

	c := loadConfig()
	hosted, herr := cachedHostedThreads(c, slug)
	if herr != nil {
		// The backend is unreachable. Answering with what this machine holds
		// beats answering with nothing; the next read retries the push.
		log.Printf("comments: hosted read failed for %s: %v", slug, herr)
		markLocalCommentPermissions(local)
		return localThreadsAsAny(local), nil
	}

	if pushPendingThreads(c, slug, local, hosted) {
		threadCache.drop(slug)
		if refreshed, err := cachedHostedThreads(c, slug); err == nil {
			hosted = refreshed
		}
		if reread, err := readLocalThreads(slug); err == nil {
			local = reread
		}
	}
	markLocalCommentPermissions(local)
	return mergeThreads(local, hosted), nil
}

func localThreadsAsAny(threads []localThread) []any {
	out := make([]any, 0, len(threads))
	for i := range threads {
		out = append(out, threads[i])
	}
	return out
}

// mergeThreads drops every local thread the backend already holds a copy of and
// keeps the hosted one instead: it carries the reader-facing author names, the
// replies written on the public snapshot, and the snapshot version the thread
// started on. Oldest first, so a popover reads top to bottom in time order.
func mergeThreads(local []localThread, hosted []hostedThread) []any {
	pushed := map[string]bool{}
	for _, thread := range hosted {
		if thread.Signature != "" {
			pushed[thread.Signature] = true
		}
	}
	type row struct {
		created int64
		payload any
	}
	rows := make([]row, 0, len(local)+len(hosted))
	for _, thread := range hosted {
		rows = append(rows, row{created: thread.Created, payload: thread})
	}
	for _, thread := range local {
		if pushed[thread.ID] {
			continue
		}
		rows = append(rows, row{created: thread.Created, payload: thread})
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].created < rows[j].created })
	out := make([]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.payload)
	}
	return out
}

// --- discussion: the outbox ---------------------------------------------------

// pushPendingThreads sends up whatever the backend has never seen and reports
// whether anything moved. Each row is confirmed and recorded before the next
// one goes, so an interrupted run resumes instead of duplicating.
func pushPendingThreads(c Config, slug string, local []localThread, hosted []hostedThread) bool {
	if c.Hosted.Token == "" {
		return false
	}
	bySignature := map[string]*hostedThread{}
	for i := range hosted {
		if hosted[i].Signature != "" {
			bySignature[hosted[i].Signature] = &hosted[i]
		}
	}
	moved := false
	for i := range local {
		thread := &local[i]
		mirror := bySignature[thread.ID]
		if mirror == nil {
			if firstLiveComment(thread) == nil {
				continue // nothing but tombstones: there is no comment to carry
			}
			if err := pushThread(c, slug, thread); err != nil {
				log.Printf("comments: pushing thread %s of %s: %v", thread.ID, slug, err)
				return moved
			}
			moved = true
			continue
		}
		sent := map[string]bool{}
		for _, comment := range mirror.Comments {
			if comment.Signature != "" {
				sent[comment.Signature] = true
			}
		}
		for j := range thread.Comments {
			comment := &thread.Comments[j]
			if comment.Deleted || sent[comment.ID] {
				continue
			}
			id, err := hostedPushComment(c, slug, mirror.ID, comment)
			if err != nil {
				log.Printf("comments: pushing comment %s of %s: %v", comment.ID, slug, err)
				return moved
			}
			comment.HostedID = id
			recordHostedIDs(slug, thread.ID, mirror.ID, map[string]string{comment.ID: id})
			moved = true
		}
	}
	return moved
}

// pushThread sends a whole thread up and records what the backend called it.
func pushThread(c Config, slug string, thread *localThread) error {
	first := firstLiveComment(thread)
	if first == nil {
		return nil // nothing but tombstones - there is no comment to carry
	}
	hostedThreadID, hostedCommentID, err := hostedPushThread(c, slug, thread, first)
	if err != nil {
		return err
	}
	thread.HostedID = hostedThreadID
	first.HostedID = hostedCommentID
	links := map[string]string{first.ID: hostedCommentID}
	for i := range thread.Comments {
		comment := &thread.Comments[i]
		if comment == first || comment.Deleted {
			continue
		}
		id, err := hostedPushComment(c, slug, hostedThreadID, comment)
		if err != nil {
			recordHostedIDs(slug, thread.ID, hostedThreadID, links)
			return err
		}
		comment.HostedID = id
		links[comment.ID] = id
	}
	if err := recordHostedIDs(slug, thread.ID, hostedThreadID, links); err != nil {
		return err
	}
	if thread.Status == "resolved" {
		if err := hostedSetThreadStatus(c, slug, hostedThreadID, "resolve"); err != nil {
			log.Printf("comments: resolving pushed thread %s of %s: %v", thread.ID, slug, err)
		}
	}
	return nil
}

func firstLiveComment(thread *localThread) *localComment {
	for i := range thread.Comments {
		if !thread.Comments[i].Deleted && thread.Comments[i].Body != "" {
			return &thread.Comments[i]
		}
	}
	return nil
}

// recordHostedIDs writes the backend's ids back into the local file in one pass,
// so a later edit or deletion knows which remote row it has to follow.
func recordHostedIDs(slug, threadID, hostedThreadID string, comments map[string]string) error {
	_, err := mutateLocalThreads(slug, func(threads *[]localThread) error {
		for i := range *threads {
			if (*threads)[i].ID != threadID {
				continue
			}
			(*threads)[i].HostedID = hostedThreadID
			for j := range (*threads)[i].Comments {
				comment := &(*threads)[i].Comments[j]
				if id, ok := comments[comment.ID]; ok {
					comment.HostedID = id
				}
			}
			return nil
		}
		return errors.New("thread not found")
	})
	return err
}

// --- discussion: writes -------------------------------------------------------

// syncNewThread mirrors a thread the dashboard just created. Failures are
// logged, not returned: the comment is already saved locally, and the outbox in
// pushPendingThreads retries on the next read.
func syncNewThread(slug string, thread *localThread) {
	if !syncedSlug(slug, "thread-signature") {
		return
	}
	c := loadConfig()
	if err := pushThread(c, slug, thread); err != nil {
		log.Printf("comments: pushing new thread of %s: %v", slug, err)
		return
	}
	threadCache.drop(slug)
}

// syncNewComment mirrors a reply. A thread that was never pushed goes up whole,
// which also covers replying to something written before the summary was shared.
func syncNewComment(slug, threadID string, comment *localComment) {
	if !syncedSlug(slug, "thread-signature") {
		return
	}
	c := loadConfig()
	thread, ok := findLocalThread(slug, threadID)
	if !ok {
		return
	}
	if thread.HostedID == "" {
		if err := pushThread(c, slug, &thread); err != nil {
			log.Printf("comments: pushing thread %s of %s: %v", thread.ID, slug, err)
		}
		threadCache.drop(slug)
		return
	}
	id, err := hostedPushComment(c, slug, thread.HostedID, comment)
	if err != nil {
		log.Printf("comments: pushing reply to %s of %s: %v", thread.ID, slug, err)
		return
	}
	recordHostedIDs(slug, thread.ID, thread.HostedID, map[string]string{comment.ID: id})
	threadCache.drop(slug)
}

// syncCommentMutation follows an edit or a soft deletion to the pushed copy. An
// empty body is the deletion; the backend keeps the same tombstone semantics.
func syncCommentMutation(slug, threadID, commentID, body string) {
	if !syncedSlug(slug, "thread-signature") {
		return
	}
	thread, ok := findLocalThread(slug, threadID)
	if !ok || thread.HostedID == "" {
		return
	}
	var hostedComment string
	for i := range thread.Comments {
		if sameLocalComment(&thread.Comments[i], commentID) {
			hostedComment = thread.Comments[i].HostedID
			break
		}
	}
	if hostedComment == "" {
		return
	}
	c := loadConfig()
	var err error
	if body == "" {
		err = hostedDeleteComment(c, slug, thread.HostedID, hostedComment)
	} else {
		err = hostedEditComment(c, slug, thread.HostedID, hostedComment, body)
	}
	if err != nil {
		log.Printf("comments: mirroring mutation on %s of %s: %v", commentID, slug, err)
		return
	}
	threadCache.drop(slug)
}

// syncThreadDrop follows a deletion to the pushed copy. Unlike the other
// mirrors this one is reported back: a thread that is gone here but still on the
// public snapshot is the exact failure the double write exists to avoid, so the
// caller gets to tell the user instead of the log.
func syncThreadDrop(slug string, thread *localThread) error {
	if !syncedSlug(slug, "thread-signature") || thread.HostedID == "" {
		return nil
	}
	if err := hostedDropThread(loadConfig(), slug, thread.HostedID); err != nil {
		return err
	}
	threadCache.drop(slug)
	return nil
}

func syncThreadStatus(slug, threadID, action string) {
	if !syncedSlug(slug, "thread-signature") {
		return
	}
	thread, ok := findLocalThread(slug, threadID)
	if !ok || thread.HostedID == "" {
		return
	}
	if err := hostedSetThreadStatus(loadConfig(), slug, thread.HostedID, action); err != nil {
		log.Printf("comments: mirroring %s on %s of %s: %v", action, threadID, slug, err)
		return
	}
	threadCache.drop(slug)
}

// hostedThreadRef resolves a thread the browser named to its backend id. It is
// the fallback for rows that only exist there - a reader's thread on the public
// snapshot - which have no local row to attach a reply or an edit to.
func hostedThreadRef(slug, threadID string) (string, bool) {
	if !syncedSlug(slug, "thread-signature") {
		return "", false
	}
	threads, err := cachedHostedThreads(loadConfig(), slug)
	if err != nil {
		return "", false
	}
	for _, thread := range threads {
		if thread.ID == threadID || (thread.Signature != "" && thread.Signature == threadID) {
			return thread.ID, true
		}
	}
	return "", false
}

// hostedCommentRef does the same for one comment. A reply written on the public
// snapshot lands in the backend only, even when the thread it answers started
// here, so mutating it has to go straight there too.
func hostedCommentRef(slug, threadID, commentID string) (string, string, bool) {
	if !syncedSlug(slug, "thread-signature") {
		return "", "", false
	}
	threads, err := cachedHostedThreads(loadConfig(), slug)
	if err != nil {
		return "", "", false
	}
	for _, thread := range threads {
		if thread.ID != threadID && (thread.Signature == "" || thread.Signature != threadID) {
			continue
		}
		for _, comment := range thread.Comments {
			if comment.ID == commentID || (comment.Signature != "" && comment.Signature == commentID) {
				return thread.ID, comment.ID, true
			}
		}
	}
	return "", "", false
}

func findLocalThread(slug, threadID string) (localThread, bool) {
	threads, err := readLocalThreads(slug)
	if err != nil {
		return localThread{}, false
	}
	for i := range threads {
		if sameLocalThread(&threads[i], threadID) {
			return threads[i], true
		}
	}
	return localThread{}, false
}

// --- page state ---------------------------------------------------------------

// mergedStateFile folds the hosted copy over the local one, newest write wins.
// Both sides stamp their own clock, and a push always lands after the local
// write it mirrors, so a key that only differs because it was double-written
// resolves to the same value either way. A genuine disagreement - a reader
// ticked something on the public snapshot - resolves in favour of whoever
// touched it last, which is the same rule a single store would apply.
func mergedStateFile(local, hosted stateFile) stateFile {
	out := stateFile{Document: map[string]stateEntry{}, Users: map[string]map[string]stateEntry{}}
	for key, entry := range local.Document {
		out.Document[key] = entry
	}
	for key, entry := range hosted.Document {
		if current, ok := out.Document[key]; !ok || entry.Updated >= current.Updated {
			out.Document[key] = entry
		}
	}
	for viewer, keys := range local.Users {
		out.Users[viewer] = map[string]stateEntry{}
		for key, entry := range keys {
			out.Users[viewer][key] = entry
		}
	}
	for viewer, keys := range hosted.Users {
		if out.Users[viewer] == nil {
			out.Users[viewer] = map[string]stateEntry{}
		}
		for key, entry := range keys {
			if current, ok := out.Users[viewer][key]; !ok || entry.Updated >= current.Updated {
				out.Users[viewer][key] = entry
			}
		}
	}
	return out
}

// mergedStateDoc is the read half of the state double write, and its outbox:
// keys this machine holds that the backend is missing or knows an older value
// for go up before the merged answer is returned.
func mergedStateDoc(slug string) (stateFile, error) {
	local, err := stateSnapshot(slug)
	if err != nil {
		return stateFile{}, err
	}
	if !syncedSlug(slug, "state-meta") {
		return local, nil
	}
	c := loadConfig()
	hosted, herr := cachedHostedState(c, slug)
	if herr != nil {
		log.Printf("state: hosted read failed for %s: %v", slug, herr)
		return local, nil
	}
	if pushPendingState(c, slug, local, hosted) {
		stateCache.drop(slug)
		if refreshed, err := cachedHostedState(c, slug); err == nil {
			hosted = refreshed
		}
	}
	return mergedStateFile(local, hosted), nil
}

func mergedStateView(slug, viewer string) (stateView, error) {
	if !validStateSlug(slug) {
		return stateView{}, errors.New("invalid slug")
	}
	if !validViewer(viewer) {
		return stateView{}, errors.New("invalid viewer id")
	}
	doc, err := mergedStateDoc(slug)
	if err != nil {
		return stateView{}, err
	}
	return viewOf(slug, viewer, doc), nil
}

func pushPendingState(c Config, slug string, local, hosted stateFile) bool {
	if c.Hosted.Token == "" {
		return false
	}
	pending := map[string][]stateOp{}
	stale := func(current map[string]stateEntry, key string, entry stateEntry) bool {
		existing, ok := current[key]
		return !ok || entry.Updated > existing.Updated
	}
	for key, entry := range local.Document {
		if stale(hosted.Document, key, entry) {
			pending[""] = append(pending[""], stateOp{Key: key, Scope: scopeDocument, Value: entry.Value})
		}
	}
	for viewer, keys := range local.Users {
		for key, entry := range keys {
			if stale(hosted.Users[viewer], key, entry) {
				pending[viewer] = append(pending[viewer], stateOp{Key: key, Scope: scopeUser, Value: entry.Value})
			}
		}
	}
	moved := false
	for viewer, ops := range pending {
		for len(ops) > 0 {
			size := len(ops)
			if size > maxStateOps {
				size = maxStateOps
			}
			if err := hostedStateSet(c, slug, viewer, ops[:size]); err != nil {
				log.Printf("state: pushing %d key(s) of %s: %v", size, slug, err)
				return moved
			}
			moved = true
			ops = ops[size:]
		}
	}
	return moved
}

// syncStateOps mirrors a batch the dashboard just applied locally. Best effort,
// like the discussion writes: mergedStateDoc pushes whatever did not make it.
func syncStateOps(slug, viewer string, ops []stateOp) {
	if len(ops) == 0 {
		return
	}
	if !syncedSlug(slug, "state-meta") {
		return
	}
	c := loadConfig()
	if err := hostedStateSet(c, slug, viewer, ops); err != nil {
		log.Printf("state: pushing %d op(s) of %s: %v", len(ops), slug, err)
		return
	}
	stateCache.drop(slug)
}

// syncStateClear follows a CLI clear to the backend. The selection is resolved
// against the hosted copy, so keys that only ever existed there are cleared too
// - a clear that left half the readers' values behind would not be a clear.
func syncStateClear(slug, scope, viewer, key string) {
	if !syncedSlug(slug, "state-meta") {
		return
	}
	c := loadConfig()
	hosted, err := cachedHostedState(c, slug)
	if err != nil {
		log.Printf("state: hosted read failed for %s: %v", slug, err)
		return
	}
	pending := map[string][]stateOp{}
	collect := func(owner string, keys map[string]stateEntry, opScope string) {
		for name := range keys {
			if key != "" && name != key {
				continue
			}
			pending[owner] = append(pending[owner], stateOp{Key: name, Scope: opScope, Delete: true})
		}
	}
	if scope == "" || scope == scopeDocument {
		collect("", hosted.Document, scopeDocument)
	}
	if scope == "" || scope == scopeUser {
		for owner, keys := range hosted.Users {
			if viewer != "" && owner != viewer {
				continue
			}
			collect(owner, keys, scopeUser)
		}
	}
	for owner, ops := range pending {
		for len(ops) > 0 {
			size := len(ops)
			if size > maxStateOps {
				size = maxStateOps
			}
			if err := hostedStateSet(c, slug, owner, ops[:size]); err != nil {
				log.Printf("state: clearing %d key(s) of %s: %v", size, slug, err)
				return
			}
			ops = ops[size:]
		}
	}
	stateCache.drop(slug)
}

// --- hosted state client ------------------------------------------------------

// hostedStateMeta reads the hosted state with its timestamps, which is the only
// shape the merge above can reason about. The plain dump stays what the CLI's
// `lattice state --hosted` prints.
func hostedStateMeta(c Config, slug string) (stateFile, error) {
	if c.Hosted.Token == "" {
		return stateFile{}, errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodGet, "/v1/shares/"+url.PathEscape(slug)+"/state?meta=1", nil)
	if err != nil {
		return stateFile{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return stateFile{}, stateAPIError(resp)
	}
	var out struct {
		Document map[string]stateEntry            `json:"document"`
		Users    map[string]map[string]stateEntry `json:"users"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return stateFile{}, err
	}
	return stateFile{Document: out.Document, Users: out.Users}, nil
}
