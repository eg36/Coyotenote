package main

import (
	"fmt"
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
		for _, size := range [][2]int{{32, 10}, {40, 15}, {79, 24}, {80, 24}, {90, 24}, {101, 30}, {120, 40}} {
			for mode := 0; mode < 3; mode++ {
				m.mode = mode
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
					want = cellBackgrounds(lipgloss.NewStyle().Background(lipgloss.Color(want)).Render("x"))[0][0]
					for x, bg := range row {
						if bg != strings.ToUpper(want) {
							t.Fatalf("%s %v mode%d cell%d,%d background %s want %s", theme, size, mode, x, y, bg, want)
						}
					}
				}
				lines := strings.Split(ansi.Strip(view), "\n")
				if strings.TrimSpace(lines[1]) != "" {
					t.Fatal("missing space below header")
				}
				if !strings.Contains(lines[size[1]-2], "F1 keys") || !strings.Contains(lines[size[1]-2], "^Q quit") {
					t.Fatal("essential hints clipped", lines[size[1]-2])
				}
				if m.split() {
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
	if !strings.Contains(footer, lipgloss.ColorProfile().Color(p.cyan).Sequence(false)) || !strings.Contains(footer, lipgloss.ColorProfile().Color(p.muted).Sequence(false)) {
		t.Fatal("footer has no ANSI styling")
	}
	for _, state := range []struct{ status, icon string }{{"Saved", "●"}, {"Unsaved…", "○"}, {"SAVE FAILED: read-only disk", "!"}} {
		m.status = state.status
		line := ansi.Strip(m.statusLine(p))
		if !strings.Contains(line, state.icon+" "+state.status) {
			t.Fatalf("lost status: %q", line)
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
	for _, text := range []string{"Title", "Saved", "F1 keys", "^Q quit"} {
		if !strings.Contains(view, text) {
			t.Fatalf("missing %s", text)
		}
	}
}
