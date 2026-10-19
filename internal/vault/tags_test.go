package vault

import (
	"reflect"
	"testing"
)

func TestTagsFromFrontMatterAndText(t *testing.T) {
	for _, tc := range []struct {
		body string
		want []string
	}{
		{"---\ntags: [Travel, plans]\n---\nText #travel and #Ideas/2026.", []string{"Ideas/2026", "plans", "Travel"}},
		{"---\ntitle: x\ntags:\n  - one\n  - \"two\"\n---\n", []string{"one", "two"}},
		{"\uFEFF---\r\ntag: solo\r\n---\r\n", []string{"solo"}},
		{"+++\ntags = [\"toml\", \"more\"]\n+++\n", []string{"more", "toml"}},
		{"# Heading\n## Another\n#2026 is a number, #year2026 is a tag", []string{"year2026"}},
		{"`#code` and\n```\n#fenced\n```\n    #indented\nhttp://x.com/#anchor [[Note#Heading]] (#paren)", []string{"paren"}},
		{"No tags here.", nil},
	} {
		if got := Tags(tc.body); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%q: got %q, want %q", tc.body, got, tc.want)
		}
	}
}
