package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"
)

// Interpret effective SGR background at each displayed cell. Comparing plain
// strings would miss the terminal-default holes caused by nested ANSI resets.
func cellBackgrounds(text string) [][]string {
	rows := [][]string{{}}
	bg := "default"
	for len(text) > 0 {
		seq, width, n, _ := ansi.DecodeSequence(text, 0, nil)
		if n == 0 {
			break
		}
		text = text[n:]
		if seq == "\n" {
			rows = append(rows, []string{})
			continue
		}
		if strings.HasPrefix(seq, "\x1b[") && strings.HasSuffix(seq, "m") {
			params := strings.Split(seq[2:len(seq)-1], ";")
			for i := 0; i < len(params); i++ {
				v, _ := strconv.Atoi(params[i])
				switch {
				case v == 0 || v == 49:
					bg = "default"
				case v == 48 || v == 38:
					if i+4 < len(params) && params[i+1] == "2" {
						r, _ := strconv.Atoi(params[i+2])
						g, _ := strconv.Atoi(params[i+3])
						b, _ := strconv.Atoi(params[i+4])
						if v == 48 {
							bg = fmt.Sprintf("#%02X%02X%02X", r, g, b)
						}
						i += 4
					} else if i+2 < len(params) && params[i+1] == "5" {
						if v == 48 {
							bg = "index:" + params[i+2]
						}
						i += 2
					}
				case v >= 40 && v <= 47 || v >= 100 && v <= 107:
					bg = "basic:" + params[i]
				}
			}
		}
		for j := 0; j < width; j++ {
			rows[len(rows)-1] = append(rows[len(rows)-1], bg)
		}
	}
	return rows
}

var hint = regexp.MustCompile(`F1\s+keys`)

func bgOf(color string) string {
	return cellBackgrounds(lipgloss.NewStyle().Background(lipgloss.Color(color)).Render("x"))[0][0]
}
func trueColor(t *testing.T) {
	t.Helper()
	old := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() { lipgloss.SetColorProfile(old) })
}
func TestAppearanceSurfacesAndResponsiveLayout(t *testing.T) {
	trueColor(t)
	m, err := newModel(testStore(t))
	if err != nil {
		t.Fatal(err)
	}
	press(m, tea.KeyCtrlN)
	m.editor.SetValue("# A quiet place\n\n**Write** something `small`.\n\n```go\nfmt.Println(\"hello\")\n```\n\n- [ ] Keep writing")
	for _, theme := range []string{"dark", "light", "dark"} {
		m.theme = theme
		m.applyTheme()
		p := paletteFor(theme)
		allowed := map[string]bool{}
		for _, c := range append(p.rainbow(), p.surface, p.chrome, p.danger, p.muted) {
			allowed[bgOf(c)] = true
		}
		for _, size := range [][2]int{{32, 10}, {40, 15}, {79, 24}, {80, 24}, {90, 24}, {101, 30}, {120, 40}} {
			for mode := 0; mode < 4; mode++ {
				m.mode = min(mode, 2)
				m.picker = nil
				if mode == 3 {
					m.openPicker()
				}
				m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
				settle(m)
				view := m.View()
				rows := cellBackgrounds(view)
				if len(rows) != size[1] {
					t.Fatalf("%s %v mode%d: %d rows", theme, size, mode, len(rows))
				}
				for y, row := range rows {
					if len(row) != size[0] {
						t.Fatalf("%s %v mode%d row%d: width %d", theme, size, mode, y, len(row))
					}
					want := p.surface
					if y == 0 || y >= size[1]-3 {
						want = p.chrome
					}
					// Badges may use palette colors, but nothing may fall through to
					// the terminal default, and every row starts and ends on its surface.
					want = bgOf(want)
					for x, bg := range row {
						if !allowed[bg] || (x == 0 || x == len(row)-1) && bg != want {
							t.Fatalf("%s %v mode%d cell%d,%d background %s want %s", theme, size, mode, x, y, bg, want)
						}
					}
				}
				lines := strings.Split(ansi.Strip(view), "\n")
				if strings.TrimSpace(lines[1]) != "" {
					t.Fatal("missing space below header")
				}
				if !hint.MatchString(lines[size[1]-2]) || !strings.Contains(lines[size[1]-2], "^Q  quit") {
					t.Fatal("essential hints clipped", lines[size[1]-2])
				}
				if m.split() && m.picker == nil {
					for y := 3; y < size[1]-4; y++ {
						if !strings.Contains(lines[y], "│") {
							t.Fatalf("divider missing on row %d", y)
						}
					}
				}
			}
		}
	}
}
func TestFooterColorsAndAlerts(t *testing.T) {
	trueColor(t)
	m, _ := newModel(testStore(t))
	p := paletteFor("dark")
	footer := m.shortcutLine(p)
	if !strings.Contains(footer, lipgloss.ColorProfile().Color(p.accent).Sequence(true)) || !strings.Contains(footer, lipgloss.ColorProfile().Color(p.muted).Sequence(false)) {
		t.Fatal("footer has no ANSI styling")
	}
	press(m, tea.KeyCtrlN)
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	for _, state := range []struct {
		status, badge string
		dirty         bool
	}{{"Saved", "● Saved", false}, {"Unsaved…", "○ Unsaved", true}, {"SAVE FAILED: read-only disk", "! Not saved", true}} {
		m.status, m.dirty = state.status, state.dirty
		header, status := ansi.Strip(m.header(p)), ansi.Strip(m.statusLine(p))
		if !strings.Contains(header, state.badge) {
			t.Fatalf("save indicator missing from header: %q", header)
		}
		// Routine save states stay out of the bottom panel; problems are shown there.
		if quiet := m.status != "Saved" && m.status != "Unsaved…"; strings.Contains(status, m.status) != quiet {
			t.Fatalf("status row for %q: %q", m.status, status)
		}
	}
}

func TestAppearanceWithoutColor(t *testing.T) {
	old := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.Ascii)
	t.Cleanup(func() { lipgloss.SetColorProfile(old) })
	m, err := newModel(testStore(t))
	if err != nil {
		t.Fatal(err)
	}
	press(m, tea.KeyCtrlN)
	m.editor.SetValue("# Title\n\n**Text** and `code`")
	m.mode = 1
	settle(m)
	view := m.View()
	if strings.Contains(view, "\x1b[") {
		t.Fatalf("color sequences in plain terminal output: %q", view)
	}
	for _, text := range []string{"Title", "Saved", "F1  keys", "^Q  quit"} {
		if !strings.Contains(view, text) {
			t.Fatalf("missing %s", text)
		}
	}
}

func TestEditorHeadingColors(t *testing.T) {
	trueColor(t)
	m, _ := newModel(testStore(t))
	press(m, tea.KeyCtrlN)
	m.editor.SetValue("# Title\n## Sub\nplain #tag")
	p := paletteFor("dark")
	for _, mode := range []int{0, 2} {
		m.mode = mode
		m.Update(tea.WindowSizeMsg{Width: 120, Height: 30})
		lines := strings.Split(m.View(), "\n")
		find := func(text string) string {
			for _, l := range lines[3:] { // skip the header, which repeats the title
				if strings.Contains(ansi.Strip(l), text) {
					return l
				}
			}
			t.Fatalf("mode%d: %q not shown", mode, text)
			return ""
		}
		seq := func(c string) string { return lipgloss.ColorProfile().Color(c).Sequence(false) + ";1m" }
		if !strings.Contains(find("Title"), seq(p.accent)) || !strings.Contains(find("Sub"), seq(p.pink)) {
			t.Fatalf("mode%d: heading lines not colored", mode)
		}
		if strings.Contains(find("plain #tag"), seq(p.accent)) || strings.Contains(find("plain #tag"), seq(p.pink)) {
			t.Fatalf("mode%d: body line colored", mode)
		}
	}
}
