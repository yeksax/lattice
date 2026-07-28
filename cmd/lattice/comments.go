package main

// comments.go - local-first discussion threads.
//
// Conversations live beside Lattice metadata, never inside the summary HTML.
// The daemon injects the comment UI at response time, while agents use the same
// API through the CLI.
//
// A shared summary has a second audience, and sync.go double-writes every row
// here into the hosted backend so both sides see one conversation. Two fields
// carry that relationship: the row's own id doubles as the dedupe signature the
// backend stores, and HostedID remembers what the backend called it, so a later
// edit or deletion lands on the same row instead of a copy of it.

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type localComment struct {
	ID         string                 `json:"id"`
	Author     string                 `json:"author"`
	AuthorKind string                 `json:"author_kind"`
	Body       string                 `json:"body"`
	Created    int64                  `json:"created"`
	Updated    int64                  `json:"updated"`
	Deleted    bool                   `json:"deleted,omitempty"`
	Edited     bool                   `json:"edited,omitempty"`
	CanEdit    bool                   `json:"can_edit,omitempty"`
	HostedID   string                 `json:"hosted_id,omitempty"`
	Revisions  []localCommentRevision `json:"revisions,omitempty"`
}

type localCommentRevision struct {
	ID         string `json:"id"`
	Body       string `json:"body"`
	Action     string `json:"action"`
	AuthorKind string `json:"author_kind"`
	Created    int64  `json:"created"`
}

type localThread struct {
	ID                   string         `json:"id"`
	Selector             string         `json:"selector"`
	AnchorText           string         `json:"anchor_text,omitempty"`
	SourceVersionCreated string         `json:"source_version_created,omitempty"`
	Status               string         `json:"status"`
	Created              int64          `json:"created"`
	Updated              int64          `json:"updated"`
	HostedID             string         `json:"hosted_id,omitempty"`
	Comments             []localComment `json:"comments"`
}

var commentsMu sync.Mutex

// A row can be addressed by either name: the id this machine minted, or the id
// the hosted backend gave the copy it was pushed as. The browser shows whichever
// of the two the merge in sync.go put in front of the reader, so every lookup
// here answers to both.
func sameLocalThread(t *localThread, id string) bool {
	return t.ID == id || (t.HostedID != "" && t.HostedID == id)
}

func sameLocalComment(c *localComment, id string) bool {
	return c.ID == id || (c.HostedID != "" && c.HostedID == id)
}

func commentsDir() string {
	return filepath.Join(summariesDir(), ".lattice", "comments")
}

func commentsPath(slug string) string {
	return filepath.Join(commentsDir(), slug+".json")
}

func validCommentSlug(slug string) bool {
	return slug != "" && slugify(slug) == slug && !strings.Contains(slug, "..")
}

func readLocalThreads(slug string) ([]localThread, error) {
	if !validCommentSlug(slug) {
		return nil, errors.New("invalid slug")
	}
	commentsMu.Lock()
	defer commentsMu.Unlock()
	return readLocalThreadsUnlocked(slug)
}

func readLocalThreadsUnlocked(slug string) ([]localThread, error) {
	b, err := os.ReadFile(commentsPath(slug))
	if errors.Is(err, os.ErrNotExist) {
		return []localThread{}, nil
	}
	if err != nil {
		return nil, err
	}
	var threads []localThread
	if err := json.Unmarshal(b, &threads); err != nil {
		return nil, fmt.Errorf("decode comments: %w", err)
	}
	if threads == nil {
		threads = []localThread{}
	}
	return threads, nil
}

func writeLocalThreadsUnlocked(slug string, threads []localThread) error {
	if err := os.MkdirAll(commentsDir(), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(threads, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(commentsDir(), slug+"-*.tmp")
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
	return os.Rename(name, commentsPath(slug))
}

func mutateLocalThreads(slug string, mutate func(*[]localThread) error) ([]localThread, error) {
	if !validCommentSlug(slug) {
		return nil, errors.New("invalid slug")
	}
	commentsMu.Lock()
	defer commentsMu.Unlock()
	threads, err := readLocalThreadsUnlocked(slug)
	if err != nil {
		return nil, err
	}
	if err := mutate(&threads); err != nil {
		return nil, err
	}
	if err := writeLocalThreadsUnlocked(slug, threads); err != nil {
		return nil, err
	}
	return threads, nil
}

func newLocalThread(slug, selector, anchorText, body, author, authorKind string) (*localThread, error) {
	selector = strings.TrimSpace(selector)
	anchorText = strings.TrimSpace(anchorText)
	body = strings.TrimSpace(body)
	author, authorKind = normalizeLocalAuthor(author, authorKind)
	if selector == "" || len(selector) > 500 {
		return nil, errors.New("selector is required (max 500 chars)")
	}
	if body == "" || len(body) > 16<<10 {
		return nil, errors.New("comment is required (max 16KB)")
	}
	now := time.Now().Unix()
	thread := localThread{
		ID:                   localID("thr"),
		Selector:             selector,
		AnchorText:           truncateRunes(anchorText, 500),
		SourceVersionCreated: sourceState(slug),
		Status:               "open",
		Created:              now,
		Updated:              now,
		Comments: []localComment{{
			ID:         localID("cmt"),
			Author:     author,
			AuthorKind: authorKind,
			Body:       body,
			Created:    now,
			Updated:    now,
		}},
	}
	if _, err := mutateLocalThreads(slug, func(threads *[]localThread) error {
		*threads = append(*threads, thread)
		return nil
	}); err != nil {
		return nil, err
	}
	return &thread, nil
}

func replyLocalThread(slug, threadID, body, author, authorKind string) (*localComment, error) {
	body = strings.TrimSpace(body)
	author, authorKind = normalizeLocalAuthor(author, authorKind)
	if body == "" || len(body) > 16<<10 {
		return nil, errors.New("comment is required (max 16KB)")
	}
	now := time.Now().Unix()
	comment := localComment{
		ID:         localID("cmt"),
		Author:     author,
		AuthorKind: authorKind,
		Body:       body,
		Created:    now,
		Updated:    now,
	}
	found := false
	if _, err := mutateLocalThreads(slug, func(threads *[]localThread) error {
		for i := range *threads {
			if !sameLocalThread(&(*threads)[i], threadID) {
				continue
			}
			(*threads)[i].Comments = append((*threads)[i].Comments, comment)
			(*threads)[i].Updated = now
			found = true
			return nil
		}
		return errors.New("thread not found")
	}); err != nil {
		return nil, err
	}
	if !found {
		return nil, errors.New("thread not found")
	}
	return &comment, nil
}

func editLocalComment(slug, threadID, commentID, body string) (*localComment, error) {
	body = strings.TrimSpace(body)
	if body == "" || len(body) > 16<<10 {
		return nil, errors.New("comment is required (max 16KB)")
	}
	var edited *localComment
	_, err := mutateLocalThreads(slug, func(threads *[]localThread) error {
		for i := range *threads {
			if !sameLocalThread(&(*threads)[i], threadID) {
				continue
			}
			for j := range (*threads)[i].Comments {
				comment := &(*threads)[i].Comments[j]
				if !sameLocalComment(comment, commentID) {
					continue
				}
				if comment.AuthorKind != "human" || comment.Deleted {
					return errors.New("comment not editable")
				}
				if comment.Body == body {
					copy := *comment
					copy.CanEdit = true
					edited = &copy
					return nil
				}
				now := time.Now().Unix()
				comment.Revisions = append(comment.Revisions, localCommentRevision{
					ID:         localID("rev"),
					Body:       comment.Body,
					Action:     "edit",
					AuthorKind: "human",
					Created:    now,
				})
				comment.Body = body
				comment.Updated = now
				comment.CanEdit = true
				(*threads)[i].Updated = now
				copy := *comment
				edited = &copy
				return nil
			}
			return errors.New("comment not found")
		}
		return errors.New("thread not found")
	})
	if err != nil {
		return nil, err
	}
	return edited, nil
}

func deleteLocalComment(slug, threadID, commentID string) (*localComment, error) {
	var deleted *localComment
	_, err := mutateLocalThreads(slug, func(threads *[]localThread) error {
		for i := range *threads {
			if !sameLocalThread(&(*threads)[i], threadID) {
				continue
			}
			for j := range (*threads)[i].Comments {
				comment := &(*threads)[i].Comments[j]
				if !sameLocalComment(comment, commentID) {
					continue
				}
				if comment.AuthorKind != "human" || comment.Deleted {
					return errors.New("comment not editable")
				}
				now := time.Now().Unix()
				comment.Revisions = append(comment.Revisions, localCommentRevision{
					ID:         localID("rev"),
					Body:       comment.Body,
					Action:     "delete",
					AuthorKind: "human",
					Created:    now,
				})
				comment.Body = ""
				comment.Deleted = true
				comment.CanEdit = false
				comment.Updated = now
				(*threads)[i].Updated = now
				copy := *comment
				deleted = &copy
				return nil
			}
			return errors.New("comment not found")
		}
		return errors.New("thread not found")
	})
	if err != nil {
		return nil, err
	}
	return deleted, nil
}

func markLocalCommentPermissions(threads []localThread) {
	for i := range threads {
		for j := range threads[i].Comments {
			comment := &threads[i].Comments[j]
			comment.Edited = len(comment.Revisions) > 0 && !comment.Deleted
			comment.CanEdit = comment.AuthorKind == "human" && !comment.Deleted
			comment.Revisions = nil
		}
	}
}

func markLocalCommentPermission(comment *localComment) {
	comment.Edited = len(comment.Revisions) > 0 && !comment.Deleted
	comment.CanEdit = comment.AuthorKind == "human" && !comment.Deleted
	comment.Revisions = nil
}

// dropLocalThread removes a thread outright. Comments get a tombstone because a
// conversation still has to read; a thread that should not exist has no shape
// worth preserving.
func dropLocalThread(slug, threadID string) (*localThread, error) {
	var dropped *localThread
	_, err := mutateLocalThreads(slug, func(threads *[]localThread) error {
		for i := range *threads {
			if !sameLocalThread(&(*threads)[i], threadID) {
				continue
			}
			copy := (*threads)[i]
			dropped = &copy
			*threads = append((*threads)[:i], (*threads)[i+1:]...)
			return nil
		}
		return errors.New("thread not found")
	})
	if err != nil {
		return nil, err
	}
	return dropped, nil
}

func setLocalThreadStatus(slug, threadID, status string) error {
	if status != "open" && status != "resolved" {
		return errors.New("invalid thread status")
	}
	_, err := mutateLocalThreads(slug, func(threads *[]localThread) error {
		for i := range *threads {
			if !sameLocalThread(&(*threads)[i], threadID) {
				continue
			}
			(*threads)[i].Status = status
			(*threads)[i].Updated = time.Now().Unix()
			return nil
		}
		return errors.New("thread not found")
	})
	return err
}

func normalizeLocalAuthor(author, kind string) (string, string) {
	if kind != "agent" {
		kind = "human"
	}
	author = strings.TrimSpace(author)
	if author == "" {
		if kind == "agent" {
			author = "Agent"
		} else {
			author = "You"
		}
	}
	return truncateRunes(author, 80), kind
}

func sourceState(slug string) string {
	fi, err := os.Stat(resolveSource(slug))
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%d-%d", fi.ModTime().UnixNano(), fi.Size())
}

func localID(prefix string) string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%s_%x", prefix, time.Now().UnixNano())
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(b[:])
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}
