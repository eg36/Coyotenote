package main

import (
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
