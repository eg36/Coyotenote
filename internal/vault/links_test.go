package vault

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseLinks(t *testing.T) {
	body := "a [[One]] b [[Two#Head|alias]] [[ Zażółć ]]\n`[[code]]` ``[[x]]``\n```\n[[fenced]]\n```\n[[#self]] [[]] [[bro[ken]] [[Three|x]]"
	var got []string
	for _, l := range ParseLinks(body) {
		got = append(got, l.Target+"#"+l.Heading+"|"+l.Alias)
		if !strings.HasPrefix(body[l.Start:], "[[") || !strings.HasSuffix(body[:l.End], "]]") {
			t.Fatalf("bad offsets for %+v", l)
		}
	}
	want := []string{"One#|", "Two#Head|alias", "Zażółć#|", "Three#|x"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
}

func TestResolver(t *testing.T) {
	r := NewResolver([]Note{{ID: "Plan"}, {ID: "Work/Plan"}, {ID: "Work/Deep/Note"}, {ID: "Home/Deep/Note"}, {ID: "Other/Note"}})
	for _, tc := range []struct{ target, from, want string }{
		{"plan", "x", "Plan"},
		{"Work/Plan", "x", "Work/Plan"},
		{"work/plan.md", "x", "Work/Plan"},
		{"Note", "Home/Deep/a", "Home/Deep/Note"},
		{"Note", "x", "Other/Note"},
		{"Deep/Note", "x", "Home/Deep/Note"},
	} {
		if got, ok := r.Resolve(tc.target, tc.from); !ok || got != tc.want {
			t.Errorf("%s from %s: got %q", tc.target, tc.from, got)
		}
	}
	if _, ok := r.Resolve("Missing", "x"); ok {
		t.Fatal("resolved missing")
	}
	if r.ShortTarget("Work/Plan", "x") != "Work/Plan" || r.ShortTarget("Other/Note", "x") != "Note" {
		t.Fatal("short target")
	}
}

func TestRenameLinks(t *testing.T) {
	before := []Note{
		{ID: "Work/Plan", Body: "See [[Plan]] and [[Plan#Goals|goals]]."},
		{ID: "Home", Body: "[[Work/Plan]], [[Other]] and `[[Plan]]`."},
		{ID: "Other", Body: "Nothing to change."},
		{ID: "Archive/Plan", Body: "[[Archive/Plan]] stays."},
	}
	got := map[string]LinkUpdate{}
	for _, u := range RenameLinks(before, "Work/Plan", "Done/Plan") {
		got[u.Note.ID] = u
	}
	want := map[string]string{
		"Done/Plan": "See [[Plan]] and [[Plan#Goals|goals]].",
		"Home":      "[[Done/Plan]], [[Other]] and `[[Plan]]`.",
	}
	if len(got) != 1 || got["Home"].Body != want["Home"] || got["Home"].Note.Body != before[1].Body {
		t.Fatalf("got %+v", got)
	}
	// Links that would no longer resolve take the shortest name that does.
	got = map[string]LinkUpdate{}
	for _, u := range RenameLinks(before, "Work/Plan", "Done/Project") {
		got[u.Note.ID] = u
	}
	if got["Done/Project"].Body != "See [[Project]] and [[Project#Goals|goals]]." ||
		got["Done/Project"].Note.Body != before[0].Body || got["Home"].Body != "[[Done/Project]], [[Other]] and `[[Plan]]`." {
		t.Fatalf("got %+v", got)
	}
}

func TestParseLinksSkipsCodeAsCommonMarkReadsIt(t *testing.T) {
	body := strings.Join([]string{
		"[[Real]] and \\[[Escaped]] and \\\\[[AfterBackslash]]",
		"",
		"    [[IndentedCode]]",
		"",
		"> ```",
		"> [[QuotedFence]]",
		"> ```",
		"",
		"- item",
		"",
		"  ```",
		"  [[ListFence]]",
		"  ```",
		"",
		"- item",
		"",
		"    continued [[ListParagraph]]",
		"",
		"Text with `[[Span]]` and ``a `[[Double]]` b`` then [[Last|alias]]",
	}, "\n")
	var got []string
	for _, l := range ParseLinks(body) {
		got = append(got, l.Target)
		if body[l.Start:l.Start+2] != "[[" || body[l.End-2:l.End] != "]]" {
			t.Fatalf("bad offsets for %+v", l)
		}
	}
	want := []string{"Real", "AfterBackslash", "ListParagraph", "Last"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestEscapedAliasPipeInTables(t *testing.T) {
	body := "| Where | Link |\n| --- | --- |\n| Here | [[Travel/Lost Coast\\|the coast]] |\n| Heading | [[Plan#Goals\\|goals]] |"
	links := ParseLinks(body)
	if len(links) != 2 {
		t.Fatalf("links = %+v", links)
	}
	if l := links[0]; l.Target != "Travel/Lost Coast" || l.Alias != "the coast" || body[l.TargetStart:l.TargetEnd] != "Travel/Lost Coast" {
		t.Errorf("first link = %+v", l)
	}
	if l := links[1]; l.Target != "Plan" || l.Heading != "Goals" || l.Alias != "goals" {
		t.Errorf("second link = %+v", l)
	}
}
