package main

import (
	"errors"
	"strings"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type promptKind int

const (
	promptNew promptKind = iota
	promptRename
)

// namePrompt asks for a note path when creating or renaming a note.
type namePrompt struct {
	kind  promptKind
	input textinput.Model
	// fromLink is set when the new note comes from following a missing [[link]].
	fromLink bool
}

func (m *model) openPrompt(kind promptKind, value string) tea.Cmd {
	p := paletteFor(m.theme)
	base := ink(p.text).Background(lipgloss.Color(p.surface))
	in := textinput.New()
	in.Prompt = ""
	in.CharLimit = 255
	in.TextStyle = base
	in.PlaceholderStyle = base.Foreground(lipgloss.Color(p.muted))
	in.Cursor.Style = ink(p.accent)
	in.Placeholder = "Untitled"
	in.SetValue(value)
	in.CursorEnd()
	cmd := in.Focus()
	m.prompt = &namePrompt{kind: kind, input: in}
	m.editor.Blur()
	return cmd
}
func (m *model) closePrompt() {
	m.prompt = nil
	if m.mode != 1 {
		m.editor.Focus()
	}
}

// promptValue turns the typed text into a note ID; an empty name, or a
// folder ending in "/", gets the next free "Untitled" name there.
func (m *model) promptValue() string {
	value := strings.TrimSpace(strings.ReplaceAll(m.prompt.input.Value(), `\`, "/"))
	value = strings.TrimSuffix(strings.TrimPrefix(value, "/"), ".md")
	if value == "" || strings.HasSuffix(value, "/") {
		return freeName(m.notes, strings.TrimSuffix(value, "/"), "Untitled")
	}
	return value
}
func (m *model) updatePrompt(msg tea.KeyMsg) tea.Cmd {
	switch msg.String() {
	case "esc":
		m.closePrompt()
		return nil
	case "enter":
		id := m.promptValue()
		var err error
		if m.prompt.kind == promptNew {
			err = m.createNote(id, m.prompt.fromLink)
		} else {
			err = m.renameNote(id)
		}
		if err != nil {
			m.status = err.Error()
			return nil
		}
		m.closePrompt()
		return tea.Batch(textarea.Blink, m.requestRender())
	}
	var cmd tea.Cmd
	m.prompt.input, cmd = m.prompt.input.Update(msg)
	return cmd
}

// createNote saves the current note, then creates and opens id.
func (m *model) createNote(id string, fromLink bool) error {
	if err := m.flush(); err != nil {
		return err
	}
	n, err := m.store.create(id)
	if err != nil {
		return err
	}
	if fromLink && len(m.notes) > 0 {
		m.history = append(m.history, m.notes[m.index].ID)
	}
	m.notes = append(m.notes, n)
	sortNotes(m.notes)
	m.selectID(n.ID)
	m.mode = 0
	m.loadNote()
	m.resize()
	m.reindex()
	m.status = "Saved"
	return nil
}

// renameNote saves the current note, moves it to id and updates [[links]] to it.
func (m *model) renameNote(id string) error {
	if len(m.notes) == 0 {
		return nil
	}
	if err := m.flush(); err != nil {
		return err
	}
	old := m.notes[m.index]
	if id == old.ID {
		return nil
	}
	err := m.store.rename(old, id)
	var moved movedSyncError
	if err != nil && !errors.As(err, &moved) {
		return err
	}
	m.notes[m.index].ID = id
	for i, h := range m.history {
		if h == old.ID {
			m.history[i] = id
		}
	}
	m.status = "Renamed to " + id
	if err != nil {
		m.status += "; directory sync failed: " + err.Error()
	}
	m.status += m.rewriteLinks(old.ID, id)
	sortNotes(m.notes)
	m.selectID(id)
	m.reindex()
	return nil
}

// selectID makes the note with id current without loading it.
func (m *model) selectID(id string) bool {
	for i, n := range m.notes {
		if n.ID == id {
			m.index = i
			return true
		}
	}
	return false
}

func (m *model) promptView(p palette) string {
	label, color, hint := "NEW NOTE", p.good, "Folder/Name creates folders · empty name: Untitled"
	if m.prompt.kind == promptRename {
		label, color, hint = "RENAME", p.warn, "Folder/Name moves the note · [[links]] to it are updated"
	}
	return pill(label, p.onPill, color) + " " + m.prompt.input.View() +
		"\n\n" + ink(p.muted).Render(hint) +
		"\n\n" + pill("Enter", p.onPill, p.good) + ink(p.muted).Render(" confirm   ") + pill("Esc", p.onPill, p.danger) + ink(p.muted).Render(" cancel")
}
