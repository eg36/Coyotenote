package main

import (
	"html"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
)

var (
	imageTag   = regexp.MustCompile(`<img\b[^>]*alt="([^"]*)"[^>]*>`)
	imageLocal = regexp.MustCompile(`^<img src="/vault-file\?`)
)

// suppressImages keeps images of vault files and replaces the others with
// their alt text: remote ones, which would make a request, and missing ones.
func suppressImages(text string) string {
	return imageTag.ReplaceAllStringFunc(text, func(tag string) string {
		if imageLocal.MatchString(tag) {
			return strings.Replace(tag, "<img ", `<img loading="lazy" `, 1)
		}
		match := imageTag.FindStringSubmatch(tag)
		label := "image"
		if strings.Contains(tag, `src="missing:"`) {
			label = "missing image"
		}
		return `<span class="image-placeholder">[` + label + `: ` + html.EscapeString(html.UnescapeString(match[1])) + `]</span>`
	})
}

// headingIDs prefixes generated heading IDs with "h-" so a heading such as
// "# Modal" cannot shadow the app's own element IDs in the preview.
type headingIDs map[string]bool

func newHeadingIDs() parser.IDs { return headingIDs{} }

func (ids headingIDs) Generate(value []byte, _ ast.NodeKind) []byte {
	var slug strings.Builder
	for _, r := range strings.ToLower(string(value)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			slug.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			slug.WriteByte('-')
		}
	}
	base := "h-" + strings.Trim(slug.String(), "-")
	if base == "h-" {
		base = "h-heading"
	}
	id := base
	for i := 1; ids[id]; i++ {
		id = base + "-" + strconv.Itoa(i)
	}
	ids[id] = true
	return []byte(id)
}

func (ids headingIDs) Put(value []byte) { ids[string(value)] = true }
