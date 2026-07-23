package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMetadataOnlySummaryLifecycle(t *testing.T) {
	library := t.TempDir()
	t.Setenv("LATTICE_DIR", library)
	sourceDir := t.TempDir()
	source := filepath.Join(sourceDir, "System Review.html")
	content := `<!doctype html><title>System Review</title><meta name="description" content="Portable summary"><body>Evidence</body>`
	if err := os.WriteFile(source, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	meta, err := addSummary(source, "", []string{"infra"})
	if err != nil {
		t.Fatal(err)
	}
	if meta.Slug != "system-review" {
		t.Fatalf("slug = %q", meta.Slug)
	}
	if _, err := os.Lstat(filepath.Join(library, meta.Slug+".html")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("add created a library-local html entry: %v", err)
	}
	if _, err := os.Stat(filepath.Join(metaDir(), meta.Slug+".json")); err != nil {
		t.Fatalf("metadata sidecar missing: %v", err)
	}

	doc := buildDoc(meta.Slug)
	if doc == nil || doc.Source != source || doc.Title != "System Review" || doc.Missing {
		t.Fatalf("unexpected indexed doc: %#v", doc)
	}
	if err := removeSummary(meta.Slug); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("remove touched source: %v", err)
	}
	if doc := buildDoc(meta.Slug); doc != nil {
		t.Fatalf("removed summary still indexed: %#v", doc)
	}
}

func TestRelativeLegacySymlink(t *testing.T) {
	library := t.TempDir()
	t.Setenv("LATTICE_DIR", library)
	sourceDir := t.TempDir()
	source := filepath.Join(sourceDir, "legacy.html")
	if err := os.WriteFile(source, []byte(`<title>Legacy</title>`), 0o644); err != nil {
		t.Fatal(err)
	}
	target, err := filepath.Rel(library, source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(library, "legacy.html")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	doc := buildDoc("legacy")
	if doc == nil || doc.Missing || doc.Source != source || doc.Title != "Legacy" {
		t.Fatalf("unexpected legacy doc: %#v", doc)
	}
}

func TestPutConfigRejectsNull(t *testing.T) {
	t.Setenv("LATTICE_DIR", t.TempDir())
	srv := newServer(newIndex())
	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader("null"))
	rec := httptest.NewRecorder()
	srv.handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestValidateConfigValue(t *testing.T) {
	tests := []struct {
		key, value string
		valid      bool
	}{
		{"theme.preset", "warm", true},
		{"theme.preset", "neon", false},
		{"theme.accent", "#c2410c", true},
		{"theme.accent", "red", false},
		{"theme.font", "serif", true},
		{"theme.font", "comic", false},
		{"theme.density", "spacious", true},
		{"hosted.apiBase", "https://api.lattice.pub", true},
		{"hosted.apiBase", "https://api.lattice.pub/", true},
		{"hosted.apiBase", "https://api.lattice.pub?tenant=x", false},
		{"hosted.apiBase", "api.lattice.pub", false},
		{"unknown", "value", false},
	}
	for _, test := range tests {
		t.Run(test.key+"="+test.value, func(t *testing.T) {
			err := validateConfigValue(test.key, test.value)
			if (err == nil) != test.valid {
				t.Fatalf("valid = %v, err = %v", test.valid, err)
			}
		})
	}
}

func TestResolvedAPIBaseTrimsTrailingSlash(t *testing.T) {
	c := Config{Hosted: Hosted{APIBase: "https://api.lattice.pub/"}}
	if got := c.resolvedAPIBase(); got != "https://api.lattice.pub" {
		t.Fatalf("resolved API base = %q", got)
	}
}
