package main

import (
	"bytes"
	"html"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Math is kept as escaped TeX until the browser loads its local renderer.
type inlineMath struct {
	ast.BaseInline
	value []byte
}

var kindInlineMath = ast.NewNodeKind("InlineMath")

func (n *inlineMath) Kind() ast.NodeKind            { return kindInlineMath }
func (n *inlineMath) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type inlineMathParser struct{}

func (inlineMathParser) Trigger() []byte { return []byte{'$'} }
func (inlineMathParser) Parse(_ ast.Node, reader text.Reader, _ parser.Context) ast.Node {
	line, _ := reader.PeekLine()
	if len(line) < 3 || line[1] == '$' || util.IsSpace(line[1]) || reader.PrecendingCharacter() == '$' {
		return nil
	}
	for i := 2; i < len(line); i++ {
		if line[i] == '\\' {
			i++
			continue
		}
		if line[i] != '$' {
			continue
		}
		// A closing dollar followed by a digit belongs to money, as in $5 and $6.
		if util.IsSpace(line[i-1]) || (i+1 < len(line) && (line[i+1] == '$' || line[i+1] >= '0' && line[i+1] <= '9')) {
			return nil
		}
		reader.Advance(i + 1)
		return &inlineMath{value: bytes.Clone(line[1:i])}
	}
	return nil
}
func (inlineMathParser) CloseBlock(ast.Node, parser.Context) {}

type blockMath struct {
	ast.BaseBlock
	value  []byte
	single bool
}

var kindBlockMath = ast.NewNodeKind("BlockMath")

func (n *blockMath) Kind() ast.NodeKind            { return kindBlockMath }
func (n *blockMath) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }
func (n *blockMath) IsRaw() bool                   { return true }

type blockMathParser struct{}

func (blockMathParser) Trigger() []byte { return []byte{'$'} }
func (blockMathParser) Open(_ ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, _ := reader.PeekLine()
	offset := pc.BlockOffset()
	if offset < 0 || offset > 3 {
		return nil, parser.NoChildren
	}
	trimmed := bytes.TrimSpace(line[offset:])
	if !bytes.HasPrefix(trimmed, []byte("$$")) {
		return nil, parser.NoChildren
	}
	if len(trimmed) > 4 && bytes.HasSuffix(trimmed, []byte("$$")) {
		return &blockMath{value: bytes.Clone(trimmed[2 : len(trimmed)-2]), single: true}, parser.NoChildren
	}
	if !bytes.Equal(trimmed, []byte("$$")) {
		return nil, parser.NoChildren
	}
	// An unmatched delimiter remains ordinary Markdown.
	lineNumber, position := reader.Position()
	closed := false
	for reader.AdvanceLine(); ; reader.AdvanceLine() {
		next, _ := reader.PeekLine()
		if next == nil {
			break
		}
		if bytes.Equal(bytes.TrimSpace(next), []byte("$$")) {
			closed = true
			break
		}
	}
	reader.SetPosition(lineNumber, position)
	if !closed {
		return nil, parser.NoChildren
	}
	return &blockMath{}, parser.NoChildren
}
func (blockMathParser) Continue(node ast.Node, reader text.Reader, _ parser.Context) parser.State {
	n := node.(*blockMath)
	if n.single {
		return parser.Close
	}
	line, segment := reader.PeekLine()
	if bytes.Equal(bytes.TrimSpace(line), []byte("$$")) {
		reader.Advance(len(line) - 1)
		return parser.Close
	}
	n.Lines().Append(segment)
	reader.Advance(len(line) - 1)
	return parser.Continue | parser.NoChildren
}
func (blockMathParser) Close(node ast.Node, reader text.Reader, _ parser.Context) {
	n := node.(*blockMath)
	if !n.single {
		n.value = bytes.Clone(n.Lines().Value(reader.Source()))
	}
}
func (blockMathParser) CanInterruptParagraph() bool { return true }
func (blockMathParser) CanAcceptIndentedLine() bool { return false }

type mathRenderer struct{}

func (mathRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindInlineMath, func(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString(`<span class="math">` + html.EscapeString(string(node.(*inlineMath).value)) + `</span>`)
		}
		return ast.WalkSkipChildren, nil
	})
	r.Register(kindBlockMath, func(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString("<div class=\"math\">" + html.EscapeString(strings.TrimSpace(string(node.(*blockMath).value))) + "</div>\n")
		}
		return ast.WalkSkipChildren, nil
	})
}

type maths struct{}

func (maths) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithInlineParsers(util.Prioritized(inlineMathParser{}, 150)), parser.WithBlockParsers(util.Prioritized(blockMathParser{}, 700)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(mathRenderer{}, 500)))
}
