package main

import (
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// markdownForegrounds records the effective foreground, including cursor SGRs.
func markdownForegrounds(text string) []string {
	var cells []string
	fg := "default"
	for len(text) > 0 {
		seq, width, n, _ := ansi.DecodeSequence(text, 0, nil)
		if n == 0 {
			break
		}
		text = text[n:]
		if strings.HasPrefix(seq, "\x1b[") && strings.HasSuffix(seq, "m") {
			params := strings.Split(seq[2:len(seq)-1], ";")
			for i := 0; i < len(params); i++ {
				value, _ := strconv.Atoi(params[i])
				if value == 0 || value == 39 {
					fg = "default"
				}
				if (value == 38 || value == 48) && i+4 < len(params) && params[i+1] == "2" {
					if value == 38 {
						r, _ := strconv.Atoi(params[i+2])
						g, _ := strconv.Atoi(params[i+3])
						b, _ := strconv.Atoi(params[i+4])
						fg = fmt.Sprintf("#%02X%02X%02X", r, g, b)
					}
					i += 4
				}
			}
		}
		for j := 0; j < width; j++ {
			cells = append(cells, fg)
		}
	}
	return cells
}

func TestEditorMarkdownSpans(t *testing.T) {
	trueColor(t)
	for _, theme := range []string{"dark", "light"} {
		p := paletteFor(theme)
		for _, tc := range []struct{ body, marked, color string }{
			{"- item", "-", p.accent}, {"  + item", "+", p.accent}, {"* item", "*", p.accent},
			{"12. item", "12.", p.accent}, {"> quote", "> quote", p.muted},
			{"before `code` after", "`code`", p.cyan},
			{"before **bold** after", "**bold**", p.accent},
			{"界 **bold** after", "**bold**", p.accent},
			{"plain #tag", "", p.text},
		} {
			start := strings.Index(tc.body, tc.marked)
			// Exercise both marker cells, inside the span, and the adjacent text.
			for _, cursor := range []int{0, start, start + 1, start + len(tc.marked) - 1, start + len(tc.marked), len(tc.body) - 1} {
				if cursor < 0 || cursor >= len(tc.body) || tc.body[cursor] >= 128 {
					continue
				}
				// A textarea cursor explicitly chooses a foreground and background.
				line := ink(p.text).Render(tc.body[:cursor]) + lipgloss.NewStyle().Foreground(lipgloss.Color(p.surface)).Background(lipgloss.Color(p.text)).Render(tc.body[cursor:cursor+1]) + ink(p.text).Render(tc.body[cursor+1:])
				got := colorMarkdown(line, p)
				if ansi.Strip(got) != tc.body {
					t.Fatalf("text changed: %q", got)
				}
				colors := markdownForegrounds(got)
				first, last := ansi.StringWidth(tc.body[:start]), ansi.StringWidth(tc.body[:start+len(tc.marked)])
				for column := first; column < last; column++ {
					if colors[column] != markdownForegrounds(ink(tc.color).Render("x"))[0] {
						t.Fatalf("%s %q cursor%d cell%d: %s want %s", theme, tc.body, cursor, column, colors[column], tc.color)
					}
				}
				if tc.marked == "" && got != line {
					t.Fatal("plain line changed")
				}
				beforeBG, afterBG := cellBackgrounds(line), cellBackgrounds(got)
				for column, bg := range beforeBG[0] {
					if afterBG[0][column] != bg {
						t.Fatalf("cursor background changed for %q at %d", tc.body, column)
					}
				}
				if tc.marked != "" && last < len(colors) && last != ansi.StringWidth(tc.body[:cursor]) && colors[last] != markdownForegrounds(ink(p.text).Render("x"))[0] {
					t.Fatalf("highlight leaked past %q: %s", tc.marked, colors[last])
				}
			}
		}
	}
}
