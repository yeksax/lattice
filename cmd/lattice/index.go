package main

// index.go - the entire search index lives in RAM. It is rebuilt from
// ~/.summaries on startup and kept fresh by fsnotify; a full rescan of a few
// hundred summaries takes milliseconds, so correctness beats cleverness here.

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/fsnotify/fsnotify"
)

// Doc is one indexed summary. Exported fields marshal to the API; the
// lowercase search caches stay private.
type Doc struct {
	Slug        string    `json:"slug"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Tags        []string  `json:"tags,omitempty"`
	Source      string    `json:"source"`
	Size        int64     `json:"size"`
	Created     time.Time `json:"created"`
	Modified    time.Time `json:"modified"`
	Missing     bool      `json:"missing"`

	text     string // display text (for snippets)
	lowText  string
	lowTitle string
	lowDesc  string
}

type Hit struct {
	*Doc
	Score   int    `json:"score"`
	Snippet string `json:"snippet,omitempty"`
}

type Index struct {
	mu   sync.RWMutex
	docs map[string]*Doc
}

func newIndex() *Index { return &Index{docs: make(map[string]*Doc)} }

// scan rebuilds the whole index from ~/.summaries. Entries come from two
// places: registered sidecars (.lattice/meta/*.json) and library-local .html
// files (hand-dropped or legacy symlinks). The union is keyed by slug.
func (ix *Index) scan() {
	slugs := map[string]bool{}
	if entries, err := os.ReadDir(summariesDir()); err == nil {
		for _, e := range entries {
			if name := e.Name(); strings.HasSuffix(name, ".html") {
				slugs[strings.TrimSuffix(name, ".html")] = true
			}
		}
	}
	if entries, err := os.ReadDir(metaDir()); err == nil {
		for _, e := range entries {
			if name := e.Name(); strings.HasSuffix(name, ".json") {
				slugs[strings.TrimSuffix(name, ".json")] = true
			}
		}
	}
	fresh := make(map[string]*Doc, len(slugs))
	for slug := range slugs {
		if d := buildDoc(slug); d != nil {
			fresh[slug] = d
		}
	}
	ix.mu.Lock()
	ix.docs = fresh
	ix.mu.Unlock()
}

// reindex refreshes (or drops) a single slug.
func (ix *Index) reindex(slug string) {
	d := buildDoc(slug)
	ix.mu.Lock()
	if d == nil {
		delete(ix.docs, slug)
	} else {
		ix.docs[slug] = d
	}
	ix.mu.Unlock()
}

// buildDoc reads one entry off disk. Returns nil if neither a sidecar nor a
// library-local .html exists for the slug.
func buildDoc(slug string) *Doc {
	link := filepath.Join(summariesDir(), slug+".html")
	m := readMeta(slug)
	li, lerr := os.Lstat(link)
	if m == nil && lerr != nil {
		return nil
	}

	d := &Doc{Slug: slug}
	if lerr == nil {
		d.Created = li.ModTime()
	}
	if m != nil {
		d.Title, d.Description, d.Tags = m.Title, m.Description, m.Tags
		d.Source = m.Source
		if !m.Created.IsZero() {
			d.Created = m.Created
		}
	}
	if d.Source == "" {
		d.Source = resolveSource(slug)
	}

	fi, err := os.Stat(d.Source)
	if err != nil {
		d.Missing = true // source deleted - keep the cached sidecar view
	} else {
		d.Size = fi.Size()
		d.Modified = fi.ModTime()
		if b, err := os.ReadFile(d.Source); err == nil {
			ex := extractHTML(strings.NewReader(string(b)))
			if ex.Title != "" {
				d.Title = ex.Title
			}
			if ex.Description != "" {
				d.Description = ex.Description
			}
			d.text = ex.Text
			d.lowText = strings.ToLower(ex.Text)
		}
	}
	if d.Title == "" {
		d.Title = slug
	}
	d.lowTitle = strings.ToLower(d.Title)
	d.lowDesc = strings.ToLower(d.Description)
	return d
}

// list returns all docs, newest first. Targets live outside ~/.summaries, so
// fsnotify can't see them die/return - a stat per doc on each list call
// (microseconds each) keeps the missing flag truthful.
func (ix *Index) list() []*Doc {
	ix.mu.RLock()
	out := make([]*Doc, 0, len(ix.docs))
	for _, d := range ix.docs {
		out = append(out, d)
	}
	ix.mu.RUnlock()

	for i, d := range out {
		fi, err := os.Stat(d.Source)
		if (err != nil) != d.Missing || (err == nil && fi.ModTime() != d.Modified) {
			ix.reindex(d.Slug)
			if nd := ix.get(d.Slug); nd != nil {
				out[i] = nd
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	return out
}

func (ix *Index) get(slug string) *Doc {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.docs[slug]
}

// search: every term must match somewhere (AND); title > tag > description >
// body-occurrence scoring. Sub-millisecond for hundreds of docs.
func (ix *Index) search(q string) []Hit {
	terms := strings.Fields(strings.ToLower(q))
	if len(terms) == 0 {
		return nil
	}
	ix.mu.RLock()
	defer ix.mu.RUnlock()

	hits := make([]Hit, 0, 16)
	for _, d := range ix.docs {
		score, snippetAt := 0, -1
		matched := true
		for _, t := range terms {
			ts := 0
			if strings.Contains(d.lowTitle, t) {
				ts += 100
			}
			for _, tag := range d.Tags {
				if strings.Contains(strings.ToLower(tag), t) {
					ts += 60
					break
				}
			}
			if strings.Contains(d.lowDesc, t) {
				ts += 40
			}
			if i := strings.Index(d.lowText, t); i >= 0 {
				n := strings.Count(d.lowText, t)
				if n > 20 {
					n = 20
				}
				ts += 2 * n
				if snippetAt < 0 {
					snippetAt = i
				}
			}
			if ts == 0 {
				matched = false
				break
			}
			score += ts
		}
		if !matched {
			continue
		}
		hits = append(hits, Hit{Doc: d, Score: score, Snippet: snippet(d.text, snippetAt)})
	}
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].Score != hits[j].Score {
			return hits[i].Score > hits[j].Score
		}
		return hits[i].Created.After(hits[j].Created)
	})
	return hits
}

// snippet grabs ~200 chars of display text around a byte offset, snapped to
// rune boundaries. at is an offset into the lowercased text; lengths can
// drift on exotic case-folds, so clamp defensively.
func snippet(text string, at int) string {
	if text == "" {
		return ""
	}
	if at < 0 || at >= len(text) {
		at = 0
	}
	start, end := at-70, at+130
	if start < 0 {
		start = 0
	}
	if end > len(text) {
		end = len(text)
	}
	for start > 0 && !utf8.RuneStart(text[start]) {
		start--
	}
	for end < len(text) && !utf8.RuneStart(text[end]) {
		end++
	}
	s := text[start:end]
	if start > 0 {
		s = "…" + s
	}
	if end < len(text) {
		s += "…"
	}
	return s
}

// watch keeps the index in sync with the library. It watches ~/.summaries for
// hand-dropped .html files AND .lattice/meta for registered sidecars (the
// metadata-only add path never touches ~/.summaries itself). Events are
// debounced per slug.
func (ix *Index) watch() {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("watch disabled: %v", err)
		return
	}
	if err := w.Add(summariesDir()); err != nil {
		log.Printf("watch disabled: %v", err)
		return
	}
	if err := w.Add(metaDir()); err != nil {
		log.Printf("meta watch disabled: %v", err) // non-fatal; scan catches up on restart
	}

	slugOf := func(path string) string {
		name := filepath.Base(path)
		switch ext := filepath.Ext(name); ext {
		case ".html", ".json":
			return strings.TrimSuffix(name, ext)
		}
		return ""
	}

	pending := make(map[string]*time.Timer)
	var mu sync.Mutex
	for {
		select {
		case ev, ok := <-w.Events:
			if !ok {
				return
			}
			slug := slugOf(ev.Name)
			if slug == "" {
				continue
			}
			mu.Lock()
			if t, ok := pending[slug]; ok {
				t.Stop()
			}
			pending[slug] = time.AfterFunc(150*time.Millisecond, func() {
				mu.Lock()
				delete(pending, slug)
				mu.Unlock()
				ix.reindex(slug)
			})
			mu.Unlock()
		case err, ok := <-w.Errors:
			if !ok {
				return
			}
			log.Printf("watch error: %v", err)
		}
	}
}
