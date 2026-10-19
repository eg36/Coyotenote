package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/eg36/coyotenote/internal/vault"
)

func pickerModel(t *testing.T) *model {
	t.Helper()
	s := testStore(t)
	for id, body := range map[string]string{"a": "# Alpha\nfirst body", "b": "# Beta\nsecret elephant", "c": "# Gamma\nlast body"} {
		if err := os.WriteFile(filepath.Join(s.Dir, id+".md"), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	m, err := newModel(s)
	if err != nil {
		t.Fatal(err)
	}
	return m
}
func TestPickerSearchAndNavigation(t *testing.T) {
	for _, term := range []string{"Beta", "ELEPHANT"} {
		m := pickerModel(t)
		m.index = 2
		m.loadNote()
		press(m, tea.KeyCtrlO)
		if m.picker.SelectedItem().(pickerItem).id != "c" {
			t.Fatal("current selection")
		}
		m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(term)})
		if len(m.picker.VisibleItems()) != 1 || m.picker.SelectedItem().(pickerItem).id != "b" {
			t.Fatalf("filter %s", term)
		}
		press(m, tea.KeyEnter)
		if m.picker != nil || m.index != 1 || !strings.Contains(m.editor.Value(), "elephant") {
			t.Fatal("switch")
		}
	}
	m := pickerModel(t)
	press(m, tea.KeyCtrlO)
	press(m, tea.KeyDown)
	press(m, tea.KeyEsc)
	if m.picker != nil || m.index != 0 {
		t.Fatal("cancel switched note")
	}
	press(m, tea.KeyCtrlO)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("Beta")})
	press(m, tea.KeyEsc)
	if m.picker == nil || m.picker.FilterValue() != "" {
		t.Fatal("first escape must clear")
	}
	press(m, tea.KeyEsc)
	if m.picker != nil {
		t.Fatal("second escape must close")
	}
}
func TestPickerSaveFailureAndDirtySearch(t *testing.T) {
	m := pickerModel(t)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("local")})
	if err := os.WriteFile(filepath.Join(m.store.Dir, "a.md"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	press(m, tea.KeyCtrlO)
	press(m, tea.KeyDown)
	press(m, tea.KeyEnter)
	if m.picker == nil || m.index != 0 || !m.dirty || !strings.Contains(m.status, "SAVE FAILED") {
		t.Fatal("failed save lost editor")
	}
}
func TestUndoRestoresNoteWhoseNameWasAlreadyTrashed(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, ".trash/Dup", "earlier deletion")
	writeNote(t, s, "Dup", "current")
	m, err := newModel(s)
	if err != nil {
		t.Fatal(err)
	}
	press(m, tea.KeyCtrlD)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	if len(m.notes) != 0 || !strings.Contains(m.status, "Moved to trash") {
		t.Fatal(m.status)
	}
	assertFileBody(t, filepath.Join(s.Dir, ".trash", "Dup 2.md"), "current")
	press(m, tea.KeyCtrlZ)
	if len(m.notes) != 1 || m.notes[0].ID != "Dup" || m.editor.Value() != "current" {
		t.Fatal("undo restored the wrong note", m.status)
	}
	assertFileBody(t, filepath.Join(s.Dir, ".trash", "Dup.md"), "earlier deletion")
}
func TestUndoOrderAndFailedRestore(t *testing.T) {
	m := pickerModel(t)
	for i := 0; i < 2; i++ {
		press(m, tea.KeyCtrlD)
		m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	}
	if len(m.trashed) != 2 {
		t.Fatal("stack")
	}
	press(m, tea.KeyCtrlZ)
	if m.notes[m.index].ID != "b" || !strings.Contains(m.editor.Value(), "elephant") {
		t.Fatal("restore order")
	}
	if err := os.WriteFile(filepath.Join(m.store.Dir, "a.md"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	press(m, tea.KeyCtrlZ)
	if len(m.trashed) != 1 {
		t.Fatal("failed undo popped stack")
	}
	if err := os.Remove(filepath.Join(m.store.Dir, "a.md")); err != nil {
		t.Fatal(err)
	}
	press(m, tea.KeyCtrlZ)
	if len(m.notes) != 3 || m.index != 0 || m.notes[0].ID != "a" {
		t.Fatal("restore position")
	}
}
func TestSplitFollowsCursor(t *testing.T) {
	m := pickerModel(t)
	m.editor.SetValue(strings.Repeat("line\n", 200))
	m.revision++
	m.mode = 2
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 24})
	settle(m)
	press(m, tea.KeyCtrlEnd)
	if m.preview.YOffset < m.preview.TotalLineCount()-m.preview.Height-2 {
		t.Fatal("preview did not follow cursor", m.preview.YOffset)
	}
	m.mode = 1
	m.preview.GotoTop()
	m.followCursor()
	if m.preview.YOffset != 0 {
		t.Fatal("full preview moved")
	}
}
func TestUnbracketedLineLimitStatus(t *testing.T) {
	m := pickerModel(t)
	m.editor.SetValue(strings.Repeat("x\n", vault.MaxLines-1))
	press(m, tea.KeyEnter)
	if !strings.Contains(m.status, "10,000-line limit") {
		t.Fatal(m.status)
	}
}
