package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/glamour/styles"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

type exitMsg struct{}
type saveMsg uint64
type renderTickMsg uint64

// previewKey identifies one rendering: the edit revision, theme and width.
type previewKey struct {
	rev   uint64
	theme string
	width int
}
type renderedMsg struct {
	key previewKey
	out string
	err error
}

// Preview renders run off the update loop, after typing pauses this long.
const renderDelay = 150 * time.Millisecond

func binding(keys ...string) key.Binding { return key.NewBinding(key.WithKeys(keys...)) }

var keys = struct{ new, del, prev, next, mode, theme, save, help, quit key.Binding }{binding("ctrl+n"), binding("ctrl+d"), binding("alt+up", "ctrl+pgup"), binding("alt+down", "ctrl+pgdown"), binding("ctrl+p"), binding("ctrl+t"), binding("ctrl+s"), binding("f1"), binding("ctrl+q", "ctrl+c")}

type model struct {
	store                *store
	notes                []note
	index                int
	editor               textarea.Model
	preview              viewport.Model
	width, height, mode  int
	theme, status        string
	dirty, confirm, help bool
	revision             uint64
	shown, pending       previewKey
	// After a failed save, the first quit writes a recovery copy and arms the
	// second quit; editing again disarms it.
	quitArmed bool
	recovery  string
}

func newModel(s *store) (*model, error) {
	notes, report, err := s.load()
	if err != nil {
		return nil, err
	}
	e := textarea.New()
	e.Placeholder = "Write Markdown…"
	e.CharLimit = 0
	e.ShowLineNumbers = false
	e.Prompt = ""
	e.MaxHeight = 0
	e.MaxWidth = 0
	e.KeyMap.Paste.SetEnabled(false) // Use terminal bracketed paste; no desktop clipboard process.
	e.KeyMap.WordForward.SetKeys("alt+right", "alt+f", "ctrl+right")
	e.KeyMap.WordBackward.SetKeys("alt+left", "alt+b", "ctrl+left")
	m := &model{store: s, notes: notes, editor: e, preview: viewport.New(40, 10), width: 80, height: 24, theme: "dark", status: "Saved"}
	if b, err := os.ReadFile(filepath.Join(s.dir, "theme")); err == nil && strings.TrimSpace(string(b)) == "light" {
		m.theme = "light"
	}
	var warnings []string
	if len(report.skipped) > 0 {
		warnings = append(warnings, fmt.Sprintf("skipped %d unsafe files: %s", len(report.skipped), strings.Join(report.skipped, ", ")))
	}
	if report.orphans > 0 {
		warnings = append(warnings, fmt.Sprintf("%d interrupted-write files retained", report.orphans))
	}
	if report.recoveries > 0 {
		warnings = append(warnings, fmt.Sprintf("%d recovery copies retained", report.recoveries))
	}
	if len(warnings) > 0 {
		m.status = strings.Join(warnings, " · ") + " in " + s.dir
	}
	m.applyTheme()
	m.loadNote()
	m.resize()
	return m, nil
}
func (m *model) Init() tea.Cmd { return textarea.Blink }
func (m *model) loadNote() {
	m.editor.SetValue("")
	if len(m.notes) > 0 {
		m.editor.SetValue(m.notes[m.index].Body)
	}
	// SetValue leaves the cursor at the end of the note; start at the top instead.
	for m.editor.Line() > 0 {
		m.editor.CursorUp()
	}
	m.editor.CursorStart()
	m.dirty = false
	m.quitArmed = false
	m.revision++
	m.preview.SetContent("")
	m.preview.GotoTop()
	m.shown, m.pending = previewKey{}, previewKey{}
	m.editor.Focus()
}
func (m *model) flush() error {
	if !m.dirty || len(m.notes) == 0 {
		return nil
	}
	body := m.editor.Value()
	if err := m.store.save(m.notes[m.index], body); err != nil {
		m.status = "SAVE FAILED: " + err.Error()
		return err
	}
	m.notes[m.index].Body = body
	m.dirty = false
	m.quitArmed = false
	m.status = "Saved"
	return nil
}

// quit saves and quits. If saving fails, it copies the edits to a recovery file
// and asks for a second quit, so a broken disk never traps the user.
func (m *model) quit() tea.Cmd {
	err := m.flush()
	if err == nil || m.quitArmed {
		return tea.Quit
	}
	m.quitArmed = true
	path, rerr := m.store.writeRecovery(m.notes[m.index], m.editor.Value())
	if rerr != nil {
		m.status = fmt.Sprintf("SAVE FAILED: %v; recovery copy FAILED: %v. Ctrl+Q again quits WITHOUT your edits", err, rerr)
		return nil
	}
	m.recovery = path
	m.status = fmt.Sprintf("SAVE FAILED: %v. Edits copied to %s; Ctrl+Q again quits", err, path)
	return nil
}
func (m *model) navigate(delta int) {
	if len(m.notes) == 0 {
		return
	}
	if m.flush() != nil {
		return
	}
	m.index = (m.index + delta + len(m.notes)) % len(m.notes)
	m.loadNote()
}
func (m *model) split() bool { return m.mode == 2 && m.width >= 90 }

func (m *model) resize() {
	w := max(1, m.width-4)
	if m.split() {
		w = max(1, (m.width-7)/2)
	}
	m.editor.SetWidth(w)
	m.editor.SetHeight(max(1, m.height-7))
	m.preview.Width = w
	if m.split() {
		m.preview.Width = max(1, m.width-7-w)
	}
	m.preview.Height = max(1, m.height-7)
}
func renderMarkdown(body, theme string, width int) (string, error) {
	// Use explicit styles, with the same writing surface as the editor.
	// Leave layout padding to the app, rather than Glamour's document margins.
	style := styles.DarkStyleConfig
	if theme == "light" {
		style = styles.LightStyleConfig
	}
	p := paletteFor(theme)
	zero := uint(0)
	style.Document.Margin = &zero
	style.Document.BlockPrefix = ""
	style.Document.BlockSuffix = ""
	style.Document.Color = &p.text
	style.Document.BackgroundColor = &p.surface
	style.Heading.Color = &p.cyan
	style.H1.Color = &p.accent
	style.H1.BackgroundColor = &p.surface
	style.Code.BackgroundColor = &p.surface
	// Named Chroma themes avoid Glamour's global first-theme-wins registry.
	style.CodeBlock.Chroma = nil
	style.CodeBlock.Theme = "github-dark"
	if theme == "light" {
		style.CodeBlock.Theme = "github"
	}
	if lipgloss.ColorProfile() == termenv.Ascii {
		style.CodeBlock.Theme = ""
	}
	r, err := glamour.NewTermRenderer(glamour.WithStyles(style), glamour.WithWordWrap(max(10, width)), glamour.WithPreservedNewLines(), glamour.WithColorProfile(lipgloss.ColorProfile()))
	if err != nil {
		return "", err
	}
	return r.Render(body)
}
func (m *model) previewVisible() bool { return len(m.notes) > 0 && (m.mode == 1 || m.split()) }

// requestRender starts a background render of the current note unless the
// preview is hidden, already current, or already being rendered.
func (m *model) requestRender() tea.Cmd {
	k := previewKey{m.revision, m.theme, m.preview.Width}
	if !m.previewVisible() || k == m.shown || k == m.pending {
		return nil
	}
	m.pending = k
	body := m.editor.Value()
	return func() tea.Msg {
		out, err := renderMarkdown(body, k.theme, k.width)
		return renderedMsg{k, out, err}
	}
}
func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = v.Width
		m.height = v.Height
		m.resize()
		return m, m.requestRender()
	case exitMsg:
		// Signals (often SIGHUP: the terminal is gone) cannot wait for a second
		// quit. Preserve what we can, then exit; main reports any failure.
		if m.flush() != nil {
			if path, err := m.store.writeRecovery(m.notes[m.index], m.editor.Value()); err == nil {
				m.recovery = path
			}
		}
		return m, tea.Quit
	case saveMsg:
		if uint64(v) == m.revision {
			_ = m.flush()
		}
		return m, nil
	case renderTickMsg:
		if uint64(v) == m.revision {
			return m, m.requestRender()
		}
		return m, nil
	case renderedMsg:
		if v.key == m.pending {
			m.pending = previewKey{}
		}
		if v.key != (previewKey{m.revision, m.theme, m.preview.Width}) {
			return m, nil // stale: a newer render is or will be scheduled
		}
		if v.err != nil {
			m.status = "Preview: " + v.err.Error()
			return m, nil
		}
		m.shown = v.key
		m.preview.SetContent(v.out)
		return m, nil
	case tea.KeyMsg:
		if key.Matches(v, keys.quit) {
			return m, m.quit()
		}
		if m.confirm {
			if v.String() == "y" {
				if err := m.store.remove(m.notes[m.index]); err != nil {
					m.status = err.Error()
				} else {
					m.notes = append(m.notes[:m.index], m.notes[m.index+1:]...)
					m.index = max(0, min(m.index, len(m.notes)-1))
					m.loadNote()
					m.status = "Deleted"
				}
				m.confirm = false
			} else if v.String() == "n" || v.String() == "esc" {
				m.confirm = false
			}
			return m, m.requestRender()
		}
		if key.Matches(v, keys.help) {
			m.help = !m.help
			return m, nil
		}
		if m.help {
			if v.String() == "esc" {
				m.help = false
			}
			return m, nil
		}
		switch {
		case key.Matches(v, keys.new):
			if m.flush() != nil {
				return m, nil
			}
			n, err := m.store.create()
			if err != nil {
				m.status = err.Error()
				return m, nil
			}
			m.notes = append(m.notes, n)
			m.index = len(m.notes) - 1
			m.mode = 0
			m.loadNote()
			m.resize()
			return m, textarea.Blink
		case key.Matches(v, keys.del):
			if len(m.notes) > 0 && m.flush() == nil {
				m.confirm = true
			}
			return m, nil
		case key.Matches(v, keys.prev):
			m.navigate(-1)
			return m, m.requestRender()
		case key.Matches(v, keys.next):
			m.navigate(1)
			return m, m.requestRender()
		case key.Matches(v, keys.save):
			_ = m.flush()
			return m, nil
		case key.Matches(v, keys.mode):
			m.mode = (m.mode + 1) % 3
			m.resize()
			if m.mode == 1 {
				m.editor.Blur()
			} else {
				m.editor.Focus()
			}
			return m, tea.Batch(textarea.Blink, m.requestRender())
		case key.Matches(v, keys.theme):
			theme := "light"
			if m.theme == "light" {
				theme = "dark"
			}
			if err := atomicWrite(m.store.dir, "theme", []byte(theme)); err != nil {
				m.status = err.Error()
			} else {
				m.theme = theme
				m.applyTheme()
			}
			return m, m.requestRender()
		}
	}
	if len(m.notes) == 0 {
		return m, nil
	}
	if m.mode == 1 {
		var cmd tea.Cmd
		m.preview, cmd = m.preview.Update(msg)
		return m, cmd
	}
	if v, ok := msg.(tea.KeyMsg); ok && v.Paste {
		// The editor silently drops lines past its limit; refuse instead.
		text := string(v.Runes)
		if len(text) > maxPasteBytes || strings.Count(m.editor.Value(), "\n")+strings.Count(text, "\n") >= maxLines {
			m.status = fmt.Sprintf("Paste rejected: notes are limited to %d lines and pastes to %d KiB", maxLines, maxPasteBytes>>10)
			return m, nil
		}
	}
	before := m.editor.Value()
	var cmd tea.Cmd
	m.editor, cmd = m.editor.Update(msg)
	if before != m.editor.Value() {
		m.dirty = true
		m.quitArmed = false
		m.status = "Unsaved…"
		m.revision++
		rev := m.revision
		save := tea.Tick(400*time.Millisecond, func(time.Time) tea.Msg { return saveMsg(rev) })
		if !m.previewVisible() {
			return m, tea.Batch(cmd, save)
		}
		return m, tea.Batch(cmd, save, tea.Tick(renderDelay, func(time.Time) tea.Msg { return renderTickMsg(rev) }))
	}
	return m, cmd
}
func (m *model) View() string {
	p := paletteFor(m.theme)
	if m.width < 32 || m.height < 10 {
		return paintBlock("Resize to at least 32×10.\nCtrl+S save · Ctrl+Q quit", max(1, m.width), max(1, m.height), p.text, p.surface)
	}
	var body string
	switch {
	case m.confirm:
		body = ink(p.danger).Bold(true).Render("Delete this note permanently?") + "\n\ny confirm · n / Esc cancel"
	case m.help:
		body = ink(p.accent).Bold(true).Render("KEYS") + "\nCtrl+N  new note    Ctrl+D  delete (confirm)\nAlt+↑/↓ or Ctrl+PgUp/PgDn  previous / next note\nCtrl+P  editor → preview → split\nCtrl+T  dark / light theme    Ctrl+S  save now\nCtrl+Q / Ctrl+C  save and quit    F1 / Esc  close help\nPreview: ↑/↓, PgUp/PgDn, Home/End\nSplit: type in editor; switch to preview to scroll.\nEditor: arrows, Alt/Ctrl+←/→ by word, Home/End, paste."
	case len(m.notes) == 0:
		body = ink(p.accent).Render("A quiet place for your next thought.") + "\n\nCtrl+N creates a note. Your first line becomes its title."
	case m.mode == 1:
		body = m.preview.View()
	case m.split():
		divider := ink(p.line).Render(strings.TrimSuffix(strings.Repeat(" │ \n", m.editor.Height()), "\n"))
		body = lipgloss.JoinHorizontal(lipgloss.Top, m.editor.View(), divider, m.preview.View())
	default:
		body = m.editor.View()
	}
	// Seven chrome rows: header, spacer, pane labels, spacer, status, keys, footer padding.
	// Every surface is sized explicitly, including blank cells and nested ANSI resets.
	body = paintBlock(body, m.width-4, m.height-7, p.text, p.surface)
	body = lipgloss.NewStyle().Padding(0, 2).Render(body)
	return strings.Join([]string{
		m.header(p),
		paintBlock("", m.width, 1, p.text, p.surface),
		m.paneLabels(p),
		paintBlock(body, m.width, m.height-7, p.text, p.surface),
		paintBlock("", m.width, 1, p.text, p.surface),
		m.statusLine(p),
		m.shortcutLine(p),
		paintBlock("", m.width, 1, p.text, p.chrome),
	}, "\n")
}

func (m *model) applyTheme() {
	p := paletteFor(m.theme)
	base := ink(p.text).Background(lipgloss.Color(p.surface))
	style := textarea.Style{Base: base, Text: base, CursorLine: base, Placeholder: base.Foreground(lipgloss.Color(p.muted)), EndOfBuffer: base}
	m.editor.FocusedStyle = style
	m.editor.BlurredStyle = style
	m.editor.Cursor.Style = ink(p.accent)
	m.editor.Cursor.TextStyle = base
}
