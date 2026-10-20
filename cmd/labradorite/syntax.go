package main

import (
	"bytes"

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
