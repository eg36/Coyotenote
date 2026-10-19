package main

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestThemeChooserPreviewCancelAndPersist(t *testing.T) {
	s := testStore(t)
	m, _ := newModel(s)
	press(m, tea.KeyCtrlT)
	typeText(m, "catppuccin mocha")
	if m.theme != "catppuccin-mocha" || m.themePicker == nil {
		t.Fatal("live preview", m.theme)
	}
	press(m, tea.KeyEsc)
	if m.theme != "dark" || m.themePicker != nil {
		t.Fatal("cancel didn't restore")
	}
	if _, err := os.Stat(filepath.Join(s.Config, "theme")); !os.IsNotExist(err) {
		t.Fatal("preview persisted")
	}
	press(m, tea.KeyCtrlT)
	typeText(m, "ayu mirage")
	press(m, tea.KeyEnter)
	assertFileBody(t, filepath.Join(s.Config, "theme"), "ayu-mirage")
	reopened, err := newModel(s)
	if err != nil || reopened.theme != "ayu-mirage" {
		t.Fatal("theme didn't reload", err)
	}
	press(m, tea.KeyCtrlT)
	typeText(m, "zzzz")
	press(m, tea.KeyEnter)
	if m.themePicker == nil || !strings.Contains(ansi.Strip(m.View()), "No matching themes") {
		t.Fatal("empty search")
	}
	press(m, tea.KeyEsc)
}
func TestThemePersistenceFailureKeepsChooserOpen(t *testing.T) {
	s := testStore(t)
	m, _ := newModel(s)
	s.Config = filepath.Join(t.TempDir(), "missing")
	press(m, tea.KeyCtrlT)
	typeText(m, "nord")
	press(m, tea.KeyEnter)
	if m.themePicker == nil || !strings.Contains(m.status, "not saved") {
		t.Fatal(m.status)
	}
	press(m, tea.KeyEsc)
	if m.theme != "dark" {
		t.Fatal("failure couldn't cancel")
	}
}
func TestAllThemesRenderPreviewAndReload(t *testing.T) {
	trueColor(t)
	s := testStore(t)
	seen := map[string]bool{}
	for _, theme := range themes {
		if seen[theme.id] {
			t.Fatal("duplicate theme", theme.id)
		}
		seen[theme.id] = true
		if err := os.WriteFile(filepath.Join(s.Config, "theme"), []byte(theme.id+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		m, err := newModel(s)
		if err != nil || m.theme != theme.id {
			t.Fatal(theme.id, err)
		}
		out, err := renderMarkdown("# Heading\n\n```go\n// hello\nfunc main() { println(42) }\n```", theme.id, 40)
		if err != nil || !strings.Contains(ansi.Strip(out), "println") {
			t.Fatal(theme.id, err)
		}
	}
	os.WriteFile(filepath.Join(s.Config, "theme"), []byte("unknown"), 0600)
	m, _ := newModel(s)
	if m.theme != "dark" {
		t.Fatal("unknown theme didn't fall back")
	}
}
func TestHelpScrollsToEveryShortcut(t *testing.T) {
	m, _ := editorModel(t, "abc")
	press(m, tea.KeyF1)
	for i := 0; i < 30; i++ {
		press(m, tea.KeyDown)
	}
	if !strings.Contains(ansi.Strip(m.View()), "copy / cut / paste") {
		t.Fatal("clipboard help unreachable")
	}
}
