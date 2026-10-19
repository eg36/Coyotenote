package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"github.com/eg36/coyotenote/internal/vault"
)

type memoryClipboard struct {
	text string
	err  error
}

func (c *memoryClipboard) Read(context.Context) (string, error) { return c.text, c.err }
func (c *memoryClipboard) Write(_ context.Context, text string) error {
	if c.err != nil {
		return c.err
	}
	c.text = text
	return nil
}
func editorModel(t *testing.T, body string) (*model, *memoryClipboard) {
	t.Helper()
	s := testStore(t)
	writeNote(t, s, "Note", body)
	m, err := newModel(s)
	if err != nil {
		t.Fatal(err)
	}
	clipboard := &memoryClipboard{}
	m.clipboard = clipboard
	return m, clipboard
}
func selectRange(m *model, start, end int) {
	m.editor.ClearSelection()
	m.editor.SetOffset(start)
	m.editor.StartSelection()
	m.editor.SetOffset(end)
}
func runKeyCommand(t *testing.T, m *model, key tea.KeyType) {
	t.Helper()
	_, cmd := m.Update(tea.KeyMsg{Type: key})
	if cmd == nil {
		t.Fatalf("no command for %v: %s", key, m.status)
	}
	m.Update(cmd())
}
func TestSelectionCopyCutPasteAndPersistence(t *testing.T) {
	m, clipboard := editorModel(t, "one\ntwo\nthree")
	selectRange(m, 3, 7)
	runKeyCommand(t, m, tea.KeyCtrlC)
	if clipboard.text != "\ntwo" || m.dirty || !m.editor.HasSelection() {
		t.Fatal("copy changed editor", clipboard.text)
	}
	runKeyCommand(t, m, tea.KeyCtrlX)
	if m.editor.Value() != "one\nthree" || !m.dirty || m.editor.HasSelection() {
		t.Fatal(m.editor.Value())
	}
	runKeyCommand(t, m, tea.KeyCtrlV)
	if m.editor.Value() != "one\ntwo\nthree" {
		t.Fatal(m.editor.Value())
	}
	if err := m.flush(); err != nil {
		t.Fatal(err)
	}
	assertFileBody(t, m.store.Path("Note"), "one\ntwo\nthree")
}
func TestShiftSelectionUnicodeAndDirection(t *testing.T) {
	m, _ := editorModel(t, "a e\u0301👩‍💻界\nz")
	m.editor.SetOffset(2)
	press(m, tea.KeyShiftRight)
	if m.editor.SelectedText() != "e\u0301" {
		t.Fatalf("split combining sequence %q", m.editor.SelectedText())
	}
	press(m, tea.KeyShiftRight)
	if m.editor.SelectedText() != "e\u0301👩‍💻" {
		t.Fatalf("split emoji %q", m.editor.SelectedText())
	}
	press(m, tea.KeyShiftLeft)
	if m.editor.SelectedText() != "e\u0301" {
		t.Fatal(m.editor.SelectedText())
	}
	press(m, tea.KeyShiftLeft)
	press(m, tea.KeyShiftLeft)
	if m.editor.SelectedText() != " " {
		t.Fatal("reverse selection", m.editor.SelectedText())
	}
	press(m, tea.KeyRight)
	if m.editor.HasSelection() || m.editor.CursorOffset() != 2 {
		t.Fatal("collapse selection")
	}
	press(m, tea.KeyShiftEnd)
	if m.editor.SelectedText() != "e\u0301👩‍💻界" {
		t.Fatal(m.editor.SelectedText())
	}
	press(m, tea.KeyEsc)
	if m.editor.HasSelection() || m.dirty {
		t.Fatal("selection edits text")
	}
}
func TestSelectionReplacementAndPasteValidation(t *testing.T) {
	for _, tc := range []struct {
		name, text, want string
		paste            bool
		key              tea.KeyType
	}{
		{name: "typing", text: "X", want: "aXf"},
		{name: "newline", want: "a\nf", key: tea.KeyEnter},
		{name: "backspace", want: "af", key: tea.KeyBackspace},
		{name: "delete", want: "af", key: tea.KeyDelete},
		{name: "paste", text: "  x\r\ny\r", want: "a  x\ny\nf", paste: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, _ := editorModel(t, "abcdef")
			selectRange(m, 5, 1)
			if tc.key != 0 {
				press(m, tc.key)
			} else {
				m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(tc.text), Paste: tc.paste})
			}
			if got := m.editor.Value(); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
	m, clipboard := editorModel(t, "unchanged")
	selectRange(m, 0, 9)
	for _, invalid := range []string{strings.Repeat("x", vault.MaxPasteBytes+1), "a\x00b", string([]byte{0xff})} {
		clipboard.text = invalid
		runKeyCommand(t, m, tea.KeyCtrlV)
		if m.editor.Value() != "unchanged" || !m.editor.HasSelection() || m.dirty {
			t.Fatal("rejected paste changed editor")
		}
	}
}
func TestPasteLimitAccountsForReplacedSelection(t *testing.T) {
	body := strings.Repeat("x\n", vault.MaxLines-1)
	m, _ := editorModel(t, body)
	selectRange(m, 0, len([]rune(body)))
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("a\nb\n"), Paste: true})
	if m.editor.Value() != "a\nb\n" {
		t.Fatal("replacement incorrectly rejected", m.status)
	}
	selectRange(m, 0, 1)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(strings.Repeat("\n", vault.MaxLines)), Paste: true})
	if m.editor.Value() != "a\nb\n" || !m.editor.HasSelection() {
		t.Fatal("oversized replacement mutated source")
	}
}
func TestClipboardFailuresAndStaleResultsPreserveText(t *testing.T) {
	for _, key := range []tea.KeyType{tea.KeyCtrlX, tea.KeyCtrlV} {
		m, clipboard := editorModel(t, "abcdef")
		selectRange(m, 1, 4)
		clipboard.err = errors.New("unavailable")
		runKeyCommand(t, m, key)
		if m.editor.Value() != "abcdef" || m.editor.SelectedText() != "bcd" || m.dirty {
			t.Fatal("failure removed selection")
		}
	}
	for _, key := range []tea.KeyType{tea.KeyCtrlX, tea.KeyCtrlV} {
		for _, change := range []string{"move", "type", "switch", "modal"} {
			t.Run(fmt.Sprint(key)+change, func(t *testing.T) {
				m, clipboard := editorModel(t, "abcdef")
				clipboard.text = "PASTE"
				selectRange(m, 1, 4)
				_, cmd := m.Update(tea.KeyMsg{Type: key})
				if cmd == nil {
					t.Fatal(m.status)
				}
				switch change {
				case "move":
					press(m, tea.KeyLeft)
				case "type":
					typeText(m, "X")
				case "switch":
					newNote(m)
				case "modal":
					press(m, tea.KeyCtrlO)
				}
				expected := m.editor.Value()
				m.Update(cmd())
				if m.editor.Value() != expected {
					t.Fatal("stale result changed source", m.editor.Value())
				}
			})
		}
	}
}
func TestClipboardShortcutsDoNotQuitOrReplaceModalInput(t *testing.T) {
	m, _ := editorModel(t, "abc")
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd != nil || m.editor.Value() != "abc" || !strings.Contains(m.status, "Select text first") {
		t.Fatal("Ctrl+C should not quit")
	}
	selectRange(m, 0, 2)
	press(m, tea.KeyCtrlN)
	if m.editor.HasSelection() {
		t.Fatal("modal retains hidden selection")
	}
	press(m, tea.KeyCtrlV)
	if m.clipboardBusy || m.editor.Value() != "abc" {
		t.Fatal("clipboard targeted editor from modal")
	}
}
func TestSelectionWrapScrollAndAppearance(t *testing.T) {
	trueColor(t)
	m, _ := editorModel(t, "# Zażółć e\u0301👩‍💻界 "+strings.Repeat("word ", 40)+"\nlast")
	m.Update(tea.WindowSizeMsg{Width: 32, Height: 10})
	selectRange(m, 2, 80)
	for _, theme := range themes {
		m.theme = theme.id
		m.applyTheme()
		view := m.View()
		if !strings.Contains(ansi.Strip(view), "selected") {
			t.Fatal("selection feedback missing", theme.id)
		}
		rows := cellBackgrounds(view)
		selected := bgOf(theme.colors.line)
		found := false
		for _, row := range rows {
			for _, bg := range row {
				found = found || bg == selected
			}
		}
		if !found {
			t.Fatal("scrolled selection not painted", theme.id)
		}
	}
	typeText(m, "replacement")
	if m.editor.HasSelection() || !strings.Contains(m.editor.Value(), "replacement") {
		t.Fatal("wrapped range not replaced")
	}
}

func TestEmptyClipboardDoesNotDeleteSelection(t *testing.T) {
	m, _ := editorModel(t, "keep this")
	selectRange(m, 0, 9)
	runKeyCommand(t, m, tea.KeyCtrlV)
	if m.editor.Value() != "keep this" || !m.editor.HasSelection() || m.dirty {
		t.Fatal("empty clipboard removed text")
	}
}
func TestVerticalSelectionAndTypingAcrossLines(t *testing.T) {
	m, _ := editorModel(t, "first\nsecond\nthird")
	m.editor.SetOffset(2)
	press(m, tea.KeyShiftDown)
	if m.editor.SelectedText() != "rst\nse" {
		t.Fatal(m.editor.SelectedText())
	}
	press(m, tea.KeyShiftDown)
	if m.editor.SelectedText() != "rst\nsecond\nth" {
		t.Fatal(m.editor.SelectedText())
	}
	typeText(m, "X")
	if m.editor.Value() != "fiXird" {
		t.Fatal(m.editor.Value())
	}
}
