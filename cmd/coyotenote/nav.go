package main

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/eg36/coyotenote/internal/vault"
)

// jump saves the current note and opens id, remembering where it came from
// so Ctrl+Y can go back.
func (m *model) jump(id string) bool {
	if m.flush() != nil {
		return false
	}
	if len(m.notes) > 0 {
		if m.notes[m.index].ID == id {
			return true
		}
		m.history = append(m.history, m.notes[m.index].ID)
	}
	if !m.selectID(id) {
		return false
	}
	m.loadNote()
	return true
}

// back returns to the most recent note in the history that still exists.
func (m *model) back() {
	for len(m.history) > 0 {
		id := m.history[len(m.history)-1]
		if len(m.notes) > 0 && m.notes[m.index].ID == id {
			m.history = m.history[:len(m.history)-1]
			continue
		}
		if m.flush() != nil {
			return
		}
		m.history = m.history[:len(m.history)-1]
		if m.selectID(id) {
			m.loadNote()
			return
		}
	}
	m.status = "No earlier note to go back to"
}

// cursorOffset is the cursor's row, rune column and byte offset in the editor value.
func (m *model) cursorOffset(value string) (row, col, offset int) {
	lines := strings.Split(value, "\n")
	row = min(m.editor.Line(), len(lines)-1)
	info := m.editor.LineInfo()
	runes := []rune(lines[row])
	col = min(info.StartColumn+info.ColumnOffset, len(runes))
	for _, line := range lines[:row] {
		offset += len(line) + 1
	}
	return row, col, offset + len(string(runes[:col]))
}

// followLink opens the [[link]] under the cursor. A missing target opens the
// new-note prompt with the link's name, in the current note's folder.
func (m *model) followLink() tea.Cmd {
	if len(m.notes) == 0 {
		return nil
	}
	value := m.editor.Value()
	_, _, pos := m.cursorOffset(value)
	from := m.notes[m.index].ID
	for _, l := range vault.ParseLinks(value) {
		if pos < l.Start || pos > l.End {
			continue
		}
		if id, ok := vault.NewResolver(m.notes).Resolve(l.Target, from); ok {
			m.jump(id)
			return m.requestRender()
		}
		target := strings.TrimSuffix(strings.ReplaceAll(l.Target, `\`, "/"), ".md")
		if !strings.Contains(target, "/") {
			target = vault.JoinID(vault.FolderOf(from), target)
		}
		cmd := m.openPrompt(promptNew, target)
		m.prompt.fromLink = true
		return cmd
	}
	m.status = "No [[link]] under the cursor"
	return nil
}

// completion suggests notes while a [[link]] is being typed.
type completion struct {
	row, start int // cursor row and the rune column of "[["
	items      []string
	selected   int
}

var openLink = regexp.MustCompile(`\[\[([^\[\]|#\n]*)$`)

const maxSuggestions = 8

func (m *model) updateCompletion() {
	m.complete = nil
	if m.mode == 1 || len(m.notes) == 0 || m.prompt != nil || m.picker != nil {
		return
	}
	value := m.editor.Value()
	row, col, _ := m.cursorOffset(value)
	before := string([]rune(strings.Split(value, "\n")[row])[:col])
	match := openLink.FindStringSubmatchIndex(before)
	if match == nil {
		m.dismissed = [2]int{-1, -1}
		return
	}
	start := utf8.RuneCountInString(before[:match[0]])
	if m.dismissed == [2]int{row, start} {
		return
	}
	query := before[match[2]:match[3]]
	from := m.notes[m.index].ID
	r := vault.NewResolver(m.notes)
	var targets []string
	for _, n := range m.notes {
		if n.ID != from && !vault.LegacyID.MatchString(n.ID) {
			targets = append(targets, r.ShortTarget(n.ID, from))
		}
	}
	var items []string
	if query == "" {
		items = targets[:min(maxSuggestions, len(targets))]
	} else {
		for _, rank := range list.DefaultFilter(query, targets) {
			if items = append(items, targets[rank.Index]); len(items) == maxSuggestions {
				break
			}
		}
	}
	if len(items) > 0 {
		m.complete = &completion{row: row, start: start, items: items}
	}
}

// updateCompletionKeys handles keys while suggestions are shown. It reports
// false for keys the editor should receive.
func (m *model) updateCompletionKeys(k tea.KeyMsg) (tea.Cmd, bool) {
	c := m.complete
	switch k.String() {
	case "up":
		c.selected = (c.selected + len(c.items) - 1) % len(c.items)
	case "down":
		c.selected = (c.selected + 1) % len(c.items)
	case "esc":
		m.dismissed = [2]int{c.row, c.start}
		m.complete = nil
	case "tab", "enter":
		return m.acceptCompletion(), true
	default:
		return nil, false
	}
	return nil, true
}

// acceptCompletion replaces the typed query with the chosen name and "]]".
func (m *model) acceptCompletion() tea.Cmd {
	c := m.complete
	m.complete = nil
	lines := strings.Split(m.editor.Value(), "\n")
	_, col, _ := m.cursorOffset(m.editor.Value())
	line := []rune(lines[c.row])
	after := string(line[col:])
	insert := c.items[c.selected]
	if !strings.HasPrefix(after, "]]") {
		insert += "]]"
	}
	lines[c.row] = string(line[:c.start+2]) + insert + after
	m.editor.SetValue(strings.Join(lines, "\n"))
	offset := 0
	for _, line := range lines[:c.row] {
		offset += utf8.RuneCountInString(line) + 1
	}
	m.editor.SetOffset(offset + c.start + 2 + utf8.RuneCountInString(c.items[c.selected]) + 2)
	return m.edited()
}

// openBacklinks lists the notes that link to the current one.
func (m *model) openBacklinks() tea.Cmd {
	if len(m.notes) == 0 {
		return nil
	}
	sources := m.backlinks[m.notes[m.index].ID]
	if len(sources) == 0 {
		m.status = "No notes link here yet"
		return nil
	}
	return m.openPickerFor(sources, true)
}
