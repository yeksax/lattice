package main

// polls.go - vote storage for summaries viewed through the local daemon.
// Storage is an append-only JSONL per slug under .lattice/polls/ - the
// filesystem-is-the-database rule applies to votes too. Votes cast on a
// public share are collected by the hosted backend (cloud/), not here.

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

func pollsDir() string            { return filepath.Join(summariesDir(), ".lattice", "polls") }
func pollFile(slug string) string { return filepath.Join(pollsDir(), slug+".jsonl") }

// recordSubmission appends one vote line for a locally-viewed summary.
var pollMu sync.Mutex

func recordSubmission(w http.ResponseWriter, r *http.Request, slug string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil || !json.Valid(body) {
		httpErr(w, http.StatusBadRequest, "body must be JSON ≤ 64KB")
		return
	}
	line, _ := json.Marshal(map[string]any{
		"t":    time.Now().Format(time.RFC3339),
		"via":  "local",
		"ip":   r.RemoteAddr,
		"ua":   r.UserAgent(),
		"data": json.RawMessage(body),
	})

	pollMu.Lock()
	defer pollMu.Unlock()
	if err := os.MkdirAll(pollsDir(), 0o755); err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	f, err := os.OpenFile(pollFile(slug), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer f.Close()
	f.Write(append(line, '\n'))
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte(`{"ok":true}`))
}

func readSubmissions(slug string) []json.RawMessage {
	f, err := os.Open(pollFile(slug))
	if err != nil {
		return []json.RawMessage{}
	}
	defer f.Close()
	out := []json.RawMessage{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 128<<10)
	for sc.Scan() {
		if line := strings.TrimSpace(sc.Text()); line != "" {
			out = append(out, json.RawMessage(line))
		}
	}
	return out
}
