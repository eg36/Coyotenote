package main

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// tabKey inserts a tab, or indents every line a multi-line selection touches.
// Shift+Tab removes one level of indentation, a tab or up to four spaces, from
// the cursor's line or every selected line.
func (m *model) tabKey(outdent bool) tea.Cmd {
	lo, hi := m.editor.SelectionBounds()
	value := []rune(m.editor.Value())
	if !outdent && !strings.ContainsRune(string(value[lo:hi]), '\n') {
		return m.insertText("\t", false)
	}
	lines := strings.Split(string(value), "\n")
	starts := make([]int, len(lines))
	for i := 1; i < len(lines); i++ {
		starts[i] = starts[i-1] + len([]rune(lines[i-1])) + 1
	}
	lineOf := func(offset int) int {
		i := len(starts) - 1
		for i > 0 && starts[i] > offset {
			i--
		}
		return i
	}
	first, last := lineOf(lo), lineOf(hi)
	if hi > lo && starts[last] == hi {
		last-- // A selection ending at a line start leaves that line alone.
	}
	deltas := make([]int, len(lines))
	changed := false
	for i := first; i <= last; i++ {
		line := lines[i]
		switch {
		case !outdent:
			lines[i] = "\t" + line
			deltas[i] = 1
		case strings.HasPrefix(line, "\t"):
			lines[i] = line[1:]
			deltas[i] = -1
		default:
			spaces := len(line) - len(strings.TrimLeft(line, " "))
			spaces = min(spaces, 4)
			lines[i] = line[spaces:]
			deltas[i] = -spaces
		}
		changed = changed || deltas[i] != 0
	}
	if !changed {
		return nil
	}
	// Offsets keep their place in the text: lines above shift them by their
	// deltas; on a changed line, removed indentation pulls them to its start.
	// Indenting keeps an offset at a line start before the new tab.
	moved := func(offset int) int {
		i := lineOf(offset)
		shift := 0
		for j := 0; j < i; j++ {
			shift += deltas[j]
		}
		column := offset - starts[i]
		if column > 0 || deltas[i] < 0 {
			column = max(0, column+deltas[i])
		}
		return starts[i] + shift + column
	}
	anchor, cursor := moved(lo), moved(hi)
	if m.editor.CursorOffset() == lo {
		anchor, cursor = cursor, anchor
	}
	m.complete = nil
	m.editor.SetValue(strings.Join(lines, "\n"))
	if lo == hi {
		m.editor.SetOffset(cursor)
	} else {
		m.editor.SetOffset(anchor)
		m.editor.StartSelection()
		m.editor.SetOffset(cursor)
	}
	m.followCursor()
	return m.edited()
}
