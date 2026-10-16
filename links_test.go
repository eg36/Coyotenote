package main

import (
	"reflect"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func TestParseLinks(t *testing.T) {
	body := "a [[One]] b [[Two#Head|alias]] [[ Zażółć ]]\n`[[code]]` ``[[x]]``\n```\n[[fenced]]\n```\n[[#self]] [[]] [[bro[ken]] [[Three|x]]"
	var got []string
	for _, l := range parseLinks(body) {
		got = append(got, l.target+"#"+l.heading+"|"+l.alias)
		if !strings.HasPrefix(body[l.start:], "[[") || !strings.HasSuffix(body[:l.end], "]]") {
			t.Fatalf("bad offsets for %+v", l)
		}
	}
	want := []string{"One#|", "Two#Head|alias", "Zażółć#|", "Three#|x"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
}

func TestResolver(t *testing.T) {
	r := newResolver([]note{{ID: "Plan"}, {ID: "Work/Plan"}, {ID: "Work/Deep/Note"}, {ID: "Home/Deep/Note"}, {ID: "Other/Note"}})
	for _, tc := range []struct{ target, from, want string }{
		{"plan", "x", "Plan"},
		{"Work/Plan", "x", "Work/Plan"},
		{"work/plan.md", "x", "Work/Plan"},
		{"Note", "Home/Deep/a", "Home/Deep/Note"},
		{"Note", "x", "Other/Note"},
		{"Deep/Note", "x", "Home/Deep/Note"},
	} {
		if got, ok := r.resolve(tc.target, tc.from); !ok || got != tc.want {
			t.Errorf("%s from %s: got %q", tc.target, tc.from, got)
		}
	}
	if _, ok := r.resolve("Missing", "x"); ok {
		t.Fatal("resolved missing")
	}
	if r.shortTarget("Work/Plan", "x") != "Work/Plan" || r.shortTarget("Other/Note", "x") != "Note" {
		t.Fatal("short target")
	}
}

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
