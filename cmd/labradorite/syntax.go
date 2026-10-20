package main

import (
	"bytes"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	gast "github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Extended Markdown syntax for the preview, beyond GitHub Flavored Markdown.

// highlight is ==marked text==. A leading colour emoji, as in ==🔴text==,
// picks one of the named highlight colours instead of the default.
type highlight struct{ gast.BaseInline }

var kindHighlight = gast.NewNodeKind("Highlight")

func (n *highlight) Kind() gast.NodeKind { return kindHighlight }

func (n *highlight) Dump(source []byte, level int) { gast.DumpHelper(n, source, level, nil, nil) }

type highlightDelimiter struct{}

func (highlightDelimiter) IsDelimiter(b byte) bool { return b == '=' }

func (highlightDelimiter) CanOpenCloser(opener, closer *parser.Delimiter) bool {
	return opener.Char == closer.Char
}

func (highlightDelimiter) OnMatch(int) gast.Node { return &highlight{} }

type highlightParser struct{}

func (highlightParser) Trigger() []byte { return []byte{'='} }

// Parse accepts exactly two equals signs, so "a = b", "===" and setext
// heading underlines stay plain text.
func (highlightParser) Parse(_ gast.Node, block text.Reader, pc parser.Context) gast.Node {
	before := block.PrecendingCharacter()
	line, segment := block.PeekLine()
	node := parser.ScanDelimiter(line, before, 2, highlightDelimiter{})
	if node == nil || node.OriginalLength != 2 || before == '=' {
		return nil
	}
	node.Segment = segment.WithStop(segment.Start + node.OriginalLength)
	block.Advance(node.OriginalLength)
	pc.PushDelimiter(node)
	return node
}

func (highlightParser) CloseBlock(gast.Node, parser.Context) {}

var highlightColours = []struct{ emoji, name string }{
	{"🔴", "red"}, {"🟠", "orange"}, {"🟡", "yellow"},
	{"🟢", "green"}, {"🔵", "blue"}, {"🟣", "purple"},
}

// highlightColour moves a leading colour emoji from a highlight's text to
// its class.
type highlightColour struct{}

func (highlightColour) Transform(doc *gast.Document, reader text.Reader, _ parser.Context) {
	source := reader.Source()
	_ = gast.Walk(doc, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if !entering || n.Kind() != kindHighlight {
			return gast.WalkContinue, nil
		}
		first, ok := n.FirstChild().(*gast.Text)
		if !ok {
			return gast.WalkContinue, nil
		}
		value := first.Segment.Value(source)
		for _, c := range highlightColours {
			if bytes.HasPrefix(value, []byte(c.emoji)) {
				first.Segment = first.Segment.WithStart(first.Segment.Start + len(c.emoji))
				n.SetAttributeString("class", []byte("hl-"+c.name))
				break
			}
		}
		return gast.WalkContinue, nil
	})
}

type highlightRenderer struct{}

func (highlightRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindHighlight, func(w util.BufWriter, _ []byte, n gast.Node, entering bool) (gast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString("<mark")
			html.RenderAttributes(w, n, html.GlobalAttributeFilter)
			_ = w.WriteByte('>')
		} else {
			_, _ = w.WriteString("</mark>")
		}
		return gast.WalkContinue, nil
	})
}

type highlights struct{}

func (highlights) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(
		parser.WithInlineParsers(util.Prioritized(highlightParser{}, 500)),
		parser.WithASTTransformers(util.Prioritized(highlightColour{}, 500)),
	)
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(highlightRenderer{}, 500)))
}

// stripComments removes %%comments%% from Markdown before rendering: inline
// ones and blocks that span lines. Fenced code blocks and code spans keep
// their text, a backslash escapes the next character, and a %% with no
// closing %% after it stays as written.
func stripComments(body string) string {
	if !strings.Contains(body, "%%") {
		return body
	}
	var out strings.Builder
	fence := ""
	for i := 0; i < len(body); {
		if i == 0 || body[i-1] == '\n' {
			line := body[i:]
			if end := strings.IndexByte(line, '\n'); end >= 0 {
				line = line[:end+1]
			}
			if fence != "" || openingFence(line) != "" {
				if fence == "" {
					fence = openingFence(line)
				} else if closesFence(line, fence) {
					fence = ""
				}
				out.WriteString(line)
				i += len(line)
				continue
			}
		}
		switch c := body[i]; {
		case c == '\\' && i+1 < len(body):
			out.WriteString(body[i : i+2])
			i += 2
		case c == '`':
			end := codeSpanEnd(body, i)
			out.WriteString(body[i:end])
			i = end
		case strings.HasPrefix(body[i:], "%%"):
			end := strings.Index(body[i+2:], "%%")
			if end < 0 {
				out.WriteString(body[i:])
				i = len(body)
			} else {
				i += 2 + end + 2
			}
		default:
			out.WriteByte(c)
			i++
		}
	}
	return out.String()
}

// openingFence is the backtick or tilde run that opens a fenced code block
// on line, or "" when the line opens none.
func openingFence(line string) string {
	trimmed := strings.TrimLeft(line, " ")
	if len(line)-len(trimmed) > 3 || len(trimmed) < 3 || (trimmed[0] != '`' && trimmed[0] != '~') {
		return ""
	}
	n := 0
	for n < len(trimmed) && trimmed[n] == trimmed[0] {
		n++
	}
	if n < 3 || trimmed[0] == '`' && strings.ContainsRune(trimmed[n:], '`') {
		return ""
	}
	return trimmed[:n]
}

// closesFence reports whether line closes a block opened by fence: the same
// character, at least as many times, and nothing else.
func closesFence(line, fence string) bool {
	trimmed := strings.TrimLeft(line, " ")
	if len(line)-len(trimmed) > 3 {
		return false
	}
	n := 0
	for n < len(trimmed) && trimmed[n] == fence[0] {
		n++
	}
	return n >= len(fence) && strings.TrimSpace(trimmed[n:]) == ""
}

// codeSpanEnd is the index just past the code span starting at the backtick
// run at i, or past the run itself when no equal run closes it before a
// blank line.
func codeSpanEnd(body string, i int) int {
	n := 0
	for i+n < len(body) && body[i+n] == '`' {
		n++
	}
	limit := len(body)
	if blank := strings.Index(body[i:], "\n\n"); blank >= 0 {
		limit = i + blank
	}
	for j := i + n; j < limit; {
		if body[j] != '`' {
			j++
			continue
		}
		m := 0
		for j+m < limit && body[j+m] == '`' {
			m++
		}
		if m == n {
			return j + m
		}
		j += m
	}
	return i + n
}

// inlineFootnoteLabel prefixes the labels given to inline ^[footnotes], which
// the preview turns into ordinary numbered footnotes.
const inlineFootnoteLabel = "labradorite-inline-"

// inlineFootnotes rewrites each ^[text] outside code as a reference to a
// footnote definition appended to the note, so it is numbered and listed
// with the note's other footnotes.
func inlineFootnotes(body string) string {
	if !strings.Contains(body, "^[") {
		return body
	}
	var out, notes strings.Builder
	fence, count := "", 0
	for i := 0; i < len(body); {
		if i == 0 || body[i-1] == '\n' {
			line := body[i:]
			if end := strings.IndexByte(line, '\n'); end >= 0 {
				line = line[:end+1]
			}
			if fence != "" || openingFence(line) != "" {
				if fence == "" {
					fence = openingFence(line)
				} else if closesFence(line, fence) {
					fence = ""
				}
				out.WriteString(line)
				i += len(line)
				continue
			}
		}
		switch c := body[i]; {
		case c == '\\' && i+1 < len(body):
			out.WriteString(body[i : i+2])
			i += 2
		case c == '`':
			end := codeSpanEnd(body, i)
			out.WriteString(body[i:end])
			i = end
		case strings.HasPrefix(body[i:], "^["):
			end := closingBracket(body, i+1)
			if end < 0 || strings.TrimSpace(body[i+2:end]) == "" {
				out.WriteString("^[")
				i += 2
				continue
			}
			count++
			label := inlineFootnoteLabel + strconv.Itoa(count)
			out.WriteString("[^" + label + "]")
			notes.WriteString("\n\n[^" + label + "]: " + strings.Join(strings.Fields(body[i+2:end]), " "))
			i = end + 1
		default:
			out.WriteByte(c)
			i++
		}
	}
	return out.String() + notes.String()
}

// closingBracket is the index of the "]" matching the "[" at open, counting
// nested brackets and skipping escaped ones, or -1 when the paragraph ends
// first.
func closingBracket(body string, open int) int {
	depth := 0
	for j := open; j < len(body); j++ {
		switch body[j] {
		case '\\':
			j++
		case '[':
			depth++
		case ']':
			if depth--; depth == 0 {
				return j
			}
		case '\n':
			if strings.HasPrefix(body[j+1:], "\n") {
				return -1
			}
		}
	}
	return -1
}
