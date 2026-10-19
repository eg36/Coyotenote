package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"github.com/eg36/coyotenote/internal/vault"
)

func linkModel(t *testing.T) *model {
	t.Helper()
	s := testStore(t)
	writeNote(t, s, "Alpha", "# Alpha\nsee [[Beta|the beta]] and [[Gamma]]")
	writeNote(t, s, "Notes/Beta", "# Beta\nback to [[Alpha]]")
	m, err := newModel(s)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestFollowLinkAndBack(t *testing.T) {
	m := linkModel(t)
	press(m, tea.KeyCtrlG)
	if !strings.Contains(m.status, "No [[link]]") {
		t.Fatal(m.status)
	}
	m.editor.CursorDown()
	m.editor.SetCursor(6) // inside [[Beta|the beta]]
	press(m, tea.KeyCtrlG)
	if m.notes[m.index].ID != "Notes/Beta" || len(m.history) != 1 {
		t.Fatal("follow", m.notes[m.index].ID)
	}
	press(m, tea.KeyCtrlY)
	if m.notes[m.index].ID != "Alpha" {
		t.Fatal("back")
	}
	press(m, tea.KeyCtrlY)
	if !strings.Contains(m.status, "No earlier note") {
		t.Fatal(m.status)
	}
	// A missing target offers a new note with the link's name.
	m.editor.CursorDown()
	m.editor.CursorEnd()
	press(m, tea.KeyCtrlG)
	if m.prompt == nil || m.prompt.input.Value() != "Gamma" {
		t.Fatal("missing link prompt")
	}
	press(m, tea.KeyEnter)
	if m.notes[m.index].ID != "Gamma" || len(m.history) != 1 || m.history[0] != "Alpha" {
		t.Fatal("create from link", ids(m.notes), m.history)
	}
	press(m, tea.KeyCtrlY)
	if m.notes[m.index].ID != "Alpha" {
		t.Fatal("back after create")
	}
}

func TestBacklinks(t *testing.T) {
	m := linkModel(t)
	m.Update(tea.WindowSizeMsg{Width: 100, Height: 24})
	if !strings.Contains(ansi.Strip(m.View()), "← 1") {
		t.Fatal("backlink count missing")
	}
	press(m, tea.KeyCtrlL)
	if m.picker == nil || len(m.picker.Items()) != 1 || m.picker.SelectedItem().(pickerItem).id != "Notes/Beta" {
		t.Fatal("backlinks picker")
	}
	if !strings.Contains(m.picker.SelectedItem().(pickerItem).description, "back to [[Alpha]]") {
		t.Fatal(m.picker.SelectedItem().(pickerItem).description)
	}
	press(m, tea.KeyEnter)
	if m.notes[m.index].ID != "Notes/Beta" || len(m.history) != 1 {
		t.Fatal("open backlink")
	}
	// Backlinks follow saved edits.
	m.editor.SetValue("no links")
	m.dirty = true
	m.flush()
	m.back()
	press(m, tea.KeyCtrlL)
	if m.picker != nil || !strings.Contains(m.status, "No notes link here") {
		t.Fatal("stale backlinks")
	}
}

func TestLinkCompletion(t *testing.T) {
	m := linkModel(t)
	m.editor.CursorDown()
	m.editor.CursorEnd()
	typeText(m, " [[")
	if m.complete == nil || len(m.complete.items) != 1 || m.complete.items[0] != "Beta" {
		t.Fatalf("suggestions %+v", m.complete)
	}
	typeText(m, "Be")
	press(m, tea.KeyTab)
	if !strings.HasSuffix(m.editor.Value(), " [[Beta]]") || m.complete != nil || !m.dirty {
		t.Fatal(m.editor.Value())
	}
	typeText(m, " ok")
	if !strings.HasSuffix(m.editor.Value(), "[[Beta]] ok") {
		t.Fatal("cursor not after the link", m.editor.Value())
	}
	typeText(m, " [[zz")
	if m.complete != nil {
		t.Fatal("no match should hide suggestions")
	}
	press(m, tea.KeyBackspace)
	press(m, tea.KeyBackspace)
	if m.complete == nil {
		t.Fatal("suggestions after backspace")
	}
	press(m, tea.KeyEsc)
	typeText(m, "B")
	if m.complete != nil {
		t.Fatal("dismissed suggestions came back")
	}
	press(m, tea.KeyEnter)
	if strings.Contains(m.editor.Value(), "[[B]]") || m.editor.Line() != 2 {
		t.Fatal("enter should reach the editor after Esc")
	}
}

func TestPreviewAndEditorShowLinks(t *testing.T) {
	m := linkModel(t)
	m.mode = 1
	_, cmd := m.Update(tea.WindowSizeMsg{Width: 100, Height: 24})
	m.Update(cmd())
	plain := ansi.Strip(m.preview.View())
	if !strings.Contains(plain, "the beta") || !strings.Contains(plain, "Gamma") || strings.Contains(plain, "[[") || strings.ContainsAny(plain, linkOpen+linkClose+missingOpen) {
		t.Fatal(plain)
	}
	p := paletteFor("dark")
	trueColor(t)
	view := colorMarkdown("see [[Beta]] here", p)
	if !strings.Contains(view, ";4m[[Beta]]") {
		t.Fatalf("link not highlighted: %q", view)
	}
}

func TestRenamePreservesOtherLinkDestinations(t *testing.T) {
	for _, tc := range []struct{ from, to, source, before, want string }{
		{"F/A", "G/A", "F/A", "[[B#Heading|alias]]", "[[F/B#Heading|alias]]"},
		{"A", "B", "G/C", "[[B]]", "[[G/B]]"},
	} {
		t.Run(tc.from+"_"+tc.to, func(t *testing.T) {
			s := testStore(t)
			writeNote(t, s, "F/B", "")
			writeNote(t, s, "G/B", "")
			writeNote(t, s, tc.from, "")
			writeNote(t, s, tc.source, tc.before)
			m, _ := newModel(s)
			m.selectID(tc.from)
			m.loadNote()
			if err := m.renameNote(tc.to); err != nil {
				t.Fatal(err)
			}
			source := tc.source
			if source == tc.from {
				source = tc.to
			}
			assertFileBody(t, s.Path(source), tc.want)
		})
	}
}
func TestParseLinksRespectsFenceClosingRules(t *testing.T) {
	for _, body := range []string{
		"````\n```\n[[Hidden]]\n````\n[[Visible]]",
		"~~~~\n~~~\n[[Hidden]]\n~~~~~\n[[Visible]]",
		"```\n```not a close\n[[Hidden]]\n```\n[[Visible]]",
		"```\n    ```\n[[Hidden]]\n```\n[[Visible]]",
	} {
		links := vault.ParseLinks(body)
		if len(links) != 1 || links[0].Target != "Visible" {
			t.Fatalf("%q: %+v", body, links)
		}
	}
}
