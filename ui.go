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
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

type exitMsg struct{}
type saveMsg uint64

func binding(keys ...string) key.Binding { return key.NewBinding(key.WithKeys(keys...)) }

var keys = struct{ new, del, prev, next, mode, theme, save, help, quit key.Binding }{binding("ctrl+n"), binding("ctrl+d"), binding("alt+left", "ctrl+left"), binding("alt+right", "ctrl+right"), binding("ctrl+p"), binding("ctrl+t"), binding("ctrl+s"), binding("f1"), binding("ctrl+q", "ctrl+c")}

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
	renderKey            string
}

func newModel(s *store) (*model, error) {
	notes, orphans, err := s.load()
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
	m := &model{store: s, notes: notes, editor: e, preview: viewport.New(40, 10), width: 80, height: 24, theme: "dark", status: "Saved"}
	if b, err := os.ReadFile(filepath.Join(s.dir, "theme")); err == nil && string(b) == "light" {
		m.theme = "light"
	}
	if orphans > 0 {
		m.status = fmt.Sprintf("%d interrupted-write files retained in %s", orphans, s.dir)
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
	m.editor.CursorStart()
	m.dirty = false
	m.revision++
	m.preview.GotoTop()
	m.renderKey = ""
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
	m.status = "Saved"
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
func (m *model) resize() {
	w := max(10, m.width-4)
	if m.mode == 2 && m.width >= 90 {
		w = (m.width - 6) / 2
	}
	m.editor.SetWidth(w)
	m.editor.SetHeight(max(1, m.height-7))
	m.preview.Width = w
	m.preview.Height = max(1, m.height-7)
}
func renderMarkdown(body, theme string, width int) (string, error) {
	r, err := glamour.NewTermRenderer(glamour.WithStandardStyle(theme), glamour.WithWordWrap(max(10, width)), glamour.WithPreservedNewLines())
	if err != nil {
		return "", err
	}
	return r.Render(body)
}
func (m *model) render() {
	k := fmt.Sprintf("%s/%d/%s", m.theme, m.preview.Width, m.editor.Value())
	if k == m.renderKey {
		return
	}
	out, err := renderMarkdown(m.editor.Value(), m.theme, m.preview.Width)
	if err != nil {
		m.status = "Preview: " + err.Error()
		return
	}
	m.renderKey = k
	m.preview.SetContent(out)
}
func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = v.Width
		m.height = v.Height
		m.resize()
	case exitMsg:
		if m.flush() == nil {
			return m, tea.Quit
		}
		return m, nil
	case saveMsg:
		if uint64(v) == m.revision {
			_ = m.flush()
		}
		return m, nil
	case tea.KeyMsg:
		if key.Matches(v, keys.quit) {
			if m.flush() == nil {
				return m, tea.Quit
			}
			return m, nil
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
			return m, nil
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
			return m, nil
		case key.Matches(v, keys.next):
			m.navigate(1)
			return m, nil
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
			return m, textarea.Blink
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
			return m, nil
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
	before := m.editor.Value()
	var cmd tea.Cmd
	m.editor, cmd = m.editor.Update(msg)
	if before != m.editor.Value() {
		m.dirty = true
		m.status = "Unsaved…"
		m.revision++
		rev := m.revision
		return m, tea.Batch(cmd, tea.Tick(400*time.Millisecond, func(time.Time) tea.Msg { return saveMsg(rev) }))
	}
	return m, cmd
}
func (m *model) View() string {
	if m.width < 32 || m.height < 10 {
		return "Resize to at least 32×10.\nCtrl+S save · Ctrl+Q quit"
	}
	accent := "141"
	if m.theme == "light" {
		accent = "62"
	}
	heading := lipgloss.NewStyle().Foreground(lipgloss.Color(accent)).Bold(true)
	count := "No notes"
	if len(m.notes) > 0 {
		count = fmt.Sprintf("%d/%d  %s", m.index+1, len(m.notes), title(m.editor.Value()))
	}
	mode := []string{"EDIT", "PREVIEW", "SPLIT"}[m.mode]
	if m.mode == 2 && m.width < 90 {
		mode = "EDIT (split needs 90 columns)"
	}
	top := heading.Render("coyotenote") + "  " + count + "  · " + mode + " · " + m.theme
	var body string
	switch {
	case m.confirm:
		body = "Delete this note permanently?\n\ny confirm · n / Esc cancel"
	case m.help:
		body = "KEYS\nCtrl+N  new note    Ctrl+D  delete (confirm)\nAlt+←/→ or Ctrl+←/→  previous / next note\nCtrl+P  editor → preview → split\nCtrl+T  dark / light theme    Ctrl+S  save now\nCtrl+Q / Ctrl+C  save and quit    F1 / Esc  close help\nPreview: ↑/↓, PgUp/PgDn, Home/End\nSplit: type in editor; switch to preview to scroll.\nEditor: arrows, Home/End, normal text and paste."
	case len(m.notes) == 0:
		body = "A quiet place for your next thought.\n\nCtrl+N creates a note. Your first line becomes its title."
	case m.mode == 1:
		m.render()
		body = m.preview.View()
	case m.mode == 2 && m.width >= 90:
		m.render()
		body = lipgloss.JoinHorizontal(lipgloss.Top, m.editor.View(), " │ ", m.preview.View())
	default:
		body = m.editor.View()
	}
	body = lipgloss.NewStyle().Height(m.height - 5).MaxHeight(m.height - 5).Render(body)
	footer := "^N new · ^D delete · Alt+←/→ notes · ^P view · ^T theme · F1 help · ^Q quit"
	if m.width < 80 {
		footer = "^N new · ^P view · F1 keys · ^Q quit"
	}
	lines := strings.Split(top+"\n"+body+"\n"+m.status+"\n"+footer, "\n")
	for i, line := range lines {
		lines[i] = ansi.Truncate(line, m.width, "")
	}
	fg, bg := "252", "235"
	if m.theme == "light" {
		fg, bg = "235", "255"
	}
	return lipgloss.NewStyle().Foreground(lipgloss.Color(fg)).Background(lipgloss.Color(bg)).Width(m.width).Height(m.height).Render(strings.Join(lines, "\n"))
}

func (m *model) applyTheme() {
	fg, bg, muted := "252", "235", "245"
	if m.theme == "light" {
		fg, bg, muted = "235", "255", "242"
	}
	base := lipgloss.NewStyle().Foreground(lipgloss.Color(fg)).Background(lipgloss.Color(bg))
	style := textarea.Style{Base: base, Text: base, CursorLine: base, Placeholder: base.Foreground(lipgloss.Color(muted)), EndOfBuffer: base}
	m.editor.FocusedStyle = style
	m.editor.BlurredStyle = style
	m.editor.Cursor.Style = base
}
