package main

import (
	"crypto/rand"
	"encoding/hex"
	"html"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/eg36/labradorite/internal/vault"
)

// maxEmbedDepth is how many notes deep ![[Note]] embeds are shown; deeper
// ones, and notes that would embed themselves, show as a link.
const maxEmbedDepth = 2

// A page shows at most maxEmbeds embedded notes and maxEmbedBytes of their
// HTML, however they nest or repeat; further embeds show as links. Without
// this, a short note repeating a long embed could render megabytes while
// every other request waits.
const (
	maxEmbeds     = 64
	maxEmbedBytes = 2 << 20
)

// embedBudget is what is left of a page's embed allowance. A note embedded
// again inside the same notes is rendered once.
type embedBudget struct {
	notes, bytes int
	shown        map[string]string
}

// embedNonce makes embed placeholders unguessable, so text in a note cannot
// pose as one.
var embedNonce = func() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}()

// embedToken is a placeholder for the n-th embed of a note: letters and
// digits only, so Markdown leaves it as plain text.
func embedToken(n int) string { return "lbembed" + embedNonce + "x" + strconv.Itoa(n) + "x" }

// escapedAt reports whether an odd run of backslashes precedes body[at].
func escapedAt(body string, at int) bool {
	run := 0
	for at-run-1 >= 0 && body[at-run-1] == '\\' {
		run++
	}
	return run%2 == 1
}

// embedNote renders the note, heading section or block that the embed l
// points to, framed with a link to it.
func (a *webApp) embedNote(l vault.Link, from string, notes []vault.Note, resolver vault.Resolver, embedding map[string]bool, budget *embedBudget) string {
	if web := a.embedWeb(l); web != "" {
		return web
	}
	if media := a.embedMedia(l, from); media != "" {
		return media
	}
	id, found := resolver.Resolve(l.Target, from)
	label := l.Alias
	if label == "" {
		label = l.Target
		if l.Heading != "" {
			label += " › " + strings.TrimPrefix(l.Heading, "^")
		}
	}
	href := "/?note=" + url.QueryEscape(id)
	if l.Heading != "" {
		href += "#" + url.PathEscape(l.Heading)
	}
	title := `<a class="embed-title" href="` + html.EscapeString(href) + `">` + html.EscapeString(label) + "</a>"
	if !found {
		return `<div class="embed embed-missing">` + html.EscapeString(label) + " — this note does not exist yet</div>\n"
	}
	if embedding[id] || len(embedding) > maxEmbedDepth {
		return `<div class="embed embed-link">` + title + "</div>\n"
	}
	if budget.notes <= 0 || budget.bytes <= 0 {
		return `<div class="embed embed-link">` + title + " — not shown: this page already embeds as much as it can</div>\n"
	}
	// What an embed shows depends on the notes it sits inside.
	inside := make([]string, 0, len(embedding))
	for note := range embedding {
		inside = append(inside, note)
	}
	sort.Strings(inside)
	key := strings.Join(inside, "\x00") + "\x01" + id + "\x01" + l.Heading
	if shown, ok := budget.shown[key]; ok {
		budget.notes--
		budget.bytes -= len(shown)
		return shown
	}
	body := ""
	for _, n := range notes {
		if n.ID == id {
			body = n.Body
			break
		}
	}
	_, body = vault.SplitFrontMatter(body)
	if l.Heading != "" {
		section, ok := noteSection(body, l.Heading)
		if !ok {
			return `<div class="embed embed-missing">` + title + " — not found in that note</div>\n"
		}
		body = section
	}
	inner := map[string]bool{id: true}
	for note := range embedding {
		inner[note] = true
	}
	budget.notes--
	rendered, err := a.renderEmbedding(body, id, notes, inner, budget)
	if err != nil {
		rendered = "<p>" + html.EscapeString(err.Error()) + "</p>"
	}
	shown := `<div class="embed" data-note="` + html.EscapeString(id) + `">` + title + `<div class="embed-content">` + rendered + "</div></div>\n"
	budget.bytes -= len(shown)
	budget.shown[key] = shown
	return shown
}

var atxHeading = regexp.MustCompile(`^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$`)

// noteSection is the part of body that a link to heading points at: a
// heading with everything up to the next heading of the same or a higher
// level, or for "^id" the paragraph or list item ending with that block id.
func noteSection(body, heading string) (string, bool) {
	lines := strings.SplitAfter(body, "\n")
	inCode := make([]bool, len(lines))
	fence := ""
	for i, line := range lines {
		switch {
		case fence != "":
			inCode[i] = true
			if closesFence(line, fence) {
				fence = ""
			}
		case openingFence(line) != "":
			inCode[i], fence = true, openingFence(line)
		}
	}
	if id, ok := strings.CutPrefix(heading, "^"); ok {
		mark := regexp.MustCompile(`(?:^|[ \t])\^` + regexp.QuoteMeta(id) + `[ \t]*\r?\n?$`)
		for i, line := range lines {
			if inCode[i] || !mark.MatchString(line) {
				continue
			}
			start := i
			if !listItem.MatchString(line) {
				for start > 0 && strings.TrimSpace(lines[start-1]) != "" && !inCode[start-1] {
					start--
				}
			}
			return strings.Join(lines[start:i+1], ""), true
		}
		return "", false
	}
	want := headingID(heading)
	for i, line := range lines {
		m := atxHeading.FindStringSubmatch(strings.TrimRight(line, "\r\n"))
		if inCode[i] || m == nil || (!strings.EqualFold(m[2], heading) && headingID(m[2]) != want) {
			continue
		}
		end := i + 1
		for ; end < len(lines); end++ {
			if next := atxHeading.FindStringSubmatch(strings.TrimRight(lines[end], "\r\n")); next != nil && !inCode[end] && len(next[1]) <= len(m[1]) {
				break
			}
		}
		return strings.Join(lines[i:end], ""), true
	}
	return "", false
}

var listItem = regexp.MustCompile(`^\s*(?:[-*+]|\d+[.)])[ \t]`)

// embedMedia shows ![[file.pdf]], ![[talk.mp3]] or ![[clip.mp4]] with the
// browser's own viewer or player, or returns "" for other targets.
func (a *webApp) embedMedia(l vault.Link, from string) string {
	kind := vault.MediaType(l.Target)
	if kind == "" {
		return ""
	}
	rel, found := a.store.ResolveFile(l.Target, from)
	if !found {
		rel, found = a.store.FindFile(l.Target)
	}
	label := l.Alias
	if label == "" {
		label = path.Base(l.Target)
	}
	if !found {
		return `<div class="embed embed-missing">` + html.EscapeString(label) + " — this file is not in the vault</div>\n"
	}
	src := html.EscapeString(fileURL("", rel))
	caption := `<figcaption>` + html.EscapeString(label) + `</figcaption>`
	switch {
	case kind == "application/pdf":
		return `<figure class="media-embed media-pdf"><iframe src="` + src + `" title="` + html.EscapeString(label) + `" loading="lazy"></iframe>` + caption + "</figure>\n"
	case strings.HasPrefix(kind, "audio/"):
		return `<figure class="media-embed media-audio"><audio controls preload="metadata" src="` + src + `"></audio>` + caption + "</figure>\n"
	default:
		return `<figure class="media-embed media-video"><video controls preload="metadata" src="` + src + `"></video>` + caption + "</figure>\n"
	}
}
