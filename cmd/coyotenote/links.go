package main

import (
	"fmt"
	"sort"
	"strings"

	"github.com/eg36/coyotenote/internal/vault"
)

// reindex rebuilds the backlinks of every note from the saved bodies.
func (m *model) reindex() {
	r := vault.NewResolver(m.notes)
	m.backlinks = make(map[string][]string)
	for _, n := range m.notes {
		seen := map[string]bool{}
		for _, l := range vault.ParseLinks(n.Body) {
			if id, ok := r.Resolve(l.Target, n.ID); ok && id != n.ID && !seen[id] {
				seen[id] = true
				m.backlinks[id] = append(m.backlinks[id], n.ID)
			}
		}
	}
	for _, ids := range m.backlinks {
		sort.Strings(ids)
	}
}

// rewriteLinks preserves resolved destinations across a rename, including
// outgoing links in moved notes and links affected by new name ambiguity.
// Notes changed on disk are left alone.
// It returns a status suffix describing the result.
func (m *model) rewriteLinks(old, id string) string {
	before := make([]vault.Note, len(m.notes))
	copy(before, m.notes)
	for i := range before {
		if before[i].ID == id {
			before[i].ID = old
		}
	}
	oldR, newR := vault.NewResolver(before), vault.NewResolver(m.notes)
	updated, current := 0, false
	var failed []string
	for i, n := range m.notes {
		from := before[i].ID
		body := n.Body
		links := vault.ParseLinks(body)
		for j := len(links) - 1; j >= 0; j-- {
			l := links[j]
			destination, ok := oldR.Resolve(l.Target, from)
			if !ok {
				continue
			}
			if destination == old {
				destination = id
			}
			if got, ok := newR.Resolve(l.Target, n.ID); ok && got == destination {
				continue
			}
			replacement := destination
			if !strings.Contains(l.Target, "/") {
				replacement = newR.ShortTarget(destination, n.ID)
			}
			body = body[:l.TargetStart] + replacement + body[l.TargetEnd:]
		}
		if body == n.Body {
			continue
		}
		if err := m.store.Save(n, body); err != nil {
			failed = append(failed, n.ID)
			continue
		}
		m.notes[i].Body = body
		updated++
		current = current || i == m.index
	}
	if current {
		m.loadNote()
	}
	status := ""
	if updated > 0 {
		status = fmt.Sprintf(" · links updated in %d notes", updated)
	}
	if len(failed) > 0 {
		status += " · could not update links in " + strings.Join(failed, ", ")
	}
	return status
}

// Preview link markers. Glamour passes these private-use runes through, and
// renderMarkdown swaps them for colors afterwards.
const (
	linkOpen    = ""
	missingOpen = ""
	linkClose   = ""
)

// markLinks replaces each link with its visible text between preview markers.
func markLinks(body string, r vault.Resolver, from string) string {
	links := vault.ParseLinks(body)
	for i := len(links) - 1; i >= 0; i-- {
		l := links[i]
		text := l.Alias
		if text == "" {
			text = l.Target
			if l.Heading != "" {
				text += " › " + l.Heading
			}
		}
		open := missingOpen
		if _, ok := r.Resolve(l.Target, from); ok {
			open = linkOpen
		}
		body = body[:l.Start] + open + text + linkClose + body[l.End:]
	}
	return body
}
