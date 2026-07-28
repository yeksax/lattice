package main

// extract.go - pull title, meta description and visible text out of a
// summary's HTML for the in-memory search index.

import (
	"io"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html"
)

type extracted struct {
	Title       string
	Description string
	Lede        string // first real paragraph, for pages with no meta description
	Text        string // visible text, whitespace-collapsed
}

// ledeMinRunes skips the one-word paragraphs summaries use as labels, kickers
// and stat captions: a lede has to be long enough to read as a sentence.
const ledeMinRunes = 60

func extractHTML(r io.Reader) extracted {
	var ex extracted
	doc, err := html.Parse(r)
	if err != nil {
		return ex
	}

	var text strings.Builder
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		switch n.Type {
		case html.ElementNode:
			switch n.Data {
			case "script", "style", "noscript", "template", "head":
				// head is handled explicitly below for title/meta
				if n.Data == "head" {
					for c := n.FirstChild; c != nil; c = c.NextSibling {
						if c.Type != html.ElementNode {
							continue
						}
						switch c.Data {
						case "title":
							if c.FirstChild != nil && ex.Title == "" {
								ex.Title = strings.TrimSpace(c.FirstChild.Data)
							}
						case "meta":
							if attr(c, "name") == "description" && ex.Description == "" {
								ex.Description = strings.TrimSpace(attr(c, "content"))
							}
						}
					}
				}
				return
			}
			if n.Data == "p" && ex.Lede == "" {
				if s := collapse(textOf(n)); utf8.RuneCountInString(s) >= ledeMinRunes {
					ex.Lede = s
				}
			}
		case html.TextNode:
			if s := strings.TrimSpace(n.Data); s != "" {
				text.WriteString(s)
				text.WriteByte(' ')
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	ex.Text = strings.Join(strings.Fields(text.String()), " ")
	return ex
}

// textOf returns the visible text under a node, scripts and styles excluded.
func textOf(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch node.Data {
			case "script", "style", "noscript", "template":
				return
			}
		}
		if node.Type == html.TextNode {
			b.WriteString(node.Data)
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}

func collapse(s string) string { return strings.Join(strings.Fields(s), " ") }

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}
