package main

// extract.go - pull title, meta description and visible text out of a
// summary's HTML for the in-memory search index.

import (
	"io"
	"strings"

	"golang.org/x/net/html"
)

type extracted struct {
	Title       string
	Description string
	Text        string // visible text, whitespace-collapsed
}

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

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}
