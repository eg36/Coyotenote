package editor

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss"
	"github.com/rivo/uniseg"
)

// Tabs stay in the source and are drawn as tabWidth cells. cellWidth and
// displayText keep wrapping, cursor movement and rendering on one grid.
const tabWidth = 4

var tabSpaces = strings.Repeat(" ", tabWidth)

func cellWidth(s string) int      { return uniseg.StringWidth(s) + strings.Count(s, "\t")*tabWidth }
func displayText(s string) string { return strings.ReplaceAll(s, "\t", tabSpaces) }

// sourceSanitizer keeps tabs and U+FFFD, which are valid note text, and drops
// other control characters so they never reach the terminal. CRLF and lone CR
// become one newline.
type sourceSanitizer struct{}

func (sourceSanitizer) Sanitize(runes []rune) []rune {
	out := make([]rune, 0, len(runes))
	for i, r := range runes {
		switch {
		case r == '\r':
			if i+1 < len(runes) && runes[i+1] == '\n' {
				continue
			}
			out = append(out, '\n')
		case r == '\n' || r == '\t' || !unicode.IsControl(r):
			out = append(out, r)
		}
	}
	return out
}

// CursorOffset is a rune offset in the complete source, independent of wrapping.
func (m Model) CursorOffset() int {
	offset := m.col
	for _, line := range m.value[:m.row] {
		offset += len(line) + 1
	}
	return offset
}

// SetOffset moves to a source rune offset and scrolls the cursor into view.
func (m *Model) SetOffset(offset int) {
	offset = max(0, offset)
	m.row = 0
	for m.row < len(m.value)-1 && offset > len(m.value[m.row]) {
		offset -= len(m.value[m.row]) + 1
		m.row++
	}
	m.SetCursor(offset)
	m.repositionView()
}

func (m *Model) StartSelection() {
	if !m.selecting {
		m.SnapCluster(false)
		m.anchor = m.CursorOffset()
		m.selecting = true
	}
}
func (m *Model) ClearSelection()   { m.selecting = false }
func (m Model) HasSelection() bool { return m.selecting && m.anchor != m.CursorOffset() }
func (m Model) SelectionBounds() (int, int) {
	cursor := m.CursorOffset()
	if !m.selecting {
		return cursor, cursor
	}
	return min(m.anchor, cursor), max(m.anchor, cursor)
}
func (m Model) SelectedText() string {
	lo, hi := m.SelectionBounds()
	return string([]rune(m.Value())[lo:hi])
}

// ReplaceSelection operates on source positions, then resets the display cache
// through SetValue. The caller validates the resulting size before mutation.
func (m *Model) ReplaceSelection(text string) {
	lo, hi := m.SelectionBounds()
	value := []rune(m.Value())
	m.SetValue(string(value[:lo]) + text + string(value[hi:]))
	m.ClearSelection()
	m.SetOffset(lo + utf8.RuneCountInString(text))
}

// MoveCluster keeps Shift+Left/Right from splitting combining marks or emoji.
func (m *Model) MoveCluster(forward bool) {
	current := m.CursorOffset()
	g := uniseg.NewGraphemes(m.Value())
	offset, previous := 0, 0
	for g.Next() {
		next := offset + utf8.RuneCountInString(g.Str())
		if forward && next > current {
			m.SetOffset(next)
			return
		}
		if !forward && next >= current {
			m.SetOffset(previous)
			return
		}
		previous = next
		offset = next
	}
}

// renderSource uses exactly the same wrapped rows as the textarea cursor. ANSI
// styles are applied to whole graphemes so wide and combining text stays intact.
func (m Model) renderSource(row, column, base, lo, hi int, runes []rune, style lipgloss.Style) string {
	if row != m.row && (lo == hi || base+column >= hi || base+column+len(runes) <= lo) {
		return style.Render(displayText(string(runes)))
	}
	g := uniseg.NewGraphemes(string(runes))
	var out, run strings.Builder
	previousSelected := false
	flush := func() {
		if run.Len() == 0 {
			return
		}
		cellStyle := style
		if previousSelected {
			cellStyle = m.SelectionStyle.Inherit(style)
		}
		out.WriteString(cellStyle.Render(run.String()))
		run.Reset()
	}
	for g.Next() {
		text := g.Str()
		size := utf8.RuneCountInString(text)
		pos := base + column
		selected := lo != hi && pos >= lo && pos < hi
		cursor := row == m.row && m.col >= column && m.col < column+size
		if selected != previousSelected || cursor {
			flush()
			previousSelected = selected
		}
		if cursor {
			m.Cursor.SetChar(displayText(text))
			cellStyle := style
			if selected {
				cellStyle = m.SelectionStyle.Inherit(style)
			}
			out.WriteString(cellStyle.Render(m.Cursor.View()))
		} else {
			run.WriteString(displayText(text))
		}
		column += size
	}
	flush()
	return out.String()
}

// SnapCluster moves a cursor inside a grapheme to a complete source boundary.
func (m *Model) SnapCluster(forward bool) {
	current := m.CursorOffset()
	offset := 0
	g := uniseg.NewGraphemes(m.Value())
	for g.Next() {
		next := offset + utf8.RuneCountInString(g.Str())
		if current == offset || current == next {
			return
		}
		if current < next {
			if forward {
				m.SetOffset(next)
			} else {
				m.SetOffset(offset)
			}
			return
		}
		offset = next
	}
}

// cursorVertical keeps the visual column while traversing the actual wrapped
// grid. Summing source runes avoids guessing at wrap boundaries or wide cells.
func (m *Model) cursorVertical(delta int) {
	info := m.LineInfo()
	desired := max(m.lastCharOffset, info.CharOffset)
	m.lastCharOffset = desired
	row, displayRow := m.row, info.RowOffset+delta
	grid := m.memoizedWrap(m.value[row], m.width)
	if displayRow < 0 {
		if row == 0 {
			return
		}
		row--
		grid = m.memoizedWrap(m.value[row], m.width)
		displayRow = len(grid) - 1
	} else if displayRow >= len(grid) {
		if row >= len(m.value)-1 {
			return
		}
		row++
		grid = m.memoizedWrap(m.value[row], m.width)
		displayRow = 0
	}
	column := 0
	for _, line := range grid[:displayRow] {
		column += len(line)
	}
	rowStart := column
	cells := 0
	clusters := uniseg.NewGraphemes(string(grid[displayRow]))
	for clusters.Next() {
		text := clusters.Str()
		size := utf8.RuneCountInString(text)
		width := cellWidth(text)
		if cells+width > desired || column+size > len(m.value[row]) || (displayRow < len(grid)-1 && column+size >= rowStart+len(grid[displayRow])) {
			break
		}
		column += size
		cells += width
	}
	m.row = row
	m.col = min(column, len(m.value[row]))
}
