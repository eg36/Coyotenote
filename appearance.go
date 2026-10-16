package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	colorful "github.com/lucasb-eyer/go-colorful"
)

type palette struct{ surface, chrome, text, muted, accent, cyan, good, warn, danger, line, pink, blue, onPill string }

func paletteFor(theme string) palette {
	if theme == "light" {
		return palette{"#FAF8F5", "#ECE8F0", "#343044", "#6C657A", "#7953B3", "#257A87", "#33744B", "#94610B", "#B43B55", "#C9C1D3", "#B8327A", "#3B63C4", "#FFFFFF"}
	}
	return palette{"#22252D", "#2D313D", "#DDE2EF", "#A3ADC2", "#C4A7FF", "#89DCEB", "#A6DA95", "#EED49F", "#F29BAA", "#475069", "#FF8CC6", "#8AADF4", "#1B1D24"}
}

// rainbow is the cycle of pill colors used for key hints.
func (p palette) rainbow() []string {
	return []string{p.accent, p.pink, p.warn, p.good, p.cyan, p.blue}
}

func ink(color string) lipgloss.Style { return lipgloss.NewStyle().Foreground(lipgloss.Color(color)) }

// pill renders bold text on a colored badge.
func pill(text, fg, bg string) string {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(fg)).Background(lipgloss.Color(bg)).Bold(true).Padding(0, 1).Render(text)
}

// blend returns n colors spread evenly across the stops, mixed in Luv space so
// the midpoints stay vivid instead of turning muddy.
func blend(n int, stops ...string) []string {
	out := make([]string, n)
	for i := range out {
		t := 0.0
		if n > 1 {
			t = float64(i) / float64(n-1) * float64(len(stops)-1)
		}
		j := min(int(t), len(stops)-2)
		a, _ := colorful.Hex(stops[j])
		b, _ := colorful.Hex(stops[j+1])
		out[i] = a.BlendLuv(b, t-float64(j)).Clamped().Hex()
	}
	return out
}

// gradient colors each character of text along the stops.
func gradient(text string, bold bool, stops ...string) string {
	runes := []rune(text)
	colors := blend(len(runes), stops...)
	var b strings.Builder
	for i, r := range runes {
		b.WriteString(ink(colors[i]).Bold(bold).Render(string(r)))
	}
	return b.String()
}

var sgr = regexp.MustCompile(`\x1b\[[0-9;:]*m`)

// setsBackground reports whether an SGR sequence chooses its own background.
// Extended colors are skipped as units, so a 48 inside "38;2;48;…" is not one.
func setsBackground(seq string) bool {
	params := strings.Split(seq[2:len(seq)-1], ";")
	for i := 0; i < len(params); i++ {
		v, _ := strconv.Atoi(params[i])
		switch {
		case v == 48:
			return true
		case v == 38 || v == 58:
			if i+1 < len(params) && params[i+1] == "5" {
				i += 2
			} else if i+1 < len(params) && params[i+1] == "2" {
				i += 4
			}
		case v >= 40 && v <= 47 || v >= 100 && v <= 107:
			return true
		}
	}
	return false
}

// Nested Charm components emit ANSI resets. A surrounding Lip Gloss style alone
// does not restore its background after those resets, leaving terminal-colored
// holes. Reapply this surface's background after every SGR that does not pick
// its own (badges keep theirs), and its foreground after full resets.
func paintBlock(content string, width, height int, fg, bg string) string {
	width = max(1, width)
	height = max(1, height)
	lines := strings.Split(content, "\n")
	out := make([]string, height)
	profile := lipgloss.ColorProfile()
	background, base := "", ""
	if c := profile.Color(bg); c != nil && c.Sequence(true) != "" {
		background = "\x1b[" + c.Sequence(true) + "m"
	}
	if c := profile.Color(fg); c != nil && c.Sequence(false) != "" {
		base = "\x1b[" + c.Sequence(false) + "m"
	}
	base += background
	for i := range out {
		line := ""
		if i < len(lines) {
			line = ansi.Truncate(lines[i], width, "")
		}
		line += strings.Repeat(" ", max(0, width-ansi.StringWidth(line)))
		if base != "" {
			line = sgr.ReplaceAllStringFunc(line, func(seq string) string {
				if seq == "\x1b[m" || seq == "\x1b[0m" {
					return seq + base
				}
				if setsBackground(seq) {
					return seq
				}
				return seq + background
			})
			line = base + line + "\x1b[0m"
		} else {
			line = ansi.Strip(line)
		}
		out[i] = line
	}
	return strings.Join(out, "\n")
}

// A static aurora bar: no animation loop or timer.
func aurora(p palette, cells int) string {
	return gradient(strings.Repeat("━", cells), false, p.accent, p.pink, p.warn, p.cyan)
}
func (m *model) header(p palette) string {
	width := m.width - 4
	mark := gradient("✦ coyotenote", true, p.accent, p.pink, p.cyan)
	position := "No notes"
	name := ""
	if len(m.notes) > 0 {
		position = fmt.Sprintf("%d/%d", m.index+1, len(m.notes))
		name = title(m.editor.Value())
	}
	left := mark + "  " + ink(p.blue).Bold(true).Render(position)
	mode, color := "EDIT", p.good
	switch {
	case m.mode == 1:
		mode, color = "PREVIEW", p.cyan
	case m.split():
		mode, color = "SPLIT", p.accent
	}
	right := pill(mode, p.onPill, color)
	if m.width >= 64 {
		right = ink(p.warn).Render(m.theme) + " " + right
	}
	if len(m.notes) > 0 {
		right = m.saveIndicator(p) + "  " + right
	}
	room := width - ansi.StringWidth(left) - ansi.StringWidth(right) - 4
	if room > 0 && name != "" {
		left += "  " + ink(p.text).Bold(true).Render(ansi.Truncate(name, room, "…"))
	}
	return paintBlock("  "+joinEdges(left, right, width)+"  ", m.width, 1, p.text, p.chrome)
}
func joinEdges(left, right string, width int) string {
	available := max(0, width-ansi.StringWidth(right)-1)
	left = ansi.Truncate(left, available, "…")
	return left + strings.Repeat(" ", max(1, width-ansi.StringWidth(left)-ansi.StringWidth(right))) + right
}
func (m *model) paneLabels(p palette) string {
	markdown := ink(p.accent).Bold(true).Render("✎ MARKDOWN")
	line := markdown
	if m.mode == 1 {
		line = ink(p.cyan).Bold(true).Render("◉ PREVIEW")
	}
	if m.split() {
		line = markdown + strings.Repeat(" ", max(0, m.editor.Width()-ansi.StringWidth(markdown))) + ink(p.line).Render(" │ ") + ink(p.cyan).Bold(true).Render("◉ PREVIEW")
	} else if m.mode == 2 {
		line += "  " + ink(p.muted).Italic(true).Render("split at 90+ columns")
	}
	return paintBlock("  "+line, m.width, 1, p.text, p.surface)
}

var headingLine = regexp.MustCompile(`^(#{1,6})(\s|$)`)

// headingColor matches the preview's Glamour colors for each heading level.
func (p palette) headingColor(level int) string {
	return []string{p.accent, p.pink, p.blue, p.good, p.warn, p.muted}[level-1]
}

// colorHeadings tints Markdown heading lines in the editor's rendered view. The
// textarea cannot style its own text, so the heading color and bold are
// reapplied after every SGR on those lines, keeping the surface background.
// A heading that soft-wraps is only colored on its first row.
func colorHeadings(view string, p palette) string {
	lines := strings.Split(view, "\n")
	for i, line := range lines {
		match := headingLine.FindStringSubmatch(ansi.Strip(line))
		if match == nil {
			continue
		}
		c := lipgloss.ColorProfile().Color(p.headingColor(len(match[1])))
		if c == nil || c.Sequence(false) == "" {
			continue
		}
		tint := "\x1b[" + c.Sequence(false) + ";1m"
		lines[i] = tint + sgr.ReplaceAllStringFunc(line, func(seq string) string { return seq + tint })
	}
	return strings.Join(lines, "\n")
}

// divider draws the split-view rule as a vertical violet-to-cyan gradient.
func divider(p palette, rows int) string {
	colors := blend(rows, p.accent, p.pink, p.cyan)
	lines := make([]string, rows)
	for i, c := range colors {
		lines[i] = ink(c).Render(" │ ")
	}
	return strings.Join(lines, "\n")
}

// saveIndicator is the header's compact save state; narrow windows show the icon only.
func (m *model) saveIndicator(p palette) string {
	color, icon, label := p.good, "●", "Saved"
	switch {
	case strings.Contains(m.status, "FAILED"):
		color, icon, label = p.danger, "!", "Not saved"
	case m.dirty:
		color, icon, label = p.warn, "○", "Unsaved"
	}
	if m.width < 64 {
		return ink(color).Bold(true).Render(icon)
	}
	return ink(color).Bold(true).Render(icon + " " + label)
}

// statusLine shows messages worth reading (errors, warnings, "Deleted"); the
// routine save state lives in the header so the bottom panel stays calm.
func (m *model) statusLine(p palette) string {
	cells := 4
	if m.width >= 64 {
		cells = 8
	}
	left := aurora(p, cells)
	switch {
	case m.status == "Saved" || m.status == "Unsaved…":
	case m.status == "Deleted":
		left += "  " + ink(p.muted).Render("· Deleted")
	case strings.Contains(m.status, "FAILED") || strings.HasPrefix(m.status, "Paste rejected"):
		left += "  " + pill("! "+m.status, p.onPill, p.danger)
	default:
		left += "  " + ink(p.warn).Render("! "+m.status)
	}
	right := ""
	if m.width >= 64 {
		words := len(strings.Fields(m.editor.Value()))
		right = ink(p.cyan).Bold(true).Render(strconv.Itoa(words)) + ink(p.muted).Render(" words · ") + ink(p.good).Bold(true).Render("LOCAL")
	}
	return paintBlock("  "+joinEdges(left, right, m.width-4), m.width, 1, p.text, p.chrome)
}

// keyHint is one footer entry; lower rank is dropped first when space runs out.
type keyHint struct {
	key, desc string
	rank      int
}

func (m *model) shortcutLine(p palette) string {
	hints := []keyHint{
		{"^N", "new", 3}, {"^D", "delete", 1}, {"Alt+↑↓", "notes", 2}, {"^P", "view", 2},
		{"^T", "theme", 1}, {"^S", "save", 0}, {"F1", "keys", 9}, {"^Q", "quit", 9},
	}
	colors := p.rainbow()
	render := func(hs []keyHint) string {
		parts := make([]string, len(hs))
		for i, h := range hs {
			parts[i] = pill(h.key, p.onPill, colors[i%len(colors)]) + " " + ink(p.muted).Render(h.desc)
		}
		return strings.Join(parts, "  ")
	}
	line := render(hints)
	for ansi.StringWidth(line) > m.width-4 && len(hints) > 2 {
		drop := 0
		for i, h := range hints {
			if h.rank < hints[drop].rank {
				drop = i
			}
		}
		hints = append(hints[:drop], hints[drop+1:]...)
		line = render(hints)
	}
	return paintBlock("  "+line, m.width, 1, p.text, p.chrome)
}

// helpView lists every key with a colored key column.
func (m *model) helpView(p palette) string {
	rows := [][2]string{
		{"Ctrl+N", "new note"}, {"Ctrl+D", "delete (asks first)"}, {"Alt+↑/↓", "previous / next note"},
		{"Ctrl+PgUp/PgDn", "previous / next note"}, {"Ctrl+P", "editor → preview → split"},
		{"Ctrl+T", "dark / light theme"}, {"Ctrl+S", "save now"}, {"Ctrl+Q / Ctrl+C", "save and quit"},
		{"F1 / Esc", "close this help"}, {"Alt/Ctrl+←/→", "move by word"}, {"↑↓ PgUp PgDn", "scroll preview"},
	}
	colors := p.rainbow()
	lines := []string{gradient("KEYS", true, p.accent, p.pink, p.cyan), ""}
	for i, r := range rows {
		k := ink(colors[i%len(colors)]).Bold(true).Width(17).Render(r[0])
		lines = append(lines, k+ink(p.text).Render(r[1]))
	}
	lines = append(lines, "", ink(p.muted).Italic(true).Render("Split: type in the editor; switch to preview to scroll."))
	return strings.Join(lines, "\n")
}
