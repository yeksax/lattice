package main

// pollagg.go - fold a slug's vote JSONL into per-question option counts.
//
// Privacy: this returns ONLY counts (never IP/UA/voter ids), so it is safe to
// expose on the public share endpoint. Dedup is last-write-wins per
// (voter, question), so an honest reload or a changed vote doesn't inflate the
// tally - the voter id is minted and persisted client-side by the poll bridge.
//
// Two submission shapes are understood, and may be mixed:
//   { voter, poll: "q1", choice: "a" }                  // one question per line
//   { voter, votes: { "q1": "a", "q2": "c" } }          // many at once

import "encoding/json"

type pollAgg struct {
	Polls  map[string]*questionAgg `json:"polls"`
	Voters int                     `json:"voters"`
}

type questionAgg struct {
	Total  int            `json:"total"`  // deduped votes for this question
	Counts map[string]int `json:"counts"` // choice → count
}

func aggregate(slug string) pollAgg {
	type key struct{ poll, voter string }
	latest := map[key]string{} // (question, voter) → most-recent choice

	for i, raw := range readSubmissions(slug) {
		var line struct {
			Data map[string]any `json:"data"`
		}
		if json.Unmarshal(raw, &line) != nil || line.Data == nil {
			continue
		}
		voter, _ := line.Data["voter"].(string)
		if voter == "" {
			voter = "_l" + itoa(i) // no id → count as its own vote (bridge always sets one)
		}
		if choice, ok := line.Data["choice"].(string); ok && choice != "" {
			poll, _ := line.Data["poll"].(string)
			if poll == "" {
				poll = "_"
			}
			latest[key{poll, voter}] = choice
		}
		if votes, ok := line.Data["votes"].(map[string]any); ok {
			for poll, c := range votes {
				if choice, ok := c.(string); ok && choice != "" {
					latest[key{poll, voter}] = choice
				}
			}
		}
	}

	agg := pollAgg{Polls: map[string]*questionAgg{}}
	voters := map[string]bool{}
	for k, choice := range latest {
		q := agg.Polls[k.poll]
		if q == nil {
			q = &questionAgg{Counts: map[string]int{}}
			agg.Polls[k.poll] = q
		}
		q.Counts[choice]++
		q.Total++
		voters[k.voter] = true
	}
	agg.Voters = len(voters)
	return agg
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
