package main

// state.go - arbitrary key/value persistence for summaries viewed through the
// local daemon. This is what makes a checklist in a summary survive a reload:
// the page writes keys through the injected bridge (dashboard/state.js) and the
// daemon stores them beside the library, never inside the HTML.
//
// One file per slug, ~/.summaries/.lattice/state/<slug>.json, holding both
// scopes - the filesystem-is-the-database rule applies to state too:
//
//	{
//	  "document": { "cut.analytics": { "v": true, "t": 1753650000 } },
//	  "users":    { "v-9f2c": { "note": { "v": "check with finance", "t": … } } }
//	}
//
// document keys are shared by every reader of the summary; user keys are keyed
// by the reader's viewer id (the browser's own id locally, the Google actor on a
// hosted domain-gated share, where cloud/src/state.ts mirrors this file).

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	scopeDocument = "document"
	scopeUser     = "user"

	maxStateKeyLen     = 200
	maxStateValueBytes = 8 << 10
	maxStateKeys       = 500 // per scope, per viewer
	maxStateViewers    = 500 // oldest are pruned past this
	maxStateOps        = 200 // per request
)

type stateEntry struct {
	Value   json.RawMessage `json:"v"`
	Updated int64           `json:"t"`
}

// stateFile is the on-disk shape. Users is nil until someone writes a user key.
type stateFile struct {
	Document map[string]stateEntry            `json:"document,omitempty"`
	Users    map[string]map[string]stateEntry `json:"users,omitempty"`
}

// stateView is the wire shape: values unwrapped, one map per scope, with the
// user map narrowed to the viewer that asked. Timestamps stay on disk - a page
// wants the value, and the CLI can read the file for the rest.
type stateView struct {
	Slug     string                     `json:"slug"`
	Viewer   string                     `json:"viewer,omitempty"`
	Document map[string]json.RawMessage `json:"document"`
	User     map[string]json.RawMessage `json:"user"`
}

type stateOp struct {
	Key    string          `json:"key"`
	Scope  string          `json:"scope"`
	Value  json.RawMessage `json:"value"`
	Delete bool            `json:"delete"`
}

var (
	stateMu    sync.Mutex
	reViewerID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,80}$`)
)

func stateDir() string             { return filepath.Join(summariesDir(), ".lattice", "state") }
func statePath(slug string) string { return filepath.Join(stateDir(), slug+".json") }

func normalizeScope(scope string) string {
	if strings.ToLower(strings.TrimSpace(scope)) == scopeUser {
		return scopeUser
	}
	return scopeDocument
}

func validStateSlug(slug string) bool {
	return slug != "" && slugify(slug) == slug && !strings.Contains(slug, "..")
}

// validViewer keeps a forged id from escaping into a filename-ish position or
// bloating the file. An empty viewer is legal: it just means "document only".
func validViewer(id string) bool { return id == "" || reViewerID.MatchString(id) }

func readStateFileUnlocked(slug string) (stateFile, error) {
	var doc stateFile
	b, err := os.ReadFile(statePath(slug))
	if errors.Is(err, os.ErrNotExist) {
		return stateFile{}, nil
	}
	if err != nil {
		return doc, err
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return stateFile{}, fmt.Errorf("decode state: %w", err)
	}
	return doc, nil
}

func writeStateFileUnlocked(slug string, doc stateFile) error {
	// An empty document is an absent file - state that was cleared leaves no
	// husk behind, the same way an unregistered summary leaves no sidecar.
	if len(doc.Document) == 0 && len(doc.Users) == 0 {
		if err := os.Remove(statePath(slug)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(stateDir(), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(stateDir(), slug+"-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, statePath(slug))
}

func viewOf(slug, viewer string, doc stateFile) stateView {
	view := stateView{
		Slug:     slug,
		Viewer:   viewer,
		Document: map[string]json.RawMessage{},
		User:     map[string]json.RawMessage{},
	}
	for k, e := range doc.Document {
		view.Document[k] = e.Value
	}
	if viewer != "" {
		for k, e := range doc.Users[viewer] {
			view.User[k] = e.Value
		}
	}
	return view
}

// readState returns one viewer's window on a summary's state.
func readState(slug, viewer string) (stateView, error) {
	if !validStateSlug(slug) {
		return stateView{}, errors.New("invalid slug")
	}
	if !validViewer(viewer) {
		return stateView{}, errors.New("invalid viewer id")
	}
	stateMu.Lock()
	defer stateMu.Unlock()
	doc, err := readStateFileUnlocked(slug)
	if err != nil {
		return stateView{}, err
	}
	return viewOf(slug, viewer, doc), nil
}

// applyState writes a batch of operations and returns the resulting view.
// Conflicts resolve last-write-wins, exactly like poll votes: the server stamps
// the time, so a client whose clock is wrong cannot pin a stale value in place.
func applyState(slug, viewer string, ops []stateOp) (stateView, error) {
	if !validStateSlug(slug) {
		return stateView{}, errors.New("invalid slug")
	}
	if !validViewer(viewer) {
		return stateView{}, errors.New("invalid viewer id")
	}
	if len(ops) > maxStateOps {
		return stateView{}, fmt.Errorf("too many operations (max %d)", maxStateOps)
	}
	for i := range ops {
		if err := validateStateOp(&ops[i], viewer); err != nil {
			return stateView{}, err
		}
	}

	stateMu.Lock()
	defer stateMu.Unlock()
	doc, err := readStateFileUnlocked(slug)
	if err != nil {
		return stateView{}, err
	}
	now := time.Now().Unix()
	for _, op := range ops {
		target := doc.Document
		if normalizeScope(op.Scope) == scopeUser {
			if doc.Users == nil {
				doc.Users = map[string]map[string]stateEntry{}
			}
			if doc.Users[viewer] == nil {
				doc.Users[viewer] = map[string]stateEntry{}
			}
			target = doc.Users[viewer]
		} else if target == nil {
			target = map[string]stateEntry{}
			doc.Document = target
		}
		if op.Delete {
			delete(target, op.Key)
			continue
		}
		if _, exists := target[op.Key]; !exists && len(target) >= maxStateKeys {
			return stateView{}, fmt.Errorf("state key limit reached (%d per scope)", maxStateKeys)
		}
		target[op.Key] = stateEntry{Value: op.Value, Updated: now}
	}
	for id, keys := range doc.Users {
		if len(keys) == 0 {
			delete(doc.Users, id)
		}
	}
	pruneStateViewers(&doc)
	if err := writeStateFileUnlocked(slug, doc); err != nil {
		return stateView{}, err
	}
	return viewOf(slug, viewer, doc), nil
}

func validateStateOp(op *stateOp, viewer string) error {
	op.Key = strings.TrimSpace(op.Key)
	if op.Key == "" || len(op.Key) > maxStateKeyLen {
		return fmt.Errorf("key is required (max %d chars)", maxStateKeyLen)
	}
	op.Scope = normalizeScope(op.Scope)
	if op.Scope == scopeUser && viewer == "" {
		return errors.New("user-scoped state needs a viewer id")
	}
	if op.Delete {
		op.Value = nil
		return nil
	}
	if len(op.Value) == 0 {
		op.Value = json.RawMessage("null")
	}
	if !json.Valid(op.Value) {
		return fmt.Errorf("value for %q must be JSON", op.Key)
	}
	if len(op.Value) > maxStateValueBytes {
		return fmt.Errorf("value for %q exceeds %d bytes", op.Key, maxStateValueBytes)
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, op.Value); err == nil {
		op.Value = json.RawMessage(buf.Bytes())
	}
	return nil
}

// pruneStateViewers caps how many readers a summary remembers. A viewer id is
// self-asserted, so without this a crawler (or a browser clearing storage on
// every visit) would grow the file forever. Least-recently-written goes first.
func pruneStateViewers(doc *stateFile) {
	if len(doc.Users) <= maxStateViewers {
		return
	}
	type seen struct {
		id string
		at int64
	}
	viewers := make([]seen, 0, len(doc.Users))
	for id, keys := range doc.Users {
		latest := int64(0)
		for _, e := range keys {
			if e.Updated > latest {
				latest = e.Updated
			}
		}
		viewers = append(viewers, seen{id: id, at: latest})
	}
	sort.Slice(viewers, func(i, j int) bool { return viewers[i].at > viewers[j].at })
	for _, v := range viewers[maxStateViewers:] {
		delete(doc.Users, v.id)
	}
}

// clearState drops keys for the CLI. An empty key clears the whole scope; an
// empty viewer with scope=user clears every reader's keys.
func clearState(slug, scope, viewer, key string) (int, error) {
	if !validStateSlug(slug) {
		return 0, errors.New("invalid slug")
	}
	if !validViewer(viewer) {
		return 0, errors.New("invalid viewer id")
	}
	stateMu.Lock()
	defer stateMu.Unlock()
	doc, err := readStateFileUnlocked(slug)
	if err != nil {
		return 0, err
	}
	removed := 0
	drop := func(m map[string]stateEntry) {
		if m == nil {
			return
		}
		if key == "" {
			removed += len(m)
			for k := range m {
				delete(m, k)
			}
			return
		}
		if _, ok := m[key]; ok {
			delete(m, key)
			removed++
		}
	}
	switch {
	case scope == scopeUser && viewer != "":
		drop(doc.Users[viewer])
	case scope == scopeUser:
		for id := range doc.Users {
			drop(doc.Users[id])
		}
	case scope == scopeDocument:
		drop(doc.Document)
	default: // no scope given: everything
		drop(doc.Document)
		for id := range doc.Users {
			drop(doc.Users[id])
		}
	}
	for id, keys := range doc.Users {
		if len(keys) == 0 {
			delete(doc.Users, id)
		}
	}
	if err := writeStateFileUnlocked(slug, doc); err != nil {
		return 0, err
	}
	return removed, nil
}

// stateSnapshot is the whole file, for `lattice state <slug> --json` and tests.
func stateSnapshot(slug string) (stateFile, error) {
	if !validStateSlug(slug) {
		return stateFile{}, errors.New("invalid slug")
	}
	stateMu.Lock()
	defer stateMu.Unlock()
	return readStateFileUnlocked(slug)
}

// stateSnapshotDoc is the whole file with values unwrapped - the CLI's shape,
// and what `GET /api/state/<slug>?all=1` returns.
type stateSnapshotDoc struct {
	Slug     string                                `json:"slug"`
	Document map[string]json.RawMessage            `json:"document"`
	Users    map[string]map[string]json.RawMessage `json:"users"`
}

func unwrapState(slug string, doc stateFile) stateSnapshotDoc {
	out := stateSnapshotDoc{
		Slug:     slug,
		Document: map[string]json.RawMessage{},
		Users:    map[string]map[string]json.RawMessage{},
	}
	for k, e := range doc.Document {
		out.Document[k] = e.Value
	}
	for viewer, keys := range doc.Users {
		out.Users[viewer] = map[string]json.RawMessage{}
		for k, e := range keys {
			out.Users[viewer][k] = e.Value
		}
	}
	return out
}
