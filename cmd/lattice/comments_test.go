package main

import (
	"strings"
	"testing"
)

func TestLocalCommentEditDeletePreservesHistory(t *testing.T) {
	t.Setenv("LATTICE_DIR", t.TempDir())

	thread, err := newLocalThread(
		"report",
		"#recommendation",
		"Recommendation",
		"Original",
		"You",
		"human",
	)
	if err != nil {
		t.Fatal(err)
	}
	commentID := thread.Comments[0].ID

	edited, err := editLocalComment("report", thread.ID, commentID, "Revised")
	if err != nil {
		t.Fatal(err)
	}
	if edited.Body != "Revised" || len(edited.Revisions) != 1 {
		t.Fatalf("unexpected edited comment: %#v", edited)
	}
	if revision := edited.Revisions[0]; revision.Action != "edit" || revision.Body != "Original" {
		t.Fatalf("unexpected edit revision: %#v", revision)
	}

	deleted, err := deleteLocalComment("report", thread.ID, commentID)
	if err != nil {
		t.Fatal(err)
	}
	if !deleted.Deleted || deleted.Body != "" || len(deleted.Revisions) != 2 {
		t.Fatalf("unexpected deleted comment: %#v", deleted)
	}
	if revision := deleted.Revisions[1]; revision.Action != "delete" || revision.Body != "Revised" {
		t.Fatalf("unexpected delete revision: %#v", revision)
	}

	stored, err := readLocalThreads("report")
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) != 1 || len(stored[0].Comments[0].Revisions) != 2 {
		t.Fatalf("history was not persisted: %#v", stored)
	}
}

func TestLocalHumanCannotEditAgentComment(t *testing.T) {
	t.Setenv("LATTICE_DIR", t.TempDir())

	thread, err := newLocalThread("report", "#summary", "Summary", "Agent note", "Agent", "agent")
	if err != nil {
		t.Fatal(err)
	}
	_, err = editLocalComment("report", thread.ID, thread.Comments[0].ID, "Changed")
	if err == nil || !strings.Contains(err.Error(), "not editable") {
		t.Fatalf("expected ownership error, got %v", err)
	}
}
