package main

import (
	"html"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/eg36/labradorite/internal/vault"
)

func (a *webApp) webEmbedsEnabled() bool {
	b, err := os.ReadFile(filepath.Join(a.store.Config, "web-embeds"))
	return err == nil && string(b) == "true"
}

var youtubeID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
var youtubeStart = regexp.MustCompile(`^\d{1,7}$`)

// webEmbedURL only accepts web destinations. It never fetches a URL: the
// browser contacts it only after the user sees the destination and clicks Load.
func webEmbedURL(raw string) (source, referrer string, ok bool) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 4096 || strings.ContainsAny(raw, "\\\r\n\t") || u.User != nil || u.Opaque != "" || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return "", "", false
	}
	host := strings.ToLower(u.Hostname())
	id := ""
	switch host {
	case "youtu.be", "www.youtu.be":
		id = strings.TrimPrefix(u.Path, "/")
	case "youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com":
		if u.Path == "/watch" {
			id = u.Query().Get("v")
		} else {
			parts := strings.Split(strings.Trim(u.Path, "/"), "/")
			if len(parts) == 2 && (parts[0] == "embed" || parts[0] == "shorts" || parts[0] == "live") {
				id = parts[1]
			}
		}
	default:
		return u.String(), "no-referrer", true
	}
	if !youtubeID.MatchString(id) {
		return "", "", false
	}
	// YouTube requires a Referer identity. Send only the local app's origin,
	// never a note path, title, query or fragment. No player API or thumbnail
	// is loaded before consent. Strip tracking and autoplay parameters.
	player := &url.URL{Scheme: "https", Host: "www.youtube-nocookie.com", Path: "/embed/" + id}
	start := u.Query().Get("start")
	if start == "" {
		start = u.Query().Get("t")
	}
	if youtubeStart.MatchString(start) {
		player.RawQuery = "start=" + start
	}
	return player.String(), "origin", true
}

func (a *webApp) embedWeb(l vault.Link) string {
	raw := l.Target
	if l.Heading != "" {
		raw += "#" + l.Heading
	}
	if !strings.Contains(raw, ":") && !strings.HasPrefix(raw, "//") {
		return ""
	}
	source, referrer, ok := webEmbedURL(raw)
	if !ok {
		return `<span class="web-embed-invalid">Web embed unavailable: use an HTTP or HTTPS URL without credentials.</span>`
	}
	label := l.Alias
	if label == "" {
		label = "Web embed"
	}
	hint := "Web embeds are off. Enable them in Settings → Web embeds."
	disabled := " disabled"
	if a.webEmbedsEnabled() {
		hint = "Loads external content only when you choose Load. Some sites block embedding."
		disabled = ""
	}
	if referrer == "origin" {
		hint += " YouTube receives the app’s origin when loaded."
	}
	return `<span class="web-embed" data-web-embed="` + html.EscapeString(raw) + `"><strong>` + html.EscapeString(label) + `</strong><span class="web-embed-source">Loads from <a href="` + html.EscapeString(source) + `" target="_blank" rel="noopener noreferrer">` + html.EscapeString(source) + `</a></span><span class="web-embed-hint">` + hint + `</span><button type="button" class="web-embed-load"` + disabled + `>Load embed</button></span>`
}
