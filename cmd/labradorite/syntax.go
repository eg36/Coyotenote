package main

import (
	"bytes"
	"html"
	"regexp"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	gast "github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	ghtml "github.com/yuin/goldmark/renderer/html"
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
			ghtml.RenderAttributes(w, n, ghtml.GlobalAttributeFilter)
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

// Callouts are blockquotes whose first line names a type, as in
// "> [!warning] Mind the gap". A "+" or "-" after the type makes the callout
// foldable, open or closed at first. The rest of the first line is the title,
// and the quote's remaining content is the body.
type callout struct {
	gast.BaseBlock
	kind, fold string
}

type calloutTitle struct{ gast.BaseBlock }

type calloutContent struct{ gast.BaseBlock }

var (
	kindCallout        = gast.NewNodeKind("Callout")
	kindCalloutTitle   = gast.NewNodeKind("CalloutTitle")
	kindCalloutContent = gast.NewNodeKind("CalloutContent")
)

func (n *callout) Kind() gast.NodeKind        { return kindCallout }
func (n *calloutTitle) Kind() gast.NodeKind   { return kindCalloutTitle }
func (n *calloutContent) Kind() gast.NodeKind { return kindCalloutContent }

func (n *callout) Dump(source []byte, level int) { gast.DumpHelper(n, source, level, nil, nil) }
func (n *calloutTitle) Dump(source []byte, level int) {
	gast.DumpHelper(n, source, level, nil, nil)
}
func (n *calloutContent) Dump(source []byte, level int) {
	gast.DumpHelper(n, source, level, nil, nil)
}

// calloutTypes maps every callout type and alias to the type it looks like
// and the icon it shows. Unknown types look like a note.
var calloutTypes = func() map[string][2]string {
	types := map[string][2]string{}
	for _, t := range []struct{ name, icon, aliases string }{
		{"note", "pen", ""}, {"abstract", "list", "summary tldr"}, {"info", "info", ""},
		{"todo", "checkSquare", ""}, {"tip", "flame", "hint important"},
		{"success", "check", "check done"}, {"question", "help", "help faq"},
		{"warning", "alert", "caution attention"}, {"failure", "close", "fail missing"},
		{"danger", "zap", "error"}, {"bug", "bug", ""}, {"example", "ordered", ""},
		{"quote", "quote", "cite"},
	} {
		for _, name := range append([]string{t.name}, strings.Fields(t.aliases)...) {
			types[name] = [2]string{t.name, t.icon}
		}
	}
	return types
}()

var calloutHead = regexp.MustCompile(`^\[!([^\]\s]+)\]([+-]?)[ \t]*`)

type calloutTransformer struct{}

func (calloutTransformer) Transform(doc *gast.Document, reader text.Reader, _ parser.Context) {
	source := reader.Source()
	var quotes []*gast.Blockquote
	_ = gast.Walk(doc, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if q, ok := n.(*gast.Blockquote); ok && entering {
			quotes = append(quotes, q)
		}
		return gast.WalkContinue, nil
	})
	for _, q := range quotes {
		first, ok := q.FirstChild().(*gast.Paragraph)
		if !ok || first.Lines().Len() == 0 {
			continue
		}
		line := first.Lines().At(0)
		head := calloutHead.FindSubmatchIndex(line.Value(source))
		if head == nil {
			continue
		}
		c := &callout{kind: strings.ToLower(string(line.Value(source)[head[2]:head[3]])), fold: string(line.Value(source)[head[4]:head[5]])}
		// The title is the first line after the type, as parsed inline.
		title := &calloutTitle{}
		prefixEnd := line.Start + head[1]
		for n := first.FirstChild(); n != nil; {
			next := n.NextSibling()
			t, isText := n.(*gast.Text)
			lineEnds := isText && (t.SoftLineBreak() || t.HardLineBreak())
			first.RemoveChild(first, n)
			if !isText || t.Segment.Stop > prefixEnd {
				if isText {
					t.Segment = t.Segment.WithStart(max(t.Segment.Start, prefixEnd))
					t.SetSoftLineBreak(false)
					t.SetHardLineBreak(false)
				}
				title.AppendChild(title, n)
			}
			if lineEnds {
				break
			}
			n = next
		}
		content := &calloutContent{}
		if first.HasChildren() {
			content.AppendChild(content, first)
		} else {
			q.RemoveChild(q, first)
		}
		for n := q.FirstChild(); n != nil; {
			next := n.NextSibling()
			if n != first {
				content.AppendChild(content, n)
			}
			n = next
		}
		c.AppendChild(c, title)
		if content.HasChildren() {
			c.AppendChild(c, content)
		}
		q.Parent().ReplaceChild(q.Parent(), q, c)
	}
}

type calloutRenderer struct{}

func (calloutRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindCallout, func(w util.BufWriter, _ []byte, n gast.Node, entering bool) (gast.WalkStatus, error) {
		c := n.(*callout)
		tag := "div"
		if c.fold != "" {
			tag = "details"
		}
		if !entering {
			_, _ = w.WriteString("</" + tag + ">\n")
			return gast.WalkContinue, nil
		}
		look, ok := calloutTypes[c.kind]
		if !ok {
			look = calloutTypes["note"]
		}
		_, _ = w.WriteString("<" + tag + ` class="callout callout-` + look[0] + `" data-callout="` + html.EscapeString(c.kind) + `"`)
		if c.fold == "+" {
			_, _ = w.WriteString(" open")
		}
		_, _ = w.WriteString(">\n")
		return gast.WalkContinue, nil
	})
	reg.Register(kindCalloutTitle, func(w util.BufWriter, _ []byte, n gast.Node, entering bool) (gast.WalkStatus, error) {
		c := n.Parent().(*callout)
		tag := "div"
		if c.fold != "" {
			tag = "summary"
		}
		if !entering {
			_, _ = w.WriteString("</span></" + tag + ">\n")
			return gast.WalkContinue, nil
		}
		look, ok := calloutTypes[c.kind]
		if !ok {
			look = calloutTypes["note"]
		}
		_, _ = w.WriteString("<" + tag + ` class="callout-title"><span class="callout-icon" data-icon="` + look[1] + `"></span><span class="callout-title-text">`)
		if !n.HasChildren() {
			_, _ = w.WriteString(html.EscapeString(strings.ToUpper(c.kind[:1]) + c.kind[1:]))
		}
		return gast.WalkContinue, nil
	})
	reg.Register(kindCalloutContent, func(w util.BufWriter, _ []byte, _ gast.Node, entering bool) (gast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString("<div class=\"callout-content\">\n")
		} else {
			_, _ = w.WriteString("</div>\n")
		}
		return gast.WalkContinue, nil
	})
}

type callouts struct{}

func (callouts) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(calloutTransformer{}, 600)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(calloutRenderer{}, 500)))
}
