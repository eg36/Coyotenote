package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/charmbracelet/bubbles/runeutil"
	tea "github.com/charmbracelet/bubbletea"
)

type clipboardBackend interface {
	Read(context.Context) (string, error)
	Write(context.Context, string) error
}

type clipboardResult struct {
	epoch, revision uint64
	id              string
	kind            string
	text            string
	err             error
}

// clipboardCommand captures the source state: delayed results must never mutate
// a different note, a changed selection, or text edited since the request.
func (m *model) clipboardCommand(kind string) tea.Cmd {
	if m.clipboardBusy {
		m.status = "Clipboard operation in progress"
		return nil
	}
	if kind != "paste" && !m.editor.HasSelection() {
		m.status = "Select text first · Shift+arrows"
		return nil
	}
	m.clipboardBusy = true
	request := clipboardResult{epoch: m.inputEpoch, revision: m.revision, id: m.notes[m.index].ID, kind: kind, text: m.editor.SelectedText()}
	backend := m.clipboard
	m.status = "Clipboard…"
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if kind == "paste" {
			request.text, request.err = backend.Read(ctx)
		} else {
			request.err = backend.Write(ctx, request.text)
		}
		return request
	}
}
func (m *model) clipboardDone(result clipboardResult) tea.Cmd {
	m.clipboardBusy = false
	if result.err != nil {
		m.status = "Clipboard: " + result.err.Error()
		return nil
	}
	if result.kind == "copy" {
		m.status = "Copied selection"
		return nil
	}
	if len(m.notes) == 0 || m.notes[m.index].ID != result.id || m.inputEpoch != result.epoch || m.revision != result.revision || m.picker != nil || m.prompt != nil || m.themePicker != nil || m.help || m.confirm || m.mode == 1 {
		m.status = "Clipboard finished; editor changed, so text was left untouched"
		return nil
	}
	if result.kind == "cut" {
		m.editor.ReplaceSelection("")
		m.complete = nil
		cmd := m.edited()
		m.status = "Cut selection"
		return cmd
	}
	return m.insertText(result.text, true)
}

// normalizedInput gives terminal and clipboard paste the same validation and
// newline handling. Controls are rejected before anything in the editor changes.
func normalizedInput(text string) (string, error) {
	if !utf8.ValidString(text) {
		return "", errors.New("text is not valid UTF-8")
	}
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	for _, r := range text {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return "", errors.New("text contains unsupported control characters")
		}
	}
	return string(runeutil.NewSanitizer(runeutil.ReplaceTabs("\t")).Sanitize([]rune(text))), nil
}
func (m *model) insertText(text string, paste bool) tea.Cmd {
	if paste && text == "" {
		m.status = "Clipboard is empty"
		return nil
	}
	if paste && len(text) > maxPasteBytes {
		m.status = "Paste rejected: clipboard exceeds 1 MiB"
		return nil
	}
	text, err := normalizedInput(text)
	if err != nil {
		m.status = "Paste rejected: " + err.Error()
		return nil
	}
	lo, hi := m.editor.SelectionBounds()
	value := []rune(m.editor.Value())
	candidate := string(value[:lo]) + text + string(value[hi:])
	if strings.Count(candidate, "\n") >= maxLines {
		m.status = fmt.Sprintf("Paste rejected: notes are limited to %d lines", maxLines)
		return nil
	}
	if text == "" && !m.editor.HasSelection() {
		return nil
	}
	m.editor.ReplaceSelection(text)
	m.followCursor()
	m.updateCompletion()
	return m.edited()
}

// selectionKeys owns editor selection and clipboard keys. Modal inputs are
// routed before this handler so their editing behavior stays independent.
func (m *model) selectionKeys(k tea.KeyMsg) (tea.Cmd, bool) {
	name := k.String()
	switch name {
	case "ctrl+c":
		return m.clipboardCommand("copy"), true
	case "ctrl+x":
		return m.clipboardCommand("cut"), true
	case "ctrl+v":
		return m.clipboardCommand("paste"), true
	}
	if strings.HasPrefix(name, "shift+") {
		movement := strings.TrimPrefix(name, "shift+")
		switch movement {
		case "left", "right", "up", "down", "home", "end":
			m.complete = nil
			m.editor.StartSelection()
			switch movement {
			case "left":
				m.editor.MoveCluster(false)
			case "right":
				m.editor.MoveCluster(true)
			case "home":
				m.editor.CursorStart()
			case "end":
				m.editor.CursorEnd()
			default:
				key := tea.KeyUp
				if movement == "down" {
					key = tea.KeyDown
				}
				m.editor, _ = m.editor.Update(tea.KeyMsg{Type: key})
				m.editor.SnapCluster(movement == "down")
			}
			m.followCursor()
			return nil, true
		}
	}
	if k.Paste {
		return m.insertText(string(k.Runes), true), true
	}
	if !m.editor.HasSelection() {
		return nil, false
	}
	switch name {
	case "esc":
		m.editor.ClearSelection()
		return nil, true
	case "left", "up", "right", "down":
		lo, hi := m.editor.SelectionBounds()
		offset := lo
		if name == "right" || name == "down" {
			offset = hi
		}
		m.editor.ClearSelection()
		m.editor.SetOffset(offset)
		m.followCursor()
		return nil, true
	case "backspace", "ctrl+h", "delete":
		return m.insertText("", false), true
	case "enter", "ctrl+m":
		return m.insertText("\n", false), true
	}
	if k.Type == tea.KeyRunes && !k.Alt {
		return m.insertText(string(k.Runes), false), true
	}
	// Other editor commands may change the source or cursor; discard the range.
	m.editor.ClearSelection()
	return nil, false
}
