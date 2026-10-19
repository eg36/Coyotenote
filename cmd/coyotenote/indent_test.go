package main

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestTabInsertsAndIndents(t *testing.T) {
	for _, tc := range []struct {
		name, body     string
		start, end     int
		key            tea.KeyType
		want           string
		wantLo, wantHi int
	}{
		{"insert at cursor", "ab", 1, 1, tea.KeyTab, "a\tb", 2, 2},
		{"replace single-line selection", "abc", 1, 2, tea.KeyTab, "a\tc", 2, 2},
		{"indent selected lines", "one\ntwo\nthree", 1, 5, tea.KeyTab, "\tone\n\ttwo\nthree", 2, 7},
		{"selection from a line start keeps the tab", "one\ntwo", 0, 5, tea.KeyTab, "\tone\n\ttwo", 0, 7},
		{"line after selection end untouched", "a\nb\nc", 0, 4, tea.KeyTab, "\ta\n\tb\nc", 0, 6},
		{"outdent selected lines", "\tone\n\ttwo\nthree", 2, 7, tea.KeyShiftTab, "one\ntwo\nthree", 1, 5},
		{"outdent up to four spaces", "      x", 7, 7, tea.KeyShiftTab, "  x", 3, 3},
		{"outdent pulls cursor to line start", "\tx", 0, 0, tea.KeyShiftTab, "x", 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, _ := editorModel(t, tc.body)
			selectRange(m, tc.start, tc.end)
			m.Update(tea.KeyMsg{Type: tc.key})
			lo, hi := m.editor.SelectionBounds()
			if got := m.editor.Value(); got != tc.want || lo != tc.wantLo || hi != tc.wantHi || !m.dirty {
				t.Fatalf("got %q [%d,%d) dirty=%v, want %q [%d,%d)", got, lo, hi, m.dirty, tc.want, tc.wantLo, tc.wantHi)
			}
		})
	}
}
func TestTabKeepsSelectionDirectionAndSkipsNoOps(t *testing.T) {
	m, _ := editorModel(t, "one\ntwo")
	selectRange(m, 5, 1)
	m.Update(tea.KeyMsg{Type: tea.KeyTab})
	if m.editor.CursorOffset() != 2 {
		t.Fatal("reversed selection lost its direction", m.editor.CursorOffset())
	}
	m, _ = editorModel(t, "plain")
	m.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	if m.editor.Value() != "plain" || m.dirty {
		t.Fatal("outdent without indentation changed the note")
	}
}
