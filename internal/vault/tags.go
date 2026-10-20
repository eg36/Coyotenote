package vault

import (
	"regexp"
	"sort"
	"strings"
)

var (
	frontMatter = regexp.MustCompile(`^\x{FEFF}?(---|\+\+\+)\r?\n((?s:.*?))\r?\n?(?:---|\+\+\+)[ \t]*(?:\r?\n|$)`)
	// An inline tag follows a space or the start of a line
	// and needs one character that is not a digit.
	inlineTag = regexp.MustCompile(`(?:^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)`)
	tagKey    = regexp.MustCompile(`(?i)^(tags?)\s*[:=]\s*(.*)$`)
	listItem  = regexp.MustCompile(`^\s*-\s+(.+)$`)
	codeSpan  = regexp.MustCompile("`+[^`\n]*`+")
)

// SplitFrontMatter separates a note's opening YAML or TOML front matter,
// delimiters included, from the text after it. Front is "" without one.
func SplitFrontMatter(body string) (front, text string) {
	if m := frontMatter.FindStringIndex(body); m != nil {
		return body[:m[1]], body[m[1]:]
	}
	return "", body
}

// Tags lists a note's tags: those named by a tags (or tag) property in its
// front matter and #tags in its text outside code, without the #. Letter
// case is ignored when merging; the first spelling is kept.
func Tags(body string) []string {
	seen := map[string]bool{}
	var tags []string
	add := func(tag string) {
		tag = strings.TrimPrefix(strings.Trim(strings.TrimSpace(tag), `"'`), "#")
		if tag == "" || seen[strings.ToLower(tag)] {
			return
		}
		seen[strings.ToLower(tag)] = true
		tags = append(tags, tag)
	}
	text := body
	if m := frontMatter.FindStringSubmatchIndex(body); m != nil {
		lines := strings.Split(strings.ReplaceAll(body[m[4]:m[5]], "\r\n", "\n"), "\n")
		for i := 0; i < len(lines); i++ {
			key := tagKey.FindStringSubmatch(lines[i])
			if key == nil {
				continue
			}
			value := strings.Trim(strings.TrimSpace(key[2]), "[]")
			for _, tag := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ' ' }) {
				add(tag)
			}
			for i+1 < len(lines) && listItem.MatchString(lines[i+1]) {
				i++
				add(listItem.FindStringSubmatch(lines[i])[1])
			}
		}
		text = body[m[1]:]
	}
	fence := ""
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			if fence == "" {
				fence = trimmed[:3]
			} else if strings.HasPrefix(trimmed, fence) {
				fence = ""
			}
			continue
		}
		// Most lines hold no tag; skip the regular expressions for them.
		if fence != "" || strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "\t") || !strings.Contains(line, "#") {
			continue
		}
		for _, m := range inlineTag.FindAllStringSubmatch(codeSpan.ReplaceAllString(line, " "), -1) {
			add(m[1])
		}
	}
	sort.Slice(tags, func(i, j int) bool { return strings.ToLower(tags[i]) < strings.ToLower(tags[j]) })
	return tags
}
