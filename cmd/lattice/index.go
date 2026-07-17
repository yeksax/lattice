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

// scan rebuilds the whole index from ~/.summaries.
func (ix *Index) scan() {
	entries, err := os.ReadDir(summariesDir())
	if err != nil {
		return
	}
	fresh := make(map[string]*Doc, len(entries))
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".html") {
			continue
		}
		slug := strings.TrimSuffix(name, ".html")
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

// buildDoc reads one entry off disk. Returns nil if the link itself is gone.
func buildDoc(slug string) *Doc {
	link := filepath.Join(summariesDir(), slug+".html")
	li, err := os.Lstat(link)
	if err != nil {
		return nil
	}

	d := &Doc{Slug: slug, Created: li.ModTime()}
	if m := readMeta(slug); m != nil {
		d.Title, d.Description, d.Tags = m.Title, m.Description, m.Tags
		d.Source = m.Source
		if !m.Created.IsZero() {
			d.Created = m.Created
		}
	}
	if d.Source == "" {
		if target, err := os.Readlink(link); err == nil {
			d.Source = target
		} else {
			d.Source = link // real file dropped into ~/.summaries
		}
	}

	fi, err := os.Stat(link) // follows the symlink
	if err != nil {
		d.Missing = true // target deleted - keep the cached sidecar view
	} else {
		d.Size = fi.Size()
		d.Modified = fi.ModTime()
		if b, err := os.ReadFile(link); err == nil {
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
		fi, err := os.Stat(filepath.Join(summariesDir(), d.Slug+".html"))
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

// watch keeps the index in sync with ~/.summaries. Events are debounced per
// slug; meta-dir churn is ignored (reindex reads sidecars anyway).
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

	pending := make(map[string]*time.Timer)
	var mu sync.Mutex
	for {
		select {
		case ev, ok := <-w.Events:
			if !ok {
				return
			}
			name := filepath.Base(ev.Name)
			if !strings.HasSuffix(name, ".html") {
				continue
			}
			slug := strings.TrimSuffix(name, ".html")
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
