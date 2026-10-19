package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/glamour/styles"
	"github.com/charmbracelet/lipgloss"
	textarea "github.com/eg36/coyotenote/internal/editor"
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

var keys = struct {
	new, del, prev, next, mode, theme, save, help, quit, undo, picker key.Binding
	rename, follow, back, backlinks                                   key.Binding
}{binding("ctrl+n"), binding("ctrl+d"), binding("alt+up", "ctrl+pgup"), binding("alt+down", "ctrl+pgdown"), binding("ctrl+p"), binding("ctrl+t"), binding("ctrl+s"), binding("f1"), binding("ctrl+q"), binding("ctrl+z"), binding("ctrl+o"),
	binding("ctrl+r"), binding("ctrl+g"), binding("ctrl+y"), binding("ctrl+l")}

type model struct {
	helpOffset    int
	clipboard     clipboardBackend
	clipboardBusy bool
	inputEpoch    uint64
	themePicker   *themeChooser

	store           *store
	notes           []note
	trashed         []string
	picker          *list.Model
	pickerBacklinks bool
	// pickerFolder is the folder Ctrl+O browses; pickerSearch holds every
	// listed note, for searching.
	pickerFolder string
	pickerSearch []list.Item
	prompt       *namePrompt
	complete     *completion
	// dismissed is the row and column of a [[ whose suggestions Esc closed.
	dismissed [2]int
	// history holds notes left by jumps, for Ctrl+Y.
	history              []string
	backlinks            map[string][]string
	index                int
	editor               textarea.Model
	preview              viewport.Model
	width, height, mode  int
	theme, status        string
	dirty, confirm, help bool
	// crlf records that the open note uses CRLF line endings on disk.
	crlf           bool
	revision       uint64
	shown, pending previewKey
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
	e.KeyMap.Paste.SetEnabled(false) // App-owned clipboard messages share the paste validation path.
	e.KeyMap.WordForward.SetKeys("alt+right", "alt+f", "ctrl+right")
	e.KeyMap.WordBackward.SetKeys("alt+left", "alt+b", "ctrl+left")
	m := &model{clipboard: desktopClipboard{}, store: s, notes: notes, editor: e, preview: viewport.New(40, 10), width: 80, height: 24, theme: "dark", status: "Saved", dismissed: [2]int{-1, -1}}
	if b, err := os.ReadFile(filepath.Join(s.config, "theme")); err == nil {
		if name := strings.TrimSpace(string(b)); validTheme(name) {
			m.theme = name
		}
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
	m.reindex()
	return m, nil
}
func (m *model) Init() tea.Cmd { return textarea.Blink }
func (m *model) loadNote() {
	m.editor.SetValue("")
	m.crlf = false
	if len(m.notes) > 0 {
		// The editor works in LF; saves restore the file's CRLF endings.
		var text string
		text, m.crlf = editorText(m.notes[m.index].Body)
		m.editor.SetValue(text)
	}
	// Source offsets avoid walking every soft-wrapped row in a long note.
	m.editor.SetOffset(0)
	m.dirty = false
	m.quitArmed = false
	m.revision++
	m.preview.SetContent("")
	m.preview.GotoTop()
	m.shown, m.pending = previewKey{}, previewKey{}
	m.complete = nil
	m.editor.Focus()
}
func (m *model) flush() error {
	if !m.dirty || len(m.notes) == 0 {
		return nil
	}
	body := m.diskBody()
	if err := m.store.save(m.notes[m.index], body); err != nil {
		m.status = "SAVE FAILED: " + err.Error()
		return err
	}
	m.notes[m.index].Body = body
	m.reindex()
	m.dirty = false
	m.quitArmed = false
	m.status = "Saved"
	return nil
}

// diskBody is the editor text with the note's own line endings.
func (m *model) diskBody() string { return diskText(m.editor.Value(), m.crlf) }

// quit saves and quits. If saving fails, it copies the edits to a recovery file
// and asks for a second quit, so a broken disk never traps the user.
func (m *model) quit() tea.Cmd {
	err := m.flush()
	if err == nil || m.quitArmed {
		return tea.Quit
	}
	m.quitArmed = true
	path, rerr := m.store.writeRecovery(m.notes[m.index], m.diskBody())
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
	if m.picker != nil {
		m.picker.SetSize(max(1, m.width-4), max(1, m.height-7))
	}
}
func renderMarkdown(body, theme string, width int) (string, error) {
	// Use explicit styles, with the same writing surface as the editor.
	// Leave layout padding to the app, rather than Glamour's document margins.
	style := styles.DarkStyleConfig
	if themeIsLight(theme) {
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
	// H1 is a badge; lower levels step through the accent colors.
	style.H1.Color = &p.onPill
	style.H1.BackgroundColor = &p.accent
	h2, h3, h4, h5, h6 := p.headingColor(2), p.headingColor(3), p.headingColor(4), p.headingColor(5), p.headingColor(6)
	style.H2.Color, style.H3.Color, style.H4.Color, style.H5.Color, style.H6.Color = &h2, &h3, &h4, &h5, &h6
	style.Link.Color = &p.blue
	style.LinkText.Color = &p.cyan
	style.Strong.Color = &p.warn
	style.Code.BackgroundColor = &p.surface
	// Named Chroma themes avoid Glamour's global first-theme-wins registry.
	style.CodeBlock.Chroma = nil
	style.CodeBlock.Theme = "coyotenote-" + themeByID(theme).id
	if lipgloss.ColorProfile() == termenv.Ascii {
		style.CodeBlock.Theme = ""
	}
	r, err := glamour.NewTermRenderer(glamour.WithStyles(style), glamour.WithWordWrap(max(10, width)), glamour.WithPreservedNewLines(), glamour.WithColorProfile(lipgloss.ColorProfile()))
	if err != nil {
		return "", err
	}
	out, err := r.Render(body)
	return colorLinks(out, p), err
}

// colorLinks swaps markLinks' markers for underlined link colors: cyan for
// existing notes, muted for missing ones.
func colorLinks(out string, p palette) string {
	open, missing, closing := "", "", ""
	profile := lipgloss.ColorProfile()
	if c := profile.Color(p.cyan); c != nil && c.Sequence(false) != "" {
		open = "\x1b[" + c.Sequence(false) + ";4m"
	}
	if c := profile.Color(p.muted); c != nil && c.Sequence(false) != "" {
		missing = "\x1b[" + c.Sequence(false) + ";4m"
	}
	if c := profile.Color(p.text); c != nil && c.Sequence(false) != "" {
		closing = "\x1b[24;" + c.Sequence(false) + "m"
	}
	return strings.NewReplacer(linkOpen, open, missingOpen, missing, linkClose, closing).Replace(out)
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
	body := markLinks(m.editor.Value(), newResolver(m.notes), m.notes[m.index].ID)
	return func() tea.Msg {
		out, err := renderMarkdown(body, k.theme, k.width)
		return renderedMsg{k, out, err}
	}
}
func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case clipboardResult:
		return m, m.clipboardDone(v)
	case tea.WindowSizeMsg:
		m.width = v.Width
		m.height = v.Height
		m.resize()
		return m, m.requestRender()
	case exitMsg:
		// Signals (often SIGHUP: the terminal is gone) cannot wait for a second
		// quit. Preserve what we can, then exit; main reports any failure.
		if m.flush() != nil {
			if path, err := m.store.writeRecovery(m.notes[m.index], m.diskBody()); err == nil {
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
		m.followCursor()
		return m, nil
	case tea.KeyMsg:
		m.inputEpoch++
		if key.Matches(v, keys.quit) {
			return m, m.quit()
		}
		if m.themePicker != nil {
			return m, m.updateThemePicker(v)
		}
		if m.picker != nil {
			return m, m.updatePicker(v)
		}
		if m.prompt != nil {
			return m, m.updatePrompt(v)
		}

		if m.confirm {
			if v.String() == "y" {
				err := m.store.trash(m.notes[m.index])
				var moved movedSyncError
				if err != nil && !errors.As(err, &moved) {
					m.status = err.Error()
				} else {
					m.trashed = append(m.trashed, m.notes[m.index].ID)
					m.notes = append(m.notes[:m.index], m.notes[m.index+1:]...)
					m.index = max(0, min(m.index, len(m.notes)-1))
					m.loadNote()
					m.reindex()
					m.status = "Moved to trash · Ctrl+Z undo"
					if err != nil {
						m.status += "; directory sync failed: " + err.Error()
					}
				}
				m.confirm = false
			} else if v.String() == "n" || v.String() == "esc" {
				m.confirm = false
			}
			return m, m.requestRender()
		}
		if key.Matches(v, keys.help) {
			m.editor.ClearSelection()
			m.complete = nil
			m.help = !m.help
			m.helpOffset = 0
			return m, nil
		}
		if m.help {
			switch v.String() {
			case "esc":
				m.help = false
			case "down":
				m.helpOffset++
			case "up":
				m.helpOffset = max(0, m.helpOffset-1)
			case "pgdown":
				m.helpOffset += max(1, m.height-9)
			case "pgup":
				m.helpOffset = max(0, m.helpOffset-max(1, m.height-9))
			}
			m.helpOffset = min(m.helpOffset, max(0, len(m.helpRows(paletteFor(m.theme)))-max(1, m.height-7)))
			return m, nil
		}
		if len(m.notes) > 0 && m.mode != 1 {
			if cmd, handled := m.selectionKeys(v); handled {
				return m, cmd
			}
		}
		if m.complete != nil {
			if cmd, handled := m.updateCompletionKeys(v); handled {
				return m, cmd
			}
		}
		switch {
		case key.Matches(v, keys.picker):
			return m, m.openPicker()
		case key.Matches(v, keys.undo) && len(m.trashed) > 0:
			if m.flush() != nil {
				return m, nil
			}
			id := m.trashed[len(m.trashed)-1]
			n, err := m.store.restore(id)
			if err != nil && n.ID == "" {
				m.status = err.Error()
				return m, nil
			}
			m.trashed = m.trashed[:len(m.trashed)-1]
			m.notes = append(m.notes, n)
			sortNotes(m.notes)
			m.selectID(id)
			m.loadNote()
			m.reindex()
			m.status = "Restored from trash"
			if err != nil {
				m.status += "; directory sync failed: " + err.Error()
			}
			return m, tea.Batch(textarea.Blink, m.requestRender())
		case key.Matches(v, keys.new):
			folder := ""
			if len(m.notes) > 0 {
				folder = folderOf(m.notes[m.index].ID)
			}
			if folder != "" {
				folder += "/"
			}
			return m, m.openPrompt(promptNew, folder)
		case key.Matches(v, keys.rename):
			if len(m.notes) == 0 {
				return m, nil
			}
			n := m.notes[m.index]
			name := n.ID
			if legacyID.MatchString(n.ID) {
				name = safeName(title(m.editor.Value()))
			}
			return m, m.openPrompt(promptRename, name)
		case key.Matches(v, keys.follow):
			return m, m.followLink()
		case key.Matches(v, keys.back):
			m.back()
			return m, m.requestRender()
		case key.Matches(v, keys.backlinks):
			return m, m.openBacklinks()
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
			return m, m.openThemePicker()
		}
	}
	if m.picker != nil {
		return m, m.updatePicker(msg)
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
	m.followCursor()
	if _, ok := msg.(tea.KeyMsg); ok {
		m.updateCompletion()
	}
	if before != m.editor.Value() {
		return m, tea.Batch(cmd, m.edited())
	}
	if m.editor.LineCount() >= maxLines {
		m.status = "Note reached the 10,000-line limit; extra lines were not added"
	}
	return m, cmd
}

// edited marks the editor changed and schedules the debounced save and preview.
func (m *model) edited() tea.Cmd {
	m.dirty = true
	m.quitArmed = false
	m.status = "Unsaved…"
	if m.editor.LineCount() >= maxLines {
		m.status = "Note reached the 10,000-line limit; extra lines were not added"
	}
	m.revision++
	rev := m.revision
	save := tea.Tick(400*time.Millisecond, func(time.Time) tea.Msg { return saveMsg(rev) })
	if !m.previewVisible() {
		return save
	}
	return tea.Batch(save, tea.Tick(renderDelay, func(time.Time) tea.Msg { return renderTickMsg(rev) }))
}
func (m *model) View() string {
	p := paletteFor(m.theme)
	if m.width < 32 || m.height < 10 {
		return paintBlock("Resize to at least 32×10.\nCtrl+S save · Ctrl+Q quit", max(1, m.width), max(1, m.height), p.text, p.surface)
	}
	var body string
	switch {
	case m.themePicker != nil:
		body = m.themePickerView(p)
	case m.confirm:
		body = pill("TRASH", p.onPill, p.warn) + " " + ink(p.danger).Bold(true).Render("Move this note to trash?") +
			"\n\n" + pill("y", p.onPill, p.danger) + ink(p.muted).Render(" confirm   ") + pill("n / Esc", p.onPill, p.good) + ink(p.muted).Render(" cancel")
	case m.picker != nil:
		body = m.picker.View()
	case m.prompt != nil:
		body = m.promptView(p)
	case m.help:
		body = m.helpView(p)
	case len(m.notes) == 0:
		body = gradient("A quiet place for your next thought.", true, p.accent, p.pink, p.cyan) +
			"\n\n" + pill("Ctrl+N", p.onPill, p.accent) + ink(p.muted).Render(" creates a note. Folder/Name puts it in a folder.")
	case m.mode == 1:
		body = m.preview.View()
	case m.split():
		body = lipgloss.JoinHorizontal(lipgloss.Top, colorMarkdown(m.editor.View(), p), divider(p, m.editor.Height()), m.preview.View())
	default:
		body = colorMarkdown(m.editor.View(), p)
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
	m.editor.SelectionStyle = base.Background(lipgloss.Color(p.line)).Underline(true)
	m.editor.Cursor.Style = ink(p.accent)
	m.editor.Cursor.TextStyle = base
}

// Split preview tracks the logical cursor; full preview keeps manual scrolling.
func (m *model) followCursor() {
	if !m.split() {
		return
	}
	ratio := float64(m.editor.Line()) / float64(max(1, m.editor.LineCount()-1))
	m.preview.SetYOffset(int(ratio * float64(max(0, m.preview.TotalLineCount()-m.preview.Height))))
}
