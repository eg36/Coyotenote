package editor

import (
	"github.com/charmbracelet/x/ansi"
	"github.com/rivo/uniseg"
	"strings"
	"testing"
)

func TestWrapPreservesSourceAndWholeGraphemes(t *testing.T) {
	for _, text := range []string{"abcd👩‍💻界e\u0301 longword", " a  b ", "👩‍💻👩‍💻👩‍💻", "e\u0301e\u0301e\u0301"} {
		for _, width := range []int{2, 3, 5, 10} {
			var joined strings.Builder
			for _, row := range wrap([]rune(text), width) {
				joined.WriteString(string(row))
				if uniseg.StringWidth(string(row)) > width {
					t.Fatalf("%q width%d: %q", text, width, string(row))
				}
				if strings.HasPrefix(string(row), "\u200d") || strings.HasPrefix(string(row), "\u0301") {
					t.Fatal("grapheme split", string(row))
				}
			}
			if joined.String() != text+" " {
				t.Fatalf("source lost: %q", joined.String())
			}
		}
	}
}
func TestVerticalMovementTraversesShortWrappedRows(t *testing.T) {
	m := New()
	m.Prompt = ""
	m.ShowLineNumbers = false
	m.SetWidth(5)
	m.SetHeight(2)
	m.SetValue("abcd👩‍💻x\nsecond\nlast")
	m.SetOffset(0)
	m.CursorDown()
	if m.CursorOffset() != 4 {
		t.Fatal("didn't land at next complete grapheme", m.CursorOffset())
	}
	m.CursorDown()
	if m.Line() != 1 {
		t.Fatal("didn't reach next logical line", m.Line())
	}
	m.CursorUp()
	if m.CursorOffset() != 4 {
		t.Fatal("didn't return to wrapped row", m.CursorOffset())
	}
	m.SetOffset(len([]rune(m.Value())))
	view := ansi.Strip(m.View())
	if !strings.Contains(view, "last") {
		t.Fatal("cursor not scrolled into view", view)
	}
}

func TestVerticalMovementMakesProgressAtWrapBoundary(t *testing.T) {
	m := New()
	m.Prompt = ""
	m.ShowLineNumbers = false
	m.SetWidth(5)
	m.SetValue("abcdefghijk\nlonger final line")
	m.SetOffset(len([]rune(m.Value())))
	previous := m.CursorOffset()
	for i := 0; i < 20; i++ {
		m.CursorUp()
		now := m.CursorOffset()
		if m.Line() == 0 {
			return
		}
		if now >= previous {
			t.Fatalf("up did not move: %d -> %d", previous, now)
		}
		previous = now
	}
	t.Fatal("never reached first line")
}

func TestTabsStayInSourceAndFillTheirCells(t *testing.T) {
	m := New()
	m.Prompt = ""
	m.ShowLineNumbers = false
	m.SetWidth(12)
	m.SetHeight(4)
	m.SetValue("\tx\tyz\n\t\t\tend")
	if m.Value() != "\tx\tyz\n\t\t\tend" {
		t.Fatalf("tabs changed: %q", m.Value())
	}
	m.SetOffset(1)
	for i, row := range strings.Split(ansi.Strip(m.View()), "\n") {
		if strings.Contains(row, "\t") || ansi.StringWidth(row) != 12 {
			t.Fatalf("row %d drawn as %q", i, row)
		}
	}
	if !strings.HasPrefix(ansi.Strip(m.View()), "    x    yz") {
		t.Fatal("tabs not drawn four cells wide", ansi.Strip(m.View()))
	}
	for _, row := range wrap([]rune("\t\t\tend"), 12) {
		if cellWidth(string(row)) > 12 {
			t.Fatalf("wrapped row too wide: %q", string(row))
		}
	}
	// "x" sits at cell 4 on the first line; moving down lands after the first tab.
	m.CursorDown()
	if m.Line() != 1 || m.CursorOffset() != len("\tx\tyz\n\t") {
		t.Fatal("vertical movement ignored tab width", m.Line(), m.CursorOffset())
	}
}

func TestSetValueKeepsNoteTextAndDropsControls(t *testing.T) {
	m := New()
	m.SetValue("a\tb\uFFFD\r\nc\rd\x1b[31me")
	if got := m.Value(); got != "a\tb\uFFFD\nc\nd[31me" {
		t.Fatalf("got %q", got)
	}
}
