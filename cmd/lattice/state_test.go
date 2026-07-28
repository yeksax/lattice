package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestStateScopesStayIsolated(t *testing.T) {
	t.Setenv("LATTICE_DIR", t.TempDir())

	if _, err := applyState("report", "v-alice", []stateOp{
		{Key: "cut.analytics", Value: json.RawMessage("true")},
		{Key: "note", Scope: scopeUser, Value: json.RawMessage(`"ask finance"`)},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := applyState("report", "v-bob", []stateOp{
		{Key: "note", Scope: scopeUser, Value: json.RawMessage(`"bob's note"`)},
	}); err != nil {
		t.Fatal(err)
	}

	alice, err := readState("report", "v-alice")
	if err != nil {
		t.Fatal(err)
	}
	if string(alice.Document["cut.analytics"]) != "true" {
		t.Fatalf("document key missing for alice: %#v", alice.Document)
	}
	if string(alice.User["note"]) != `"ask finance"` {
		t.Fatalf("user key leaked or missing: %#v", alice.User)
	}

	bob, err := readState("report", "v-bob")
	if err != nil {
		t.Fatal(err)
	}
	if string(bob.Document["cut.analytics"]) != "true" {
		t.Fatal("document scope must be shared between viewers")
	}
	if string(bob.User["note"]) != `"bob's note"` {
		t.Fatalf("bob sees the wrong user value: %#v", bob.User)
	}

	// A viewer with no user keys still sees the document scope, and no one
	// else's keys.
	anon, err := readState("report", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(anon.User) != 0 || len(anon.Document) != 1 {
		t.Fatalf("unexpected anonymous view: %#v", anon)
	}
}

func TestStateDeleteAndClear(t *testing.T) {
	t.Setenv("LATTICE_DIR", t.TempDir())

	if _, err := applyState("report", "v-alice", []stateOp{
		{Key: "a", Value: json.RawMessage("1")},
		{Key: "b", Value: json.RawMessage("2")},
		{Key: "mine", Scope: scopeUser, Value: json.RawMessage("true")},
	}); err != nil {
		t.Fatal(err)
	}

	view, err := applyState("report", "v-alice", []stateOp{{Key: "a", Delete: true}})
	if err != nil {
		t.Fatal(err)
	}
	if _, still := view.Document["a"]; still {
		t.Fatalf("delete left the key behind: %#v", view.Document)
	}

	removed, err := clearState("report", scopeDocument, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("expected one document key cleared, got %d", removed)
	}
	after, err := readState("report", "v-alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Document) != 0 || string(after.User["mine"]) != "true" {
		t.Fatalf("clearing the document scope touched user keys: %#v", after)
	}

	if _, err := clearState("report", "", "", ""); err != nil {
		t.Fatal(err)
	}
	snapshot, err := stateSnapshot("report")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Document) != 0 || len(snapshot.Users) != 0 {
		t.Fatalf("state survived a full clear: %#v", snapshot)
	}
}

func TestStateRejectsBadWrites(t *testing.T) {
	t.Setenv("LATTICE_DIR", t.TempDir())

	if _, err := applyState("report", "", []stateOp{{Key: "k", Scope: scopeUser, Value: json.RawMessage("1")}}); err == nil {
		t.Fatal("user-scoped write without a viewer must fail")
	}
	if _, err := applyState("report", "v-alice", []stateOp{{Key: "  ", Value: json.RawMessage("1")}}); err == nil {
		t.Fatal("empty key must fail")
	}
	big := json.RawMessage(`"` + strings.Repeat("x", maxStateValueBytes) + `"`)
	if _, err := applyState("report", "v-alice", []stateOp{{Key: "k", Value: big}}); err == nil {
		t.Fatal("oversized value must fail")
	}
	if _, err := applyState("report", "not a viewer id!", []stateOp{{Key: "k", Value: json.RawMessage("1")}}); err == nil {
		t.Fatal("malformed viewer id must fail")
	}
	// A rejected batch must not have written anything.
	snapshot, err := stateSnapshot("report")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Document) != 0 {
		t.Fatalf("failed write still persisted: %#v", snapshot)
	}
}

func TestStateKeyLimitIsEnforced(t *testing.T) {
	t.Setenv("LATTICE_DIR", t.TempDir())

	// Fill the document scope to the brim, in batches the API accepts.
	for written := 0; written < maxStateKeys; {
		ops := make([]stateOp, 0, maxStateOps)
		for i := 0; i < maxStateOps && written < maxStateKeys; i++ {
			ops = append(ops, stateOp{Key: fmt.Sprintf("k%d", written), Value: json.RawMessage("1")})
			written++
		}
		if _, err := applyState("report", "", ops); err != nil {
			t.Fatal(err)
		}
	}
	// The library is at maxStateKeys - one more distinct key must be refused,
	// while overwriting an existing one still works.
	if _, err := applyState("report", "", []stateOp{{Key: "one-too-many", Value: json.RawMessage("1")}}); err == nil {
		t.Fatal("expected the key limit to be enforced")
	}
	if _, err := applyState("report", "", []stateOp{{Key: "k0", Value: json.RawMessage("2")}}); err != nil {
		t.Fatalf("overwriting an existing key must stay allowed: %v", err)
	}
}

func TestPruneStateViewersKeepsTheFreshest(t *testing.T) {
	doc := stateFile{Users: map[string]map[string]stateEntry{}}
	for i := 0; i < maxStateViewers+10; i++ {
		doc.Users[fmt.Sprintf("v-%d", i)] = map[string]stateEntry{
			"k": {Value: json.RawMessage("1"), Updated: int64(i)},
		}
	}
	pruneStateViewers(&doc)
	if len(doc.Users) != maxStateViewers {
		t.Fatalf("expected %d viewers after pruning, got %d", maxStateViewers, len(doc.Users))
	}
	if _, ok := doc.Users["v-0"]; ok {
		t.Fatal("the oldest viewer should have been pruned first")
	}
	if _, ok := doc.Users[fmt.Sprintf("v-%d", maxStateViewers+9)]; !ok {
		t.Fatal("the newest viewer must survive pruning")
	}
}
