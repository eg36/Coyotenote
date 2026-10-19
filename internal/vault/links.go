package vault

import (
	"path"
	"strings"
)

// Link is one [[target#heading|alias]] in a note body. Offsets are bytes:
// Start is at "[[", End just after "]]", and the target as written, without
// heading or alias, spans TargetStart to TargetEnd.
type Link struct {
	Start, End, TargetStart, TargetEnd int
	Target, Heading, Alias             string
}

// ParseLinks finds wiki links outside fenced code blocks and inline code spans.
func ParseLinks(body string) []Link {
	var links []Link
	fence := byte(0)
	fenceLen := 0
	offset := 0
	for _, line := range strings.SplitAfter(body, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		indent := len(line) - len(trimmed)
		ch, run := byte(0), 0
		if len(trimmed) > 0 && (trimmed[0] == '`' || trimmed[0] == '~') {
			ch = trimmed[0]
			for run < len(trimmed) && trimmed[run] == ch {
				run++
			}
		}
		switch {
		case fence != 0:
			if indent <= 3 && ch == fence && run >= fenceLen && strings.TrimSpace(trimmed[run:]) == "" {
				fence = 0
			}
		case indent <= 3 && run >= 3 && (ch != '`' || !strings.Contains(trimmed[run:], "`")):
			fence, fenceLen = ch, run
		default:
			links = append(links, lineLinks(line, offset)...)
		}
		offset += len(line)
	}
	return links
}

func lineLinks(line string, offset int) []Link {
	var links []Link
	for i := 0; i < len(line); {
		if line[i] == '`' {
			run := len(line[i:]) - len(strings.TrimLeft(line[i:], "`"))
			if end := strings.Index(line[i+run:], strings.Repeat("`", run)); end >= 0 {
				i += run + end + run
				continue
			}
			i += run
			continue
		}
		if !strings.HasPrefix(line[i:], "[[") {
			i++
			continue
		}
		end := strings.Index(line[i+2:], "]]")
		inner := ""
		if end >= 0 {
			inner = line[i+2 : i+2+end]
		}
		if end < 0 || strings.ContainsAny(inner, "[]\n") {
			i += 2
			continue
		}
		raw, alias, _ := strings.Cut(inner, "|")
		rawTarget, heading, _ := strings.Cut(raw, "#")
		if target := strings.TrimSpace(rawTarget); target != "" {
			start := offset + i
			links = append(links, Link{start, start + end + 4, start + 2, start + 2 + len(rawTarget), target, strings.TrimSpace(heading), strings.TrimSpace(alias)})
		}
		i += end + 4
	}
	return links
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
