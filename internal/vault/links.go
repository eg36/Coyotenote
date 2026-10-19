package vault

import (
	"path"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// Link is one [[target#heading|alias]] in a note body. Offsets are bytes:
// Start is at "[[", End just after "]]", and the target as written, without
// heading or alias, spans TargetStart to TargetEnd.
type Link struct {
	Start, End, TargetStart, TargetEnd int
	Target, Heading, Alias             string
}

// ParseLinks finds wiki links in a note's text. Like the preview, it reads
// the note as CommonMark: links in code (fenced or indented blocks, in quotes
// and lists too, and code spans) are text, as is [[ after a backslash.
func ParseLinks(body string) []Link {
	if !strings.Contains(body, "[[") {
		return nil
	}
	code := codeRanges(body)
	var links []Link
	for i := 0; i < len(body); {
		at := strings.Index(body[i:], "[[")
		if at < 0 {
			break
		}
		start := i + at
		end := strings.Index(body[start+2:], "]]")
		inner := ""
		if end >= 0 {
			inner = body[start+2 : start+2+end]
		}
		if end < 0 || strings.ContainsAny(inner, "[]\n") || inCode(code, start) || escaped(body, start) {
			i = start + 2
			continue
		}
		raw, alias, _ := strings.Cut(inner, "|")
		rawTarget, heading, _ := strings.Cut(raw, "#")
		if target := strings.TrimSpace(rawTarget); target != "" {
			links = append(links, Link{start, start + end + 4, start + 2, start + 2 + len(rawTarget), target, strings.TrimSpace(heading), strings.TrimSpace(alias)})
		}
		i = start + end + 4
	}
	return links
}

// codeRanges lists the byte ranges of body that CommonMark reads as code.
// Text without backticks, tildes or indentation has none, so it is not parsed.
func codeRanges(body string) [][2]int {
	if !strings.ContainsAny(body, "`~\t") && !strings.Contains(body, "    ") {
		return nil
	}
	source := []byte(body)
	var ranges [][2]int
	_ = ast.Walk(parser.NewParser(parser.WithBlockParsers(parser.DefaultBlockParsers()...), parser.WithInlineParsers(parser.DefaultInlineParsers()...), parser.WithParagraphTransformers(parser.DefaultParagraphTransformers()...)).Parse(text.NewReader(source)), func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n.Kind() {
		case ast.KindFencedCodeBlock, ast.KindCodeBlock:
			lines := n.Lines()
			for i := 0; i < lines.Len(); i++ {
				segment := lines.At(i)
				ranges = append(ranges, [2]int{segment.Start, segment.Stop})
			}
			return ast.WalkSkipChildren, nil
		case ast.KindCodeSpan:
			for child := n.FirstChild(); child != nil; child = child.NextSibling() {
				if t, ok := child.(*ast.Text); ok {
					ranges = append(ranges, [2]int{t.Segment.Start, t.Segment.Stop})
				}
			}
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return ranges
}

func inCode(ranges [][2]int, at int) bool {
	for _, r := range ranges {
		if at >= r[0] && at < r[1] {
			return true
		}
	}
	return false
}

// escaped reports whether an odd run of backslashes precedes body[at].
func escaped(body string, at int) bool {
	run := 0
	for at-run-1 >= 0 && body[at-run-1] == '\\' {
		run++
	}
	return run%2 == 1
}

// Resolver maps link targets to note IDs the way Obsidian does: an exact path
// first, then a unique file name, preferring the linking note's own folder.
type Resolver struct {
	byPath map[string]string
	byBase map[string][]string
}

func NewResolver(notes []Note) Resolver {
	r := Resolver{make(map[string]string, len(notes)), make(map[string][]string, len(notes))}
	for _, n := range notes {
		lower := strings.ToLower(n.ID)
		r.byPath[lower] = n.ID
		base := path.Base(lower)
		r.byBase[base] = append(r.byBase[base], n.ID)
	}
	return r
}
func normalizeTarget(target string) string {
	t := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(target, `\`, "/")))
	return strings.TrimSuffix(strings.TrimPrefix(t, "/"), ".md")
}
func (r Resolver) Resolve(target, from string) (string, bool) {
	t := normalizeTarget(target)
	if id, ok := r.byPath[t]; ok {
		return id, true
	}
	best := ""
	for _, id := range r.byBase[path.Base(t)] {
		lower := strings.ToLower(id)
		if lower != t && !strings.HasSuffix(lower, "/"+t) {
			continue
		}
		if best == "" || closer(id, best, from) {
			best = id
		}
	}
	return best, best != ""
}

// closer reports whether a is a better match than b for a link in note from.
func closer(a, b, from string) bool {
	here := FolderOf(from)
	if (FolderOf(a) == here) != (FolderOf(b) == here) {
		return FolderOf(a) == here
	}
	if da, db := strings.Count(a, "/"), strings.Count(b, "/"); da != db {
		return da < db
	}
	return a < b
}

// ShortTarget is the shortest link text that resolves to id from note from.
func (r Resolver) ShortTarget(id, from string) string {
	if got, ok := r.Resolve(path.Base(id), from); ok && got == id {
		return path.Base(id)
	}
	return id
}

// LinkUpdate is a note as it was read, under its ID after a rename, and the
// body that keeps its links pointing at the same notes.
type LinkUpdate struct {
	Note Note
	Body string
}

// RenameLinks plans the link updates for renaming oldID to newID: every note
// with a link that resolved to a note before the rename and would resolve
// elsewhere afterwards. Notes whose links all still resolve are left out.
func RenameLinks(before []Note, oldID, newID string) []LinkUpdate {
	after := append([]Note{}, before...)
	for i := range after {
		if after[i].ID == oldID {
			after[i].ID = newID
		}
	}
	oldR, newR := NewResolver(before), NewResolver(after)
	var updates []LinkUpdate
	for i, n := range after {
		body := n.Body
		links := ParseLinks(body)
		for j := len(links) - 1; j >= 0; j-- {
			l := links[j]
			destination, ok := oldR.Resolve(l.Target, before[i].ID)
			if !ok {
				continue
			}
			if destination == oldID {
				destination = newID
			}
			if got, ok := newR.Resolve(l.Target, n.ID); ok && got == destination {
				continue
			}
			target := destination
			if !strings.Contains(l.Target, "/") {
				target = newR.ShortTarget(destination, n.ID)
			}
			body = body[:l.TargetStart] + target + body[l.TargetEnd:]
		}
		if body != n.Body {
			updates = append(updates, LinkUpdate{Note: n, Body: body})
		}
	}
	return updates
}
