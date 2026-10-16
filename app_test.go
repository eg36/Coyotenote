package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func testStore(t *testing.T) *store {
	t.Helper()
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.close)
	return s
}
func press(m *model, k tea.KeyType) { m.Update(tea.KeyMsg{Type: k}) }
func TestCreateEditNavigateDelete(t *testing.T) {
	s := testStore(t)
	m, err := newModel(s)
	if err != nil {
		t.Fatal(err)
	}
	press(m, tea.KeyCtrlN)
	if len(m.notes) != 1 {
		t.Fatal("create")
	}
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("# First\nhello 世界")})
	if !m.dirty {
		t.Fatal("edit was not dirty")
	}
	stale := m.revision - 1
	m.Update(saveMsg(stale))
	if !m.dirty {
		t.Fatal("stale debounce saved")
	}
	m.Update(saveMsg(m.revision))
	if m.dirty {
		t.Fatal(m.status)
	}
	press(m, tea.KeyCtrlN)
	m.navigate(-1)
	if !strings.Contains(m.editor.Value(), "hello 世界") {
		t.Fatal("navigation lost edit")
	}
	m.navigate(-1)
	if m.index != 1 {
		t.Fatal("wrap")
	}
	press(m, tea.KeyCtrlD)
	m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if len(m.notes) != 2 {
		t.Fatal("cancel deleted")
	}
	press(m, tea.KeyCtrlD)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	if len(m.notes) != 1 {
		t.Fatal("delete")
	}
	loaded, _, err := s.load()
	if err != nil || len(loaded) != 1 || !strings.Contains(loaded[0].Body, "hello 世界") {
		t.Fatalf("persistence: %v %v", loaded, err)
	}
}
func TestInterruptedWriteRecovery(t *testing.T) {
	s := testStore(t)
	n, err := s.create()
	if err != nil {
		t.Fatal(err)
	}
	if err = s.save(n, "committed"); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(s.dir, ".pending-interrupted"), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	notes, orphans, err := s.load()
	if err != nil || orphans != 1 || len(notes) != 1 || notes[0].Body != "committed" {
		t.Fatalf("recovery %v %d %v", notes, orphans, err)
	}
	if _, err = os.Stat(filepath.Join(s.dir, ".pending-interrupted")); err != nil {
		t.Fatal("recovery evidence removed")
	}
	m, err := newModel(s)
	if err != nil || !strings.Contains(m.status, "interrupted-write") {
		t.Fatalf("warning %v", err)
	}
}
func TestConflictAndFailedSaveBlockNavigation(t *testing.T) {
	s := testStore(t)
	m, _ := newModel(s)
	press(m, tea.KeyCtrlN)
	press(m, tea.KeyCtrlN)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("local")})
	if err := os.WriteFile(filepath.Join(s.dir, m.notes[m.index].ID+".md"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	m.navigate(-1)
	if m.index != 1 || !m.dirty || !strings.Contains(m.status, "SAVE FAILED") {
		t.Fatal("save failure not retained")
	}
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlQ})
	if cmd != nil {
		t.Fatal("quit despite failed save")
	}
}
func TestMarkdownRenderingAndSizes(t *testing.T) {
	for _, theme := range []string{"dark", "light"} {
		out, err := renderMarkdown("# Hello\n\n**bold** and `code`\n\n- item\n\n> quote", theme, 40)
		if err != nil {
			t.Fatal(err)
		}
		plain := ansi.Strip(out)
		for _, word := range []string{"Hello", "bold", "code", "item", "quote"} {
			if !strings.Contains(plain, word) {
				t.Fatalf("missing %s", word)
			}
		}
		if strings.Contains(plain, "**bold**") {
			t.Fatal("not rendered")
		}
	}
	s := testStore(t)
	m, _ := newModel(s)
	press(m, tea.KeyCtrlN)
	for _, size := range [][2]int{{20, 8}, {32, 10}, {80, 24}, {120, 40}} {
		for mode := 0; mode < 3; mode++ {
			m.mode = mode
			m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
			v := m.View()
			if size[0] >= 32 {
				if strings.Count(v, "\n")+1 > size[1] {
					t.Fatal("too tall")
				}
				for _, line := range strings.Split(v, "\n") {
					if ansi.StringWidth(line) > size[0] {
						t.Fatal("too wide")
					}
				}
			}
		}
	}
}
func TestLockThemeExitAndAtomicSave(t *testing.T) {
	s := testStore(t)
	if other, err := openStore(s.dir); err == nil {
		other.close()
		t.Fatal("second writer allowed")
	}
	m, _ := newModel(s)
	press(m, tea.KeyCtrlN)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("final edit")})
	_, cmd := m.Update(exitMsg{})
	if cmd == nil || m.dirty {
		t.Fatal("exit did not flush")
	}
	press(m, tea.KeyCtrlT)
	reopened, err := newModel(s)
	if err != nil || reopened.theme != "light" {
		t.Fatal("theme not persisted")
	}
	entries, _ := os.ReadDir(s.dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".pending-") {
			t.Fatal("temp leak")
		}
	}
	b, _ := os.ReadFile(filepath.Join(s.dir, m.notes[0].ID+".md"))
	if string(b) != "final edit" {
		t.Fatal("exit lost content")
	}
}
func TestDataDirectory(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	dir, err := dataDir()
	if err != nil || filepath.Base(dir) != "coyotenote" {
		t.Fatal(dir, err)
	}
}

func TestDeleteLastNoteAndRestart(t *testing.T) {
	s := testStore(t)
	m, _ := newModel(s)
	press(m, tea.KeyCtrlN)
	press(m, tea.KeyCtrlD)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	m.navigate(1)
	reopened, err := newModel(s)
	if err != nil || len(reopened.notes) != 0 || !strings.Contains(reopened.View(), "Ctrl+N") {
		t.Fatal("empty notebook failed", err)
	}
}
func TestRefuseUnsafeInputWithoutChangingFiles(t *testing.T) {
	for _, body := range []string{strings.Repeat("line\n", 10000), string([]byte{0xff})} {
		s := testStore(t)
		path := filepath.Join(s.dir, "import.md")
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := s.load(); err == nil {
			t.Fatal("unsafe input accepted")
		}
		b, err := os.ReadFile(path)
		if err != nil || string(b) != body {
			t.Fatal("input changed")
		}
	}
}
