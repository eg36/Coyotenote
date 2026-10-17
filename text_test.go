package main

import (
	"os"
	"path/filepath"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// editAndSave types at the start of the note, removes it again, and saves, so
// the file is rewritten from the editor's copy of the text.
func editAndSave(t *testing.T, body string) string {
	t.Helper()
	m, _ := editorModel(t, body)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("x")})
	m.Update(tea.KeyMsg{Type: tea.KeyBackspace})
	if !m.dirty {
		t.Fatal("edit did not mark the note dirty")
	}
	if err := m.flush(); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(m.store.dir, "Note.md"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
func TestEditingKeepsNoteText(t *testing.T) {
	for name, body := range map[string]string{
		"LF":   "# Title\n\none\ntwo\n",
		"CRLF": "# Title\r\n\r\none\r\ntwo\r\n",
	} {
		t.Run(name, func(t *testing.T) {
			if got := editAndSave(t, body); got != body {
				t.Fatalf("saved %q, want %q", got, body)
			}
		})
	}
}
func TestEditorUsesLFForCRLFNotes(t *testing.T) {
	m, _ := editorModel(t, "a\r\nb\r\n")
	if got := m.editor.Value(); got != "a\nb\n" {
		t.Fatalf("editor holds %q", got)
	}
	if got := editAndSave(t, "mixed\r\nlone\rend\n"); got != "mixed\r\nlone\r\nend\r\n" {
		t.Fatalf("mixed endings saved as %q", got)
	}
}
