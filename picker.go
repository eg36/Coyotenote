package main

import (
	"fmt"
	"io"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

type pickerItem struct{ id, title, description string }

func (i pickerItem) Title() string       { return i.title }
func (i pickerItem) Description() string { return i.description }
func (i pickerItem) FilterValue() string { return i.title }

// Render selection while the filter input remains focused for immediate typing.
type pickerDelegate struct{ list.DefaultDelegate }

func (d pickerDelegate) Render(w io.Writer, m list.Model, index int, item list.Item) {
	selected := m.Index()
	m.SetFilterState(list.FilterApplied)
	m.Select(selected)
	d.DefaultDelegate.Render(w, m, index, item)
}

func (m *model) openPicker() tea.Cmd {
	p := paletteFor(m.theme)
	items := make([]list.Item, len(m.notes))
	bodies := make([]string, len(m.notes))
	for i, n := range m.notes {
		body := n.Body
		if i == m.index {
			body = m.editor.Value()
		}
		desc := ""
		for _, line := range strings.Split(body, "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				desc = ansi.Truncate(line, 80, "…")
				break
			}
		}
		items[i] = pickerItem{n.ID, title(body), fmt.Sprintf("%s · %d words", desc, len(strings.Fields(body)))}
		bodies[i] = strings.ToLower(body)
	}
	base := ink(p.text).Background(lipgloss.Color(p.surface))
	muted := base.Foreground(lipgloss.Color(p.muted))
	selected := base.Foreground(lipgloss.Color(p.accent)).Bold(true).Border(lipgloss.NormalBorder(), false, false, false, true).BorderForeground(lipgloss.Color(p.accent)).BorderBackground(lipgloss.Color(p.surface)).PaddingLeft(1)
	d := list.NewDefaultDelegate()
	d.Styles = list.DefaultItemStyles{NormalTitle: base.PaddingLeft(2), NormalDesc: muted.PaddingLeft(2), SelectedTitle: selected, SelectedDesc: selected.Foreground(lipgloss.Color(p.muted)).Bold(false), DimmedTitle: muted.PaddingLeft(2), DimmedDesc: muted.PaddingLeft(2), FilterMatch: base.Underline(true)}
	l := list.New(items, pickerDelegate{d}, max(1, m.width-4), max(1, m.height-7))
	l.SetShowHelp(false)
	l.SetShowStatusBar(true)
	l.SetFilteringEnabled(true)
	l.DisableQuitKeybindings()
	l.Styles = list.Styles{TitleBar: base, Title: base, Spinner: base, FilterPrompt: base, FilterCursor: base, DefaultFilterCharacterMatch: base.Underline(true), StatusBar: muted, StatusEmpty: muted, StatusBarActiveFilter: base, StatusBarFilterCount: muted, NoItems: muted, PaginationStyle: muted, HelpStyle: muted, ActivePaginationDot: base.SetString("•"), InactivePaginationDot: muted.SetString("•"), ArabicPagination: muted, DividerDot: muted.SetString(" · ")}
	l.FilterInput.Prompt = gradient("Find ", true, p.accent, p.pink, p.cyan)
	l.FilterInput.TextStyle = base
	l.FilterInput.PromptStyle = base
	l.FilterInput.Cursor.Style = base.Foreground(lipgloss.Color(p.accent))
	l.Filter = func(term string, targets []string) []list.Rank {
		ranks := list.DefaultFilter(term, targets)
		seen := make(map[int]bool, len(ranks))
		for _, r := range ranks {
			seen[r.Index] = true
		}
		for i, body := range bodies {
			if !seen[i] && strings.Contains(body, strings.ToLower(term)) {
				ranks = append(ranks, list.Rank{Index: i})
			}
		}
		return ranks
	}
	l.SetFilterText("")
	l.SetFilterState(list.Filtering)
	l.Select(m.index)
	m.picker = &l
	m.editor.Blur()
	return nil
}
func (m *model) closePicker() {
	m.picker = nil
	if m.mode != 1 {
		m.editor.Focus()
	}
}
func (m *model) updatePicker(msg tea.Msg) tea.Cmd {
	if k, ok := msg.(tea.KeyMsg); ok {
		switch k.String() {
		case "enter":
			item, ok := m.picker.SelectedItem().(pickerItem)
			if !ok {
				return nil
			}
			if m.flush() != nil {
				return nil
			}
			for i, n := range m.notes {
				if n.ID == item.id {
					m.index = i
					break
				}
			}
			m.loadNote()
			m.closePicker()
			if m.mode == 1 {
				m.editor.Blur()
			}
			return tea.Batch(m.requestRender(), textarea.Blink)
		case "esc":
			if m.picker.FilterValue() != "" {
				m.picker.SetFilterText("")
				m.picker.SetFilterState(list.Filtering)
				return nil
			}
			m.closePicker()
			return nil
		case "up":
			m.picker.CursorUp()
			return nil
		case "down":
			m.picker.CursorDown()
			return nil
		}
	}
	// Resolve filtering synchronously so a fast Enter cannot select stale results.
	if k, ok := msg.(tea.KeyMsg); ok {
		input, cmd := m.picker.FilterInput.Update(k)
		before := m.picker.FilterValue()
		m.picker.FilterInput = input
		if before != input.Value() {
			m.picker.SetFilterText(input.Value())
			m.picker.SetFilterState(list.Filtering)
		}
		return cmd
	}
	var cmd tea.Cmd
	*m.picker, cmd = m.picker.Update(msg)
	return cmd
}
