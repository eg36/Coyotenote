package main

import (
	"fmt"
	"strings"

	"github.com/alecthomas/chroma/v2"
	chromastyles "github.com/alecthomas/chroma/v2/styles"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type themeSpec struct {
	id, name string
	light    bool
	colors   palette
}

// Palettes are mapped to application roles; sources are linked in README.md.
// Preserve dark/light IDs so existing settings keep working.
var themes = []themeSpec{
	{"dark", "Coyote Dark", false, palette{"#22252D", "#2D313D", "#DDE2EF", "#A3ADC2", "#C4A7FF", "#89DCEB", "#A6DA95", "#EED49F", "#F29BAA", "#475069", "#FF8CC6", "#8AADF4", "#1B1D24"}},
	{"light", "Coyote Light", true, palette{"#FAF8F5", "#ECE8F0", "#343044", "#6C657A", "#7953B3", "#257A87", "#33744B", "#94610B", "#B43B55", "#C9C1D3", "#B8327A", "#3B63C4", "#FFFFFF"}},
	{"ayu-dark", "Ayu Dark", false, palette{"#10141C", "#0D1017", "#BFBDB6", "#92959C", "#E6B450", "#95E6CB", "#AAD94C", "#FFB454", "#F07178", "#273747", "#D2A6FF", "#59C2FF", "#0B0E14"}},
	{"ayu-mirage", "Ayu Mirage", false, palette{"#242936", "#1F2430", "#CCCAC2", "#959CA9", "#FFCC66", "#95E6CB", "#D5FF80", "#FFD173", "#F28779", "#3D4A66", "#DFBFFF", "#73D0FF", "#1F2430"}},
	{"ayu-light", "Ayu Light", true, palette{"#FCFCFC", "#F3F4F5", "#5C6166", "#707A85", "#A66700", "#167D7F", "#527A00", "#976000", "#C43D37", "#CFD8E3", "#8959A8", "#1674A5", "#FFFFFF"}},
	{"catppuccin-mocha", "Catppuccin Mocha", false, palette{"#1E1E2E", "#181825", "#CDD6F4", "#A6ADC8", "#CBA6F7", "#89DCEB", "#A6E3A1", "#F9E2AF", "#F38BA8", "#45475A", "#F5C2E7", "#89B4FA", "#11111B"}},
	{"catppuccin-macchiato", "Catppuccin Macchiato", false, palette{"#24273A", "#1E2030", "#CAD3F5", "#A5ADCB", "#C6A0F6", "#91D7E3", "#A6DA95", "#EED49F", "#ED8796", "#494D64", "#F5BDE6", "#8AADF4", "#181926"}},
	{"catppuccin-frappe", "Catppuccin Frappé", false, palette{"#303446", "#292C3C", "#C6D0F5", "#A5ADCE", "#CA9EE6", "#99D1DB", "#A6D189", "#E5C890", "#E78284", "#51576D", "#F4B8E4", "#8CAAEE", "#232634"}},
	{"catppuccin-latte", "Catppuccin Latte", true, palette{"#EFF1F5", "#E6E9EF", "#4C4F69", "#6C6F85", "#8839EF", "#187C86", "#347F22", "#99600C", "#D20F39", "#BCC0CC", "#A84391", "#1E66F5", "#FFFFFF"}},
	{"nord", "Nord", false, palette{"#2E3440", "#3B4252", "#ECEFF4", "#B8C2D4", "#B48EAD", "#88C0D0", "#A3BE8C", "#EBCB8B", "#BF616A", "#4C566A", "#B48EAD", "#81A1C1", "#2E3440"}},
	{"tokyo-night", "Tokyo Night", false, palette{"#1A1B26", "#16161E", "#C0CAF5", "#A9B1D6", "#BB9AF7", "#7DCFFF", "#9ECE6A", "#E0AF68", "#F7768E", "#3B4261", "#BB9AF7", "#7AA2F7", "#1A1B26"}},
	{"dracula", "Dracula", false, palette{"#282A36", "#21222C", "#F8F8F2", "#A9B2D0", "#BD93F9", "#8BE9FD", "#50FA7B", "#F1FA8C", "#FF5555", "#44475A", "#FF79C6", "#8BE9FD", "#282A36"}},
	{"gruvbox-dark", "Gruvbox Dark", false, palette{"#282828", "#1D2021", "#EBDBB2", "#BDAE93", "#D3869B", "#8EC07C", "#B8BB26", "#FABD2F", "#FB4934", "#504945", "#D3869B", "#83A598", "#282828"}},
	{"gruvbox-light", "Gruvbox Light", true, palette{"#FBF1C7", "#EBDBB2", "#3C3836", "#665C54", "#8F3F71", "#427B58", "#797400", "#925600", "#9D0006", "#D5C4A1", "#8F3F71", "#076678", "#FBF1C7"}},
}

func themeByID(id string) themeSpec {
	for _, t := range themes {
		if t.id == id {
			return t
		}
	}
	return themes[0]
}
func validTheme(id string) bool    { return themeByID(id).id == id }
func themeIsLight(id string) bool  { return themeByID(id).light }
func paletteFor(id string) palette { return themeByID(id).colors }

// Register once before any background render starts. Each theme has its own
// Chroma style, avoiding Glamour's shared first-theme-wins "charm" registry entry.
func init() {
	for _, theme := range themes {
		p := theme.colors
		chromastyles.Register(chroma.MustNewStyle("coyotenote-"+theme.id, chroma.StyleEntries{
			chroma.Background:      "bg:" + p.surface,
			chroma.Text:            p.text,
			chroma.Comment:         "italic " + p.muted,
			chroma.Keyword:         p.accent,
			chroma.KeywordType:     p.blue,
			chroma.Operator:        p.cyan,
			chroma.Punctuation:     p.text,
			chroma.Name:            p.text,
			chroma.NameBuiltin:     p.blue,
			chroma.NameFunction:    p.cyan,
			chroma.NameClass:       p.warn,
			chroma.LiteralString:   p.good,
			chroma.LiteralNumber:   p.pink,
			chroma.Error:           p.danger,
			chroma.GenericDeleted:  p.danger,
			chroma.GenericInserted: p.good,
		}))
	}
}

type themeChooser struct {
	input    textinput.Model
	original string
	matches  []int
	selected int
}

func (m *model) openThemePicker() tea.Cmd {
	m.editor.ClearSelection()
	m.complete = nil
	m.editor.Blur()
	input := textinput.New()
	input.Prompt = "Find "
	input.Placeholder = "Ayu, Catppuccin, Nord…"
	input.CharLimit = 80
	chooser := &themeChooser{input: input, original: m.theme}
	for i, t := range themes {
		chooser.matches = append(chooser.matches, i)
		if t.id == m.theme {
			chooser.selected = i
		}
	}
	m.themePicker = chooser
	return chooser.input.Focus()
}
func (m *model) closeThemePicker() {
	m.themePicker = nil
	if m.mode != 1 {
		m.editor.Focus()
	}
}
func (m *model) updateThemePicker(k tea.KeyMsg) tea.Cmd {
	chooser := m.themePicker
	switch k.String() {
	case "esc":
		m.theme = chooser.original
		m.applyTheme()
		m.closeThemePicker()
		return m.requestRender()
	case "enter":
		if len(chooser.matches) == 0 {
			return nil
		}
		id := themes[chooser.matches[chooser.selected]].id
		if err := atomicWrite(m.store.config, "theme", []byte(id)); err != nil {
			m.status = "Theme not saved: " + err.Error()
			return nil
		}
		m.theme = id
		m.applyTheme()
		m.closeThemePicker()
		m.status = "Theme: " + themeByID(id).name
		return m.requestRender()
	case "up", "down":
		if len(chooser.matches) == 0 {
			return nil
		}
		delta := 1
		if k.String() == "up" {
			delta = -1
		}
		chooser.selected = (chooser.selected + delta + len(chooser.matches)) % len(chooser.matches)
	default:
		var cmd tea.Cmd
		before := chooser.input.Value()
		chooser.input, cmd = chooser.input.Update(k)
		if before == chooser.input.Value() {
			return cmd
		}
		chooser.matches = nil
		chooser.selected = 0
		query := strings.ToLower(chooser.input.Value())
		for i, t := range themes {
			if strings.Contains(strings.ToLower(t.name+" "+t.id), query) {
				chooser.matches = append(chooser.matches, i)
			}
		}
	}
	if len(chooser.matches) > 0 {
		m.theme = themes[chooser.matches[chooser.selected]].id
		m.applyTheme()
	}
	return m.requestRender()
}
func (m *model) themePickerView(p palette) string {
	chooser := m.themePicker
	input := chooser.input
	base := ink(p.text).Background(lipgloss.Color(p.surface))
	input.TextStyle = base
	input.PromptStyle = base.Foreground(lipgloss.Color(p.accent))
	input.PlaceholderStyle = base.Foreground(lipgloss.Color(p.muted))
	input.Cursor.Style = base.Foreground(lipgloss.Color(p.accent))
	input.Width = max(1, m.width-12)
	rows := max(1, m.height-11)
	start := max(0, chooser.selected-rows+1)
	var lines []string
	lines = append(lines, input.View())
	for i := start; i < min(start+rows, len(chooser.matches)); i++ {
		t := themes[chooser.matches[i]]
		label := "  " + t.name
		if i == chooser.selected {
			label = "> " + t.name
		}
		mode := "dark"
		if t.light {
			mode = "light"
		}
		line := fmt.Sprintf("%-24s %s", label, mode)
		if i == chooser.selected {
			line = base.Background(lipgloss.Color(p.line)).Bold(true).Render(line)
		} else {
			line = base.Render(line)
		}
		lines = append(lines, line)
	}
	if len(chooser.matches) == 0 {
		lines = append(lines, base.Render("No matching themes"))
	}
	lines = append(lines, ink(p.muted).Render("↑↓ preview · Enter keep · Esc cancel"))
	return strings.Join(lines, "\n")
}
