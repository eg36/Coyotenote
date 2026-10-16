package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func writeNote(t *testing.T, s *store, id, body string) {
	t.Helper()
	p := s.path(id)
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}
func typeText(m *model, text string) { m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(text)}) }
func ids(notes []note) string {
	var out []string
	for _, n := range notes {
		out = append(out, n.ID)
	}
	return strings.Join(out, ",")
}

func TestLoadWalksFoldersAndSkipsHidden(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Work/Plan", "plan")
	writeNote(t, s, "work/deep/Inner", "inner")
	writeNote(t, s, "Zebra", "z")
	writeNote(t, s, "apple", "a")
	for _, hidden := range []string{".obsidian/config.md", ".trash/old.md", ".git/x.md"} {
		p := filepath.Join(s.dir, filepath.FromSlash(hidden))
		os.MkdirAll(filepath.Dir(p), 0700)
		os.WriteFile(p, []byte("hidden"), 0600)
	}
	os.WriteFile(filepath.Join(s.dir, "Work", ".pending-1"), nil, 0600)
	if runtime.GOOS != "windows" {
		if err := os.Symlink(t.TempDir(), filepath.Join(s.dir, "linked")); err != nil {
			t.Fatal(err)
		}
	}
	notes, report, err := s.load()
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(notes); got != "apple,work/deep/Inner,Work/Plan,Zebra" {
		t.Fatal(got)
	}
	if report.orphans != 1 {
		t.Fatal("pending file in a folder not reported")
	}
}

func TestNameValidation(t *testing.T) {
	for _, good := range []string{"Note", "Work/Project X", "Zażółć gęślą", "a.b"} {
		if err := checkName(good); err != nil {
			t.Errorf("%q: %v", good, err)
		}
	}
	for _, bad := range []string{"", "/x", "x/", "a//b", "../x", "Work/../x", ".hidden", "a/.b", "a\\b", "CON", "nul.txt", "a:b", "x?", "[[x]]", "a#b", "a|b", "a^b", " x", "x ", "end."} {
		if checkName(bad) == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if safeName(`a/b: "c"?`) != "a-b- -c--" || safeName("  ...  ") != "Untitled" || safeName("CON") != "Untitled" {
		t.Fatal(safeName(`a/b: "c"?`), safeName("  ...  "))
	}
}

func TestCreateInFolderAndCollisions(t *testing.T) {
	s := testStore(t)
	m, _ := newModel(s)
	press(m, tea.KeyCtrlN)
	typeText(m, "Work/Plan")
	press(m, tea.KeyEnter)
	if m.prompt != nil || len(m.notes) != 1 || m.notes[0].ID != "Work/Plan" {
		t.Fatalf("create in folder: %v %q", ids(m.notes), m.status)
	}
	assertFileBody(t, filepath.Join(s.dir, "Work", "Plan.md"), "")
	// The prompt starts in the current note's folder.
	press(m, tea.KeyCtrlN)
	if m.prompt.input.Value() != "Work/" {
		t.Fatal(m.prompt.input.Value())
	}
	press(m, tea.KeyEnter)
	press(m, tea.KeyCtrlN)
	press(m, tea.KeyEnter)
	if got := ids(m.notes); got != "Work/Plan,Work/Untitled,Work/Untitled 2" {
		t.Fatal(got)
	}
	press(m, tea.KeyCtrlN)
	m.prompt.input.SetValue("work/plan")
	if runtime.GOOS == "linux" {
		m.prompt.input.SetValue("Work/Plan")
	}
	press(m, tea.KeyEnter)
	if m.prompt == nil || !strings.Contains(m.status, "already exists") || len(m.notes) != 3 {
		t.Fatalf("collision: %q", m.status)
	}
	m.prompt.input.SetValue("bad|name")
	press(m, tea.KeyEnter)
	if m.prompt == nil || !strings.Contains(m.status, "invalid name") {
		t.Fatal(m.status)
	}
	press(m, tea.KeyEsc)
	if m.prompt != nil || len(m.notes) != 3 {
		t.Fatal("escape")
	}
}

func TestRenameMovesNoteAndRewritesLinks(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Work/A", "# A\nlinks to [[Work/A]] itself")
	writeNote(t, s, "B", "see [[A]], [[work/a#Plan|the plan]] and `[[A]]`")
	writeNote(t, s, "C", "changed outside [[A]]")
	m, _ := newModel(s)
	m.selectID("Work/A")
	m.loadNote()
	if len(m.backlinks["Work/A"]) != 2 {
		t.Fatal(m.backlinks)
	}
	// C changes on disk after loading, so its links must be left alone.
	os.WriteFile(s.path("C"), []byte("external [[A]]"), 0600)
	press(m, tea.KeyCtrlR)
	if m.prompt.input.Value() != "Work/A" {
		t.Fatal(m.prompt.input.Value())
	}
	m.prompt.input.SetValue("Archive/A2")
	press(m, tea.KeyEnter)
	if m.prompt != nil || m.notes[m.index].ID != "Archive/A2" {
		t.Fatalf("rename: %q", m.status)
	}
	if _, err := os.Lstat(filepath.Join(s.dir, "Work", "A.md")); !os.IsNotExist(err) {
		t.Fatal("old file remains")
	}
	assertFileBody(t, s.path("Archive/A2"), "# A\nlinks to [[Archive/A2]] itself")
	assertFileBody(t, s.path("B"), "see [[A2]], [[Archive/A2#Plan|the plan]] and `[[A]]`")
	assertFileBody(t, s.path("C"), "external [[A]]")
	if !strings.Contains(m.status, "links updated in 2 notes") || !strings.Contains(m.status, "could not update links in C") {
		t.Fatal(m.status)
	}
	if m.editor.Value() != "# A\nlinks to [[Archive/A2]] itself" || len(m.backlinks["Archive/A2"]) != 1 {
		t.Fatal("editor or index not refreshed")
	}
	// Renaming onto another note is refused.
	press(m, tea.KeyCtrlR)
	m.prompt.input.SetValue("B")
	press(m, tea.KeyEnter)
	if m.prompt == nil || !strings.Contains(m.status, "already exists") {
		t.Fatal(m.status)
	}
}

func TestTrashKeepsFolders(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Work/Deep/N", "body")
	n := note{ID: "Work/Deep/N", Body: "body"}
	if err := s.trash(n); err != nil {
		t.Fatal(err)
	}
	assertFileBody(t, filepath.Join(s.dir, ".trash", "Work", "Deep", "N.md"), "body")
	os.RemoveAll(filepath.Join(s.dir, "Work"))
	got, err := s.restore(n.ID)
	if err != nil || got != n {
		t.Fatal(got, err)
	}
	assertFileBody(t, s.path(n.ID), "body")
}

func TestMigrateLegacyNames(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "20261001T101010.000000001-0123456789abcdef", "# Shopping: list\nmilk")
	writeNote(t, s, "20261001T101010.000000002-0123456789abcdef", "# Shopping- list\neggs")
	writeNote(t, s, "20261001T101010.000000003-0123456789abcdef", "")
	writeNote(t, s, "Untitled", "kept")
	var out bytes.Buffer
	if err := migrate(s, strings.NewReader("n\n"), &out); err != nil || !strings.Contains(out.String(), "Nothing was renamed") {
		t.Fatal(out.String(), err)
	}
	if err := migrate(s, strings.NewReader("y\n"), &out); err != nil {
		t.Fatal(err)
	}
	notes, _, _ := s.load()
	if got := ids(notes); got != "Shopping- list,Shopping- list 2,Untitled,Untitled 2" {
		t.Fatal(got)
	}
	m, _ := newModel(s)
	if m.notes[0].Body != "# Shopping: list\nmilk" {
		t.Fatal("body changed")
	}
	// Legacy notes still show their title until they are migrated.
	if displayName("20261001T101010.000000003-0123456789abcdef", "# Hi") != "Hi" || displayName("Work/Hi", "x") != "Work/Hi" {
		t.Fatal("display name")
	}
}

func TestThemeLivesInConfigDirectory(t *testing.T) {
	s := testStore(t)
	s.config = t.TempDir()
	m, _ := newModel(s)
	press(m, tea.KeyCtrlT)
	assertFileBody(t, filepath.Join(s.config, "theme"), "light")
	if _, err := os.Stat(filepath.Join(s.dir, "theme")); !os.IsNotExist(err) {
		t.Fatal("theme written into the vault")
	}
}

func TestPickerShowsPathsAndSearchesFolders(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Work/Plan", "first")
	writeNote(t, s, "Home/List", "second")
	m, _ := newModel(s)
	press(m, tea.KeyCtrlO)
	typeText(m, "work")
	if len(m.picker.VisibleItems()) != 1 || m.picker.SelectedItem().(pickerItem).id != "Work/Plan" {
		t.Fatal("folder search")
	}
	if !strings.Contains(ansi.Strip(m.View()), "Work/Plan") {
		t.Fatal("path not shown")
	}
}

func titles(m *model) string {
	var out []string
	for _, item := range m.picker.VisibleItems() {
		out = append(out, item.(pickerItem).title)
	}
	return strings.Join(out, ",")
}

func TestPickerBrowsesFolders(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Root note", "r")
	writeNote(t, s, "Work/Plan", "p")
	writeNote(t, s, "Work/Deep/Inner", "i")
	writeNote(t, s, "Home/List", "l")
	m, _ := newModel(s)
	m.selectID("Work/Plan")
	m.loadNote()
	press(m, tea.KeyCtrlO)
	// Opens in the current note's folder with it selected.
	if got := titles(m); got != "◂ ..,▸ Deep/,Plan" {
		t.Fatal(got)
	}
	if m.picker.SelectedItem().(pickerItem).id != "Work/Plan" {
		t.Fatal("current note not selected")
	}
	press(m, tea.KeyBackspace)
	if got := titles(m); got != "▸ Home/,▸ Work/,Root note" {
		t.Fatal(got)
	}
	if m.picker.SelectedItem().(pickerItem).id != "Work" {
		t.Fatal("folder left not selected")
	}
	press(m, tea.KeyEnter)
	press(m, tea.KeyDown)
	press(m, tea.KeyEnter)
	if got := titles(m); got != "◂ ..,Inner" || m.pickerFolder != "Work/Deep" {
		t.Fatal(got)
	}
	if !strings.Contains(ansi.Strip(m.View()), "Work/Deep/") {
		t.Fatal("folder not shown in the label")
	}
	// Typing searches the whole vault; clearing returns to the folder.
	typeText(m, "list")
	if got := titles(m); got != "Home/List" {
		t.Fatal(got)
	}
	press(m, tea.KeyEsc)
	if got := titles(m); got != "◂ ..,Inner" {
		t.Fatal(got)
	}
	press(m, tea.KeyDown)
	press(m, tea.KeyEnter)
	if m.picker != nil || m.notes[m.index].ID != "Work/Deep/Inner" {
		t.Fatal("open note from folder")
	}
}

func TestPickerFolderFilterIsExact(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Work/Plan", "p")
	writeNote(t, s, "Work/Deep/Inner", "i")
	writeNote(t, s, "Workshop", "w")
	writeNote(t, s, "Other/Wo rk", "o")
	m, _ := newModel(s)
	press(m, tea.KeyCtrlO)
	typeText(m, "work/")
	if got := titles(m); got != "Work/Deep/Inner,Work/Plan" {
		t.Fatal(got)
	}
}
