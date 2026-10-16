package main

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

type palette struct{ surface, chrome, text, muted, accent, cyan, good, warn, danger, line string }

func paletteFor(theme string) palette {
	if theme == "light" {
		return palette{"#FAF8F5", "#ECE8F0", "#343044", "#6C657A", "#7953B3", "#257A87", "#33744B", "#94610B", "#B43B55", "#C9C1D3"}
	}
	return palette{"#22252D", "#2D313D", "#DDE2EF", "#A3ADC2", "#C4A7FF", "#89DCEB", "#A6DA95", "#EED49F", "#F29BAA", "#475069"}
}
func ink(color string) lipgloss.Style { return lipgloss.NewStyle().Foreground(lipgloss.Color(color)) }

var sgr = regexp.MustCompile(`\x1b\[[0-9;:]*m`)

// Nested Charm components emit ANSI resets. A surrounding Lip Gloss style alone
// does not restore its background after those resets, leaving terminal-colored
// holes. Reapply this surface's background after every SGR, and its foreground
// after full resets. Foreground syntax colors, emphasis and the cursor survive.
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

// A tiny static aurora: no animation loop, timer or new dependency.
func aurora(p palette) string {
	colors := []string{p.accent, "#AAAFF5", "#9AC5F0", p.cyan}
	if p.surface == paletteFor("light").surface {
		colors = []string{p.accent, "#6963B1", "#4B739C", p.cyan}
	}
	var b strings.Builder
	for _, c := range colors {
		b.WriteString(ink(c).Render("━"))
	}
	return b.String()
}
func (m *model) header(p palette) string {
	width := m.width - 4
	mark := ink(p.accent).Bold(true).Render("✦ coyotenote")
	position := "No notes"
	name := ""
	if len(m.notes) > 0 {
		position = fmt.Sprintf("%d/%d", m.index+1, len(m.notes))
		name = title(m.editor.Value())
	}
	left := mark + "  " + ink(p.muted).Render(position)
	mode := []string{"EDIT", "PREVIEW", "SPLIT"}[m.mode]
	if m.mode == 2 && !m.split() {
		mode = "EDIT"
	}
	right := ink(p.cyan).Bold(true).Render(mode)
	if m.width >= 64 {
		right += "  " + ink(p.muted).Render(m.theme)
	}
	room := width - ansi.StringWidth(left) - ansi.StringWidth(right) - 4
	if room > 0 && name != "" {
		left += "  " + ansi.Truncate(name, room, "…")
	}
	return paintBlock("  "+joinEdges(left, right, width)+"  ", m.width, 1, p.text, p.chrome)
}
func joinEdges(left, right string, width int) string {
	available := max(0, width-ansi.StringWidth(right)-1)
	left = ansi.Truncate(left, available, "…")
	return left + strings.Repeat(" ", max(1, width-ansi.StringWidth(left)-ansi.StringWidth(right))) + right
}
func (m *model) paneLabels(p palette) string {
	label := "MARKDOWN"
	if m.mode == 1 {
		label = "PREVIEW"
	}
	line := ink(p.muted).Render(label)
	if m.split() {
		line = ink(p.muted).Render("MARKDOWN" + strings.Repeat(" ", max(0, m.editor.Width()-len("MARKDOWN"))) + " │ PREVIEW")
	} else if m.mode == 2 {
		line += "  " + ink(p.muted).Render("split at 90+ columns")
	}
	return paintBlock("  "+line, m.width, 1, p.text, p.surface)
}
func (m *model) statusLine(p palette) string {
	color, icon := p.warn, "!"
	switch m.status {
	case "Saved":
		color, icon = p.good, "●"
	case "Unsaved…":
		color, icon = p.warn, "○"
	case "Deleted":
		color, icon = p.muted, "·"
	default:
		if strings.Contains(m.status, "FAILED") {
			color = p.danger
		}
	}
	left := aurora(p) + "  " + ink(color).Render(icon+" "+m.status)
	right := ""
	if m.width >= 64 {
		right = ink(p.muted).Render(fmt.Sprintf("%d words · LOCAL", len(strings.Fields(m.editor.Value()))))
	}
	return paintBlock("  "+joinEdges(left, right, m.width-4), m.width, 1, p.text, p.chrome)
}
func withHint(k key.Binding, label, description string) key.Binding {
	k.SetHelp(label, description)
	return k
}
func (m *model) shortcutLine(p palette) string {
	h := help.New()
	h.Width = m.width - 4
	h.ShortSeparator = "  "
	h.Styles.ShortKey = ink(p.cyan).Bold(true)
	h.Styles.ShortDesc = ink(p.muted)
	h.Styles.ShortSeparator = ink(p.line)
	h.Styles.Ellipsis = ink(p.accent)
	hints := []key.Binding{withHint(keys.new, "^N", "new"), withHint(keys.mode, "^P", "view"), withHint(keys.help, "F1", "keys"), withHint(keys.quit, "^Q", "quit")}
	if m.width >= 80 {
		hints = []key.Binding{
			withHint(keys.new, "^N", "new"), withHint(keys.del, "^D", "delete"), withHint(keys.next, "Alt+←/→", "notes"), withHint(keys.mode, "^P", "view"), withHint(keys.theme, "^T", "theme"), withHint(keys.help, "F1", "keys"), withHint(keys.quit, "^Q", "quit"),
		}
	} else if m.width < 40 {
		hints = []key.Binding{withHint(keys.new, "^N", "new"), withHint(keys.help, "F1", "keys"), withHint(keys.quit, "^Q", "quit")}
	}
	return paintBlock("  "+h.ShortHelpView(hints), m.width, 1, p.text, p.chrome)
}
