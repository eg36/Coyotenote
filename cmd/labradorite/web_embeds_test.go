package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWebEmbedConsentAndPersistence(t *testing.T) {
	a := testApp(t)
	body := "![[https://example.com/page#part|A page]]\n\n![[https://youtu.be/dQw4w9WgXcQ?t=12]]"
	render := func() string {
		return request(t, a, "POST", "/api/render", mutation{ID: "Host", Body: body}, 200)["html"].(string)
	}
	if request(t, a, "GET", "/api/state", nil, 200)["webEmbeds"] != false {
		t.Fatal("web embeds must default off")
	}
	out := render()
	for _, want := range []string{"Web embeds are off", "https://example.com/page#part", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=12", "Load embed", " disabled"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q: %s", want, out)
		}
	}
	if strings.Contains(out, "<iframe") || strings.Contains(out, "<img") {
		t.Fatal("rendering must never load remote content")
	}
	request(t, a, "POST", "/api/web-embed", mutation{Body: "https://example.com/page"}, 403)
	on := true
	request(t, a, "POST", "/api/settings", mutation{WebEmbeds: &on}, 200)
	if out = render(); strings.Contains(out, " disabled") || strings.Contains(out, "<iframe") {
		t.Fatalf("enabled embeds still wait for Load: %s", out)
	}
	b, err := newWebApp(a.store)
	if err != nil {
		t.Fatal(err)
	}
	b.port = a.port
	if !b.webEmbedsEnabled() {
		t.Fatal("setting did not survive a new app instance")
	}
	got := request(t, b, "POST", "/api/web-embed", mutation{Body: "https://youtu.be/dQw4w9WgXcQ?autoplay=1&t=12"}, 200)
	if got["source"] != "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=12" || got["referrer"] != "origin" {
		t.Fatalf("player: %v", got)
	}
	got = request(t, b, "POST", "/api/web-embed", mutation{Body: "https://example.com/page#part"}, 200)
	if got["referrer"] != "no-referrer" {
		t.Fatal(got)
	}
	on = false
	request(t, b, "POST", "/api/settings", mutation{WebEmbeds: &on}, 200)
	request(t, a, "POST", "/api/web-embed", mutation{Body: "https://example.com/page"}, 403)
	if a.webEmbedsEnabled() {
		t.Fatal("disabled setting was not persisted")
	}
}

func TestWebEmbedURLsAndMarkdownSafety(t *testing.T) {
	for _, raw := range []string{"javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "//example.com", "https://user:pass@example.com/", "https:///missing", "https://example.com\\@evil.test", "https://example.com/\nfoo", "https://youtu.be/invalid", "https://youtube.com/watch?v=bad"} {
		if _, _, ok := webEmbedURL(raw); ok {
			t.Errorf("accepted unsafe or invalid URL %q", raw)
		}
	}
	for _, raw := range []string{"https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"} {
		if src, ref, ok := webEmbedURL(raw); !ok || src != "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" || ref != "origin" {
			t.Errorf("YouTube: %s %s %s %v", raw, src, ref, ok)
		}
	}
	a := testApp(t)
	for _, body := range []string{"`![[https://example.com]]`", "```\n![[https://example.com]]\n```", `\![[https://example.com]]`} {
		out := request(t, a, "POST", "/api/render", mutation{Body: body}, 200)["html"].(string)
		if strings.Contains(out, `class="web-embed"`) {
			t.Errorf("embedded code or escaped source: %s", out)
		}
	}
	body := `![[https://example.com/x.png?q=%22%3E#anchor|<img src=x onerror=alert(1)>]]`
	out := request(t, a, "POST", "/api/render", mutation{Body: body}, 200)["html"].(string)
	if strings.Contains(out, "<img") || strings.Contains(out, "<iframe") || !strings.Contains(out, "&lt;img") {
		t.Fatalf("unescaped label or remote image: %s", out)
	}
}

func TestEmbedTargetValidationNeverNeedsNetworkConsent(t *testing.T) {
	a := testApp(t)
	for _, target := range []string{"Recipe", "Recipe#Steps", "Recipe#^key", "attachments/photo.png", "recording.mp3", "https://example.com/article#part", "https://youtu.be/M7lc1UVf-VE"} {
		got := request(t, a, "POST", "/api/embed-target", mutation{Body: target}, 200)
		if got["valid"] != true {
			t.Fatal(got)
		}
	}
	for _, target := range []string{"", "  ", "Note|alias", "Note]]after", "Note\nOther", "javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com/", "//example.com", "https://youtu.be/bad", strings.Repeat("a", 4097)} {
		request(t, a, "POST", "/api/embed-target", mutation{Body: target}, 422)
	}
	if a.webEmbedsEnabled() {
		t.Fatal("validation changed remote loading consent")
	}
	request(t, a, "POST", "/api/web-embed", mutation{Body: "https://example.com/"}, 403)
}

func TestWebEmbedConsentIsIndependentAcrossVaultsWithSharedSettings(t *testing.T) {
	a, b := testApp(t), testApp(t)
	shared := t.TempDir()
	a.store.Config, b.store.Config = shared, shared
	// A previous opt-in in shared settings is not permission for either vault.
	if err := os.WriteFile(filepath.Join(shared, "web-embeds"), []byte("true"), 0600); err != nil {
		t.Fatal(err)
	}
	if a.webEmbedsEnabled() || b.webEmbedsEnabled() {
		t.Fatal("new vault inherited consent from shared settings")
	}
	enabled := true
	request(t, a, "POST", "/api/settings", mutation{WebEmbeds: &enabled}, 200)
	if !a.webEmbedsEnabled() || b.webEmbedsEnabled() {
		t.Fatal("enabling one vault changed another vault")
	}
	restarted, err := newWebApp(a.store)
	if err != nil {
		t.Fatal(err)
	}
	restarted.port = a.port
	if !restarted.webEmbedsEnabled() {
		t.Fatal("vault consent did not survive restart")
	}
	request(t, b, "POST", "/api/web-embed", mutation{Body: "https://example.com/"}, 403)
	request(t, b, "POST", "/api/settings", mutation{WebEmbeds: &enabled}, 200)
	enabled = false
	request(t, a, "POST", "/api/settings", mutation{WebEmbeds: &enabled}, 200)
	if a.webEmbedsEnabled() || !b.webEmbedsEnabled() {
		t.Fatal("disabling one vault changed another vault")
	}
	for _, app := range []*webApp{a, b} {
		files := request(t, app, "GET", "/api/library", nil, 200)["files"].([]any)
		for _, file := range files {
			if file.(map[string]any)["path"] == "web-embeds" {
				t.Fatal("Library lists vault permission file")
			}
		}
	}
	// When default settings and vault coincide, the earlier file still works.
	b.store.Config = b.store.Dir
	if !b.webEmbedsEnabled() {
		t.Fatal("default-vault permission lost compatibility")
	}
}
