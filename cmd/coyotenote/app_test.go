package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"github.com/eg36/coyotenote/internal/vault"
)

func testStore(t *testing.T) *vault.Store {
	t.Helper()
	s, err := vault.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}
func assertFileBody(t *testing.T, path, want string) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil || string(b) != want {
		t.Fatalf("%s: got %q, want %q: %v", path, b, want, err)
	}
}
func press(m *model, k tea.KeyType) { m.Update(tea.KeyMsg{Type: k}) }

// newNote creates a note with the default name through the Ctrl+N prompt.
func newNote(m *model) {
	press(m, tea.KeyCtrlN)
	press(m, tea.KeyEnter)
}

// settle runs the asynchronous preview render synchronously.
func settle(m *model) {
	if cmd := m.requestRender(); cmd != nil {
		m.Update(cmd())
	}
}
func TestCreateEditNavigateDelete(t *testing.T) {
	s := testStore(t)
	m, err := newModel(s)
	if err != nil {
		t.Fatal(err)
	}
	newNote(m)
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
	newNote(m)
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
	loaded, _, err := s.Load()
	if err != nil || len(loaded) != 1 || !strings.Contains(loaded[0].Body, "hello 世界") {
		t.Fatalf("persistence: %v %v", loaded, err)
	}
}
func TestInterruptedWriteRecovery(t *testing.T) {
	s := testStore(t)
	n, err := s.Create("x", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Save(n, "committed"); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(s.Dir, ".pending-interrupted"), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	notes, report, err := s.Load()
	if err != nil || report.Orphans != 1 || len(notes) != 1 || notes[0].Body != "committed" {
		t.Fatalf("recovery %v %v %v", notes, report, err)
	}
	if _, err = os.Stat(filepath.Join(s.Dir, ".pending-interrupted")); err != nil {
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
	newNote(m)
	newNote(m)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("local")})
	if err := os.WriteFile(filepath.Join(s.Dir, m.notes[m.index].ID+".md"), []byte("external"), 0600); err != nil {
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
	newNote(m)
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
	if other, err := vault.Open(s.Dir); err == nil {
		other.Close()
		t.Fatal("second writer allowed")
	}
	m, _ := newModel(s)
	newNote(m)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("final edit")})
	_, cmd := m.Update(exitMsg{})
	if cmd == nil || m.dirty {
		t.Fatal("exit did not flush")
	}
	press(m, tea.KeyCtrlT)
	press(m, tea.KeyDown)
	press(m, tea.KeyEnter)
	reopened, err := newModel(s)
	if err != nil || reopened.theme != "light" {
		t.Fatal("theme not persisted")
	}
	entries, _ := os.ReadDir(s.Dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".pending-") {
			t.Fatal("temp leak")
		}
	}
	b, _ := os.ReadFile(filepath.Join(s.Dir, m.notes[0].ID+".md"))
	if string(b) != "final edit" {
		t.Fatal("exit lost content")
	}
}
func TestDataDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Setenv("APPDATA", t.TempDir())
		base, err := os.UserConfigDir()
		if err != nil {
			t.Fatal(err)
		}
		dir, err := vault.DataDir()
		if err != nil || dir != filepath.Join(base, "coyotenote") {
			t.Fatal(dir, err)
		}
		return
	}
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	dir, err := vault.DataDir()
	if err != nil || filepath.Base(dir) != "coyotenote" {
		t.Fatal(dir, err)
	}
}

func TestDeleteLastNoteAndRestart(t *testing.T) {
	s := testStore(t)
	m, _ := newModel(s)
	newNote(m)
	press(m, tea.KeyCtrlD)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	m.navigate(1)
	reopened, err := newModel(s)
	if err != nil || len(reopened.notes) != 0 || !strings.Contains(reopened.View(), "Ctrl+N") {
		t.Fatal("empty notebook failed", err)
	}
}
func TestSkipUnsafeFilesWithoutChangingThem(t *testing.T) {
	s := testStore(t)
	if err := os.WriteFile(filepath.Join(s.Dir, "good.md"), []byte("# Good"), 0600); err != nil {
		t.Fatal(err)
	}
	bad := map[string]string{"long.md": strings.Repeat("line\n", vault.MaxLines), "long-cr.md": strings.Repeat("line\r", vault.MaxLines), "control.md": "page\fbreak", "binary.md": string([]byte{0xff})}
	for name, body := range bad {
		if err := os.WriteFile(filepath.Join(s.Dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	unsafeNames := []string{"long.md", "long-cr.md", "control.md", "binary.md"}
	if err := os.Symlink(filepath.Join(s.Dir, "good.md"), filepath.Join(s.Dir, "link.md")); err != nil {
		if runtime.GOOS != "windows" {
			t.Fatal(err)
		}
		t.Logf("skipping symlink check: %v", err)
	} else {
		unsafeNames = append(unsafeNames, "link.md")
	}
	m, err := newModel(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.notes) != 1 || m.notes[0].ID != "good" {
		t.Fatalf("valid note not loaded: %v", m.notes)
	}
	for _, name := range unsafeNames {
		if !strings.Contains(m.status, name) {
			t.Fatalf("no warning for %s: %q", name, m.status)
		}
	}
	for name, body := range bad {
		if b, err := os.ReadFile(filepath.Join(s.Dir, name)); err != nil || string(b) != body {
			t.Fatal("input changed", name)
		}
	}
}
func TestFailedSaveWritesRecoveryAndSecondQuitExits(t *testing.T) {
	s := testStore(t)
	m, _ := newModel(s)
	newNote(m)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("precious")})
	if err := os.WriteFile(filepath.Join(s.Dir, m.notes[0].ID+".md"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlQ}); cmd != nil {
		t.Fatal("first quit exited despite failed save")
	}
	b, err := os.ReadFile(m.recovery)
	if err != nil || string(b) != "precious" || !strings.Contains(m.status, m.recovery) {
		t.Fatalf("recovery copy %q %v %q", b, err, m.status)
	}
	if _, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlQ}); cmd == nil {
		t.Fatal("second quit did not exit")
	}
	if _, report, _ := s.Load(); report.Recoveries != 1 {
		t.Fatal("recovery copy not reported on load")
	}
}
func TestSignalExitAfterFailedSaveKeepsRecovery(t *testing.T) {
	s := testStore(t)
	m, _ := newModel(s)
	newNote(m)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("unsaved")})
	if err := os.WriteFile(filepath.Join(s.Dir, m.notes[0].ID+".md"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, cmd := m.Update(exitMsg{}); cmd == nil {
		t.Fatal("signal exit blocked")
	}
	if b, err := os.ReadFile(m.recovery); err != nil || string(b) != "unsaved" {
		t.Fatal("no recovery copy on signal exit", err)
	}
}
func TestRecoveryFallsBackToTempDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows chmod does not restrict directory writes")
	}
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	s := testStore(t)
	t.Setenv("TMPDIR", t.TempDir())
	if err := os.Chmod(s.Dir, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(s.Dir, 0700) })
	path, err := s.WriteRecovery(vault.Note{ID: "x"}, "body")
	if err != nil || !strings.HasPrefix(path, os.Getenv("TMPDIR")) {
		t.Fatal(path, err)
	}
	if b, _ := os.ReadFile(path); string(b) != "body" {
		t.Fatal("fallback content")
	}
}
func TestOversizedPasteRejected(t *testing.T) {
	m, _ := newModel(testStore(t))
	newNote(m)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("keep")})
	for _, paste := range []string{strings.Repeat("x\n", vault.MaxLines), strings.Repeat("x", vault.MaxPasteBytes+1)} {
		m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(paste), Paste: true})
		if m.editor.Value() != "keep" || !strings.Contains(m.status, "Paste rejected") {
			t.Fatalf("oversized paste accepted: %d bytes", len(m.editor.Value()))
		}
	}
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(" ok"), Paste: true})
	if m.editor.Value() != "keep ok" {
		t.Fatal("small paste rejected")
	}
}
func TestCursorStartsAtTopAndThemeWhitespace(t *testing.T) {
	s := testStore(t)
	if err := os.WriteFile(filepath.Join(s.Dir, "a.md"), []byte("one\ntwo\nthree"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, "theme"), []byte("light\n"), 0600); err != nil {
		t.Fatal(err)
	}
	m, _ := newModel(s)
	if m.editor.Line() != 0 || m.editor.LineInfo().ColumnOffset != 0 {
		t.Fatalf("cursor at line %d", m.editor.Line())
	}
	if m.theme != "light" {
		t.Fatal("trailing newline in theme file ignored")
	}
}
func TestWordKeysMoveCursorNotNotes(t *testing.T) {
	m, _ := newModel(testStore(t))
	newNote(m)
	newNote(m)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("alpha beta")})
	for _, k := range []tea.KeyMsg{{Type: tea.KeyLeft, Alt: true}, {Type: tea.KeyCtrlLeft}} {
		m.Update(k)
		if m.index != 1 {
			t.Fatalf("%v switched notes", k)
		}
	}
	if m.editor.LineInfo().ColumnOffset != 0 {
		t.Fatal("word navigation did not move the cursor")
	}
	m.Update(tea.KeyMsg{Type: tea.KeyUp, Alt: true})
	if m.index != 0 {
		t.Fatal("Alt+Up did not switch notes")
	}
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlPgDown})
	if m.index != 1 {
		t.Fatal("Ctrl+PgDn did not switch notes")
	}
}
func TestStalePreviewRenderIgnored(t *testing.T) {
	m, _ := newModel(testStore(t))
	newNote(m)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("# Old")})
	m.mode = 1 // keys reach the editor only outside preview mode
	old := m.requestRender()
	m.mode = 0
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(" New")})
	m.mode = 1
	m.Update(old())
	if strings.Contains(ansi.Strip(m.preview.View()), "Old") {
		t.Fatal("stale render shown")
	}
	settle(m)
	if !strings.Contains(ansi.Strip(m.preview.View()), "Old New") {
		t.Fatal("current render missing")
	}
}
func TestVersionString(t *testing.T) {
	if versionString() == "" {
		t.Fatal("empty version")
	}
	version = "v9.9.9"
	t.Cleanup(func() { version = "" })
	if versionString() != "v9.9.9" {
		t.Fatal("ldflags version ignored")
	}
}
