package main

// store.go - the filesystem is the database.
// Registration is metadata-only: ~/.summaries/.lattice/meta/<slug>.json is the
// entry, recording the absolute path of the original file. Nothing is copied
// or linked, so `lattice add` works identically on every OS (Windows symlinks
// need privileges we can't assume). Two legacy/escape-hatch shapes are still
// honoured everywhere: pre-portability symlinks at ~/.summaries/<slug>.html,
// and real .html files dropped into ~/.summaries by hand.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
)

// Meta is the sidecar written at ingest time.
type Meta struct {
	Slug        string    `json:"slug"`
	Source      string    `json:"source"` // absolute path to the original file
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Tags        []string  `json:"tags,omitempty"`
	Created     time.Time `json:"created"`
}

func summariesDir() string {
	if d := os.Getenv("LATTICE_DIR"); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".summaries"
	}
	return filepath.Join(home, ".summaries")
}

func metaDir() string { return filepath.Join(summariesDir(), ".lattice", "meta") }

func ensureDirs() error { return os.MkdirAll(metaDir(), 0o755) }

// slugify turns "My Report (final).html" into "my-report-final".
func slugify(name string) string {
	name = strings.TrimSuffix(name, filepath.Ext(name))
	var b strings.Builder
	dash := true // suppress leading dash
	for _, r := range strings.ToLower(name) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			dash = false
		case !dash:
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

// uniqueSlug de-dupes against entries already in the library - registered
// sidecars, hand-dropped files, and legacy symlinks all reserve their slug.
func uniqueSlug(base string) string {
	if base == "" {
		base = "summary"
	}
	slug := base
	for i := 2; ; i++ {
		_, herr := os.Lstat(filepath.Join(summariesDir(), slug+".html"))
		_, merr := os.Lstat(filepath.Join(metaDir(), slug+".json"))
		if errors.Is(herr, os.ErrNotExist) && errors.Is(merr, os.ErrNotExist) {
			return slug
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
}

// addSummary validates src and registers it by writing the sidecar - no
// symlink, no copy. It never modifies the source file.
func addSummary(src, title string, tags []string) (*Meta, error) {
	src, err := filepath.Abs(src)
	if err != nil {
		return nil, err
	}
	fi, err := os.Stat(src)
	if err != nil {
		return nil, fmt.Errorf("source: %w", err)
	}
	if fi.IsDir() {
		return nil, fmt.Errorf("source is a directory: %s", src)
	}
	if !strings.EqualFold(filepath.Ext(src), ".html") && !strings.EqualFold(filepath.Ext(src), ".htm") {
		return nil, fmt.Errorf("not an html file: %s", src)
	}
	if err := ensureDirs(); err != nil {
		return nil, err
	}

	// Re-adding the same source is a no-op: return the existing entry.
	if m := findBySource(src); m != nil {
		return m, nil
	}

	slug := uniqueSlug(slugify(filepath.Base(src)))
	m := &Meta{Slug: slug, Source: src, Title: title, Tags: tags, Created: time.Now()}
	// Cache title/description from the content so the entry outlives its target.
	if f, err := os.Open(src); err == nil {
		ex := extractHTML(f)
		f.Close()
		if m.Title == "" {
			m.Title = ex.Title
		}
		m.Description = ex.Description
	}
	if m.Title == "" {
		m.Title = slug
	}
	if err := writeMeta(m); err != nil {
		return nil, err
	}
	return m, nil
}

// removeSummary deletes the sidecar and any library-local .html (a legacy
// symlink or a hand-dropped file) - never the registered source file.
func removeSummary(slug string) error {
	link := filepath.Join(summariesDir(), slug+".html")
	meta := filepath.Join(metaDir(), slug+".json")
	_, lerr := os.Lstat(link)
	_, merr := os.Lstat(meta)
	if lerr != nil && merr != nil {
		return fmt.Errorf("no such summary: %s", slug)
	}
	if lerr == nil {
		if err := os.Remove(link); err != nil {
			return fmt.Errorf("remove library entry: %w", err)
		}
	}
	if merr == nil {
		if err := os.Remove(meta); err != nil {
			return fmt.Errorf("remove metadata: %w", err)
		}
	}
	return nil
}

func readMeta(slug string) *Meta {
	b, err := os.ReadFile(filepath.Join(metaDir(), slug+".json"))
	if err != nil {
		return nil
	}
	var m Meta
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return &m
}

func writeMeta(m *Meta) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(metaDir(), m.Slug+".json"), b, 0o644)
}

func findBySource(src string) *Meta {
	entries, err := os.ReadDir(metaDir())
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		if m := readMeta(strings.TrimSuffix(e.Name(), ".json")); m != nil && m.Source == src {
			return m
		}
	}
	return nil
}

// resolveSource maps a slug to the file to serve/stat: the sidecar's recorded
// source, a legacy symlink's target, or a hand-dropped file in ~/.summaries.
// The returned path may not exist - callers stat and treat that as "missing".
func resolveSource(slug string) string {
	if m := readMeta(slug); m != nil && m.Source != "" {
		return m.Source
	}
	p := filepath.Join(summariesDir(), slug+".html")
	if target, err := os.Readlink(p); err == nil {
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(p), target)
		}
		return target
	}
	return p
}
