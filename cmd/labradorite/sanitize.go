package main

import (
	"regexp"

	"github.com/microcosm-cc/bluemonday"
)

// previewPolicy is everything the preview may contain: the markup the
// renderer produces, and a short list of formatting HTML that notes may use,
// such as <u>, <sub> or <details>. Scripts, styles, frames, forms, event
// handlers and links other than web, mail or vault links are removed.
var previewPolicy = func() *bluemonday.Policy {
	p := bluemonday.NewPolicy()
	p.AllowElements(
		// Text and structure.
		"p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
		"ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
		"div", "span", "section", "sup", "sub",
		// Inline formatting, written as Markdown or as HTML.
		"strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "small", "kbd",
		"q", "cite", "abbr", "dfn", "var", "samp", "time",
		// Folding sections, callouts among them.
		"details", "summary",
	)
	p.AllowAttrs("href").OnElements("a")
	p.AllowURLSchemes("http", "https", "mailto")
	p.AllowRelativeURLs(true)
	p.RequireParseableURLs(true)
	// Pictures load only from the vault, never from another computer.
	p.AllowAttrs("src").Matching(regexp.MustCompile(`^/vault-file\?`)).OnElements("img")
	p.AllowAttrs("alt", "width", "height", "loading", "title").OnElements("img")
	p.AllowAttrs("type").Matching(regexp.MustCompile(`^checkbox$`)).OnElements("input")
	p.AllowAttrs("checked", "disabled").Matching(regexp.MustCompile(`^$`)).OnElements("input")
	p.AllowAttrs("open").Matching(regexp.MustCompile(`^$`)).OnElements("details")
	p.AllowAttrs("start").Matching(bluemonday.Integer).OnElements("ol")
	p.AllowAttrs("title").OnElements("abbr", "dfn", "span")
	p.AllowAttrs("datetime").OnElements("time")
	p.AllowStyles("text-align").MatchingEnum("left", "center", "right").OnElements("th", "td")
	// The renderer's classes, data attributes and roles, also allowed in
	// notes since they only change how text looks.
	p.AllowAttrs("class").Matching(regexp.MustCompile(`^[A-Za-z0-9_ -]+$`)).Globally()
	p.AllowDataAttributes()
	p.AllowAttrs("role").Matching(regexp.MustCompile(`^(doc-[a-z]+|img)$`)).Globally()
	p.AllowAttrs("aria-label", "aria-hidden").Globally()
	// Ids are limited to the preview's own anchors, so a note cannot give an
	// element the id of a part of the app.
	p.AllowAttrs("id").Matching(regexp.MustCompile(`^(h|b)-[\pL\pN_-]+$|^fn(ref)?:\d+$`)).Globally()
	return p
}()
