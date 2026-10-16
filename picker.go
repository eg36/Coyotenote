package main

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// pickerItem is a note, or with folder set, a folder whose path is id ("" is
// the vault root).
type pickerItem struct {
	id, title, description string
	folder                 bool
}

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
	ids := make([]string, len(m.notes))
	for i, n := range m.notes {
		ids[i] = n.ID
	}
	return m.openPickerFor(ids, false)
}

// openPickerFor lists the notes with ids. For backlinks, each description is
// the line that links to the current note.
func (m *model) openPickerFor(ids []string, backlinks bool) tea.Cmd {
	p := paletteFor(m.theme)
	current := ""
	if len(m.notes) > 0 {
		current = m.notes[m.index].ID
	}
	r := newResolver(m.notes)
	items := make([]list.Item, 0, len(ids))
	bodies := make([]string, 0, len(ids))
	byID := make(map[string]string, len(m.notes))
	for _, n := range m.notes {
		byID[n.ID] = n.Body
	}
	startAt := 0
	for _, id := range ids {
		body := byID[id]
		if id == current {
			body = m.editor.Value()
			startAt = len(items)
		}
		desc := ""
		for _, line := range strings.Split(body, "\n") {
			line = strings.TrimSpace(line)
			if backlinks {
				linked := false
				for _, l := range parseLinks(line) {
					if got, ok := r.resolve(l.target, id); ok && got == current {
						linked = true
					}
				}
				if !linked {
					continue
				}
			} else if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			desc = ansi.Truncate(line, 80, "…")
			break
		}
		items = append(items, pickerItem{id: id, title: displayName(id, body), description: fmt.Sprintf("%s · %d words", desc, len(strings.Fields(body)))})
		bodies = append(bodies, strings.ToLower(body))
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
		if strings.HasSuffix(term, "/") {
			return folderFilter(term, targets)
		}
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
	m.picker = &l
	m.pickerBacklinks = backlinks
	m.pickerSearch = items
	m.pickerFolder = folderOf(current)
	m.setPickerFilter("")
	if backlinks {
		m.picker.Select(startAt)
	} else {
		m.selectPickerItem(current, false)
	}
	m.editor.Blur()
	return nil
}

// folderFilter matches "Folder/" exactly: every note below that folder, in order.
func folderFilter(term string, targets []string) []list.Rank {
	prefix := strings.ToLower(term)
	matched := make([]int, utf8.RuneCountInString(term))
	for i := range matched {
		matched[i] = i
	}
	var ranks []list.Rank
	for i, t := range targets {
		if strings.HasPrefix(strings.ToLower(t), prefix) {
			ranks = append(ranks, list.Rank{Index: i, MatchedIndexes: matched})
		}
	}
	return ranks
}

// browseItems lists folder: a way up, its subfolders, then its notes.
func (m *model) browseItems(folder string) []list.Item {
	prefix := ""
	if folder != "" {
		prefix = folder + "/"
	}
	counts := map[string]int{}
	var items, notes []list.Item
	for _, item := range m.pickerSearch {
		n := item.(pickerItem)
		rest, ok := strings.CutPrefix(n.id, prefix)
		if !ok {
			continue
		}
		if child, _, nested := strings.Cut(rest, "/"); nested {
			counts[child]++
			continue
		}
		n.title = strings.TrimPrefix(n.title, prefix)
		notes = append(notes, n)
	}
	if folder != "" {
		parent := folderOf(folder)
		where := parent + "/"
		if parent == "" {
			where = "the vault root"
		}
		items = append(items, pickerItem{id: parent, title: "◂ ..", description: "back to " + where, folder: true})
	}
	children := make([]string, 0, len(counts))
	for child := range counts {
		children = append(children, child)
	}
	sort.Slice(children, func(i, j int) bool { return strings.ToLower(children[i]) < strings.ToLower(children[j]) })
	for _, child := range children {
		noun := "notes"
		if counts[child] == 1 {
			noun = "note"
		}
		items = append(items, pickerItem{id: prefix + child, title: "▸ " + child + "/", description: fmt.Sprintf("%d %s", counts[child], noun), folder: true})
	}
	return append(items, notes...)
}

// setPickerFilter applies the filter text: an empty one browses the current
// folder, anything else searches the whole vault.
func (m *model) setPickerFilter(value string) {
	items := m.pickerSearch
	if value == "" && !m.pickerBacklinks {
		items = m.browseItems(m.pickerFolder)
	}
	m.picker.SetItems(items)
	m.picker.SetFilterText(value)
	m.picker.SetFilterState(list.Filtering)
}

// selectPickerItem selects the note or folder id in the visible list.
func (m *model) selectPickerItem(id string, folder bool) {
	for i, item := range m.picker.VisibleItems() {
		if p := item.(pickerItem); p.id == id && p.folder == folder && p.title != "◂ .." {
			m.picker.Select(i)
			return
		}
	}
}

// openFolder browses folder, selecting the entry named by from when present.
func (m *model) openFolder(folder, from string) {
	m.pickerFolder = folder
	m.setPickerFilter("")
	m.selectPickerItem(from, true)
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
			if item.folder {
				m.openFolder(item.id, m.pickerFolder)
				return nil
			}
			if !m.jump(item.id) {
				return nil
			}
			m.closePicker()
			if m.mode == 1 {
				m.editor.Blur()
			}
			return tea.Batch(m.requestRender(), textarea.Blink)
		case "esc":
			if m.picker.FilterValue() != "" {
				m.setPickerFilter("")
				return nil
			}
			m.closePicker()
			return nil
		case "backspace":
			if m.picker.FilterValue() == "" && !m.pickerBacklinks && m.pickerFolder != "" {
				m.openFolder(folderOf(m.pickerFolder), m.pickerFolder)
				return nil
			}
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
			m.setPickerFilter(input.Value())
		}
		return cmd
	}
	var cmd tea.Cmd
	*m.picker, cmd = m.picker.Update(msg)
	return cmd
}
