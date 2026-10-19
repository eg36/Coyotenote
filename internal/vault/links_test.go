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
