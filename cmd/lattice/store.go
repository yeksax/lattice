package main

// store.go - the filesystem is the database.
// ~/.summaries/<slug>.html is a symlink to the original file (or a real file
// if dropped in by hand); ~/.summaries/.lattice/meta/<slug>.json is an
// optional sidecar caching ingest-time metadata so entries survive their
// target being deleted.

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

// uniqueSlug de-dupes against files already in ~/.summaries.
func uniqueSlug(base string) string {
	if base == "" {
		base = "summary"
	}
	slug := base
	for i := 2; ; i++ {
		if _, err := os.Lstat(filepath.Join(summariesDir(), slug+".html")); errors.Is(err, os.ErrNotExist) {
			return slug
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
}

// addSummary validates src, symlinks it into ~/.summaries and writes the
// sidecar. It never modifies the source file.
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
	if err := os.Symlink(src, filepath.Join(summariesDir(), slug+".html")); err != nil {
		return nil, err
	}

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

// removeSummary deletes the symlink and sidecar - never the target file.
func removeSummary(slug string) error {
	link := filepath.Join(summariesDir(), slug+".html")
	if _, err := os.Lstat(link); err != nil {
		return fmt.Errorf("no such summary: %s", slug)
	}
	if err := os.Remove(link); err != nil {
		return err
	}
	os.Remove(filepath.Join(metaDir(), slug+".json")) // best-effort
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
			// Only counts if the symlink still exists.
			if _, err := os.Lstat(filepath.Join(summariesDir(), m.Slug+".html")); err == nil {
				return m
			}
		}
	}
	return nil
}
