package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
)

//go:embed web/index.html web/assets/* logo.png
var assets embed.FS

const maxBodyBytes = 4 << 20

type webApp struct {
	store    *store
	mu       sync.Mutex
	token    string
	port     int
	renderer goldmark.Markdown
}

type noteView struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Body      string   `json:"body,omitempty"`
	Excerpt   string   `json:"excerpt"`
	Revision  string   `json:"revision"`
	Modified  string   `json:"modified"`
	Words     int      `json:"words"`
	Backlinks []string `json:"backlinks"`
}

type mutation struct {
	ID       string `json:"id"`
	Body     string `json:"body"`
	Revision string `json:"revision"`
	Name     string `json:"name"`
	Theme    string `json:"theme"`
}

type apiError struct {
	status  int
	message string
	current *noteView
}

func (e *apiError) Error() string { return e.message }

func newWebApp(s *store) (*webApp, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, err
	}
	return &webApp{store: s, token: hex.EncodeToString(token[:]), renderer: goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithParserOptions(parser.WithAutoHeadingID()))}, nil
}

func revision(body string) string {
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:])
}

func (a *webApp) trustedHost(host string) bool {
	name, port, err := net.SplitHostPort(host)
	if err != nil || port != strconv.Itoa(a.port) {
		return false
	}
	ip := net.ParseIP(name)
	return name == "localhost" || ip != nil && ip.IsLoopback()
}

func (a *webApp) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	w.Header().Set("Cache-Control", "no-store")
	if !a.trustedHost(r.Host) {
		http.Error(w, "This local app only accepts loopback hosts.", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/healthz" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": versionString()})
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			writeError(w, &apiError{status: 403, message: "cross-origin requests are not allowed"})
			return
		}
		if r.Method != "GET" && r.Header.Get("X-Coyote-Token") != a.token {
			writeError(w, &apiError{status: 403, message: "missing local session token; reload the page"})
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if err := a.api(w, r); err != nil {
			writeError(w, err)
		}
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == "/" {
		data, _ := assets.ReadFile("web/index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
		return
	}
	if r.URL.Path == "/assets/logo.png" {
		data, _ := assets.ReadFile("logo.png")
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		sub, _ := fs.Sub(assets, "web")
		http.FileServer(http.FS(sub)).ServeHTTP(w, r)
		return
	}
	http.NotFound(w, r)
}

func decode(w http.ResponseWriter, r *http.Request) (mutation, error) {
	var in mutation
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes*6+65536)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return in, &apiError{status: 400, message: "invalid or oversized JSON request"}
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return in, &apiError{status: 400, message: "expected one JSON object"}
	}
	return in, nil
}

func validateBody(body string) error {
	switch {
	case len(body) > maxBodyBytes:
		return &apiError{status: 422, message: "A note can contain up to 4 MiB in this web alpha."}
	case !utf8.ValidString(body) || hasControl(body):
		return &apiError{status: 422, message: "Notes must be UTF-8 text without control characters."}
	case lineCount(body) > maxLines:
		return &apiError{status: 422, message: "A note can contain up to 10,000 lines."}
	}
	return nil
}

func (a *webApp) load() ([]note, loadReport, error) {
	notes, report, err := a.store.load()
	if err != nil {
		return nil, report, err
	}
	allowed := notes[:0]
	for _, n := range notes {
		if len(n.Body) > maxBodyBytes {
			report.skipped = append(report.skipped, n.ID+" (over the web alpha 4 MiB limit)")
		} else {
			allowed = append(allowed, n)
		}
	}
	return allowed, report, nil
}

func views(s *store, notes []note, includeBody bool) []noteView {
	result := make([]noteView, 0, len(notes))
	byID := make(map[string]int)
	for _, n := range notes {
		text, _ := editorText(n.Body)
		excerpt := strings.Join(strings.Fields(text), " ")
		runes := []rune(excerpt)
		if len(runes) > 140 {
			excerpt = string(runes[:140]) + "…"
		}
		modified := ""
		if info, err := os.Stat(s.path(n.ID)); err == nil {
			modified = info.ModTime().UTC().Format(time.RFC3339Nano)
		}
		v := noteView{ID: n.ID, Title: displayName(n.ID, n.Body), Excerpt: excerpt, Revision: revision(n.Body), Modified: modified, Words: len(strings.Fields(text)), Backlinks: []string{}}
		if includeBody {
			v.Body = text
		}
		byID[n.ID] = len(result)
		result = append(result, v)
	}
	resolver := newResolver(notes)
	for _, n := range notes {
		seen := map[string]bool{}
		for _, l := range parseLinks(n.Body) {
			if id, ok := resolver.resolve(l.target, n.ID); ok && id != n.ID && !seen[id] {
				idx := byID[id]
				result[idx].Backlinks = append(result[idx].Backlinks, n.ID)
				seen[id] = true
			}
		}
	}
	return result
}

func (a *webApp) current(id string, notes []note, expected string) (note, *noteView, error) {
	if !validID(id) {
		return note{}, nil, &apiError{status: 400, message: "invalid note path"}
	}
	for _, n := range notes {
		if n.ID == id {
			var view noteView
			for _, v := range views(a.store, notes, true) {
				if v.ID == id {
					view = v
					break
				}
			}
			if expected != "" && expected != view.Revision {
				return n, &view, &apiError{status: 409, message: "This note changed in another tab or program. Your edits are kept locally.", current: &view}
			}
			return n, &view, nil
		}
	}
	return note{}, nil, &apiError{status: 404, message: "Note not found. It may have been moved or deleted."}
}

func (a *webApp) api(w http.ResponseWriter, r *http.Request) error {
	if r.Method+" "+r.URL.Path == "GET /api/session" {
		// A cheap way for an open tab to renew its token after a restart.
		absolute, _ := filepath.Abs(a.store.dir)
		writeJSON(w, 200, map[string]string{"token": a.token, "vaultId": revision(absolute)[:16]})
		return nil
	}
	notes, report, err := a.load()
	if err != nil {
		return err
	}
	route := r.Method + " " + r.URL.Path
	if route == "GET /api/state" {
		theme := "dark"
		if b, e := os.ReadFile(filepath.Join(a.store.config, "theme")); e == nil && validTheme(strings.TrimSpace(string(b))) {
			theme = strings.TrimSpace(string(b))
		}
		list := views(a.store, notes, false)
		// Notes always lists the whole vault; matches names the search hits,
		// so a filtered sidebar never leaves stale notes behind.
		var matches []string
		if q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))); q != "" {
			matches = []string{}
			for _, n := range notes {
				if strings.Contains(strings.ToLower(n.ID+"\n"+n.Body), q) {
					matches = append(matches, n.ID)
				}
			}
		}
		themeList := []map[string]any{}
		for _, t := range themes {
			p := t.colors
			themeList = append(themeList, map[string]any{"id": t.id, "name": t.name, "light": t.light, "colors": map[string]string{"surface": p.surface, "chrome": p.chrome, "text": p.text, "muted": p.muted, "accent": p.accent, "cyan": p.cyan, "good": p.good, "warn": p.warn, "danger": p.danger, "line": p.line, "pink": p.pink, "blue": p.blue, "onPill": p.onPill}})
		}
		absolute, _ := filepath.Abs(a.store.dir)
		warnings := append([]string{}, report.skipped...)
		if report.orphans > 0 {
			warnings = append(warnings, fmt.Sprintf("%d interrupted-write files retained in the vault", report.orphans))
		}
		if report.recoveries > 0 {
			warnings = append(warnings, fmt.Sprintf("%d recovery copies retained in the vault", report.recoveries))
		}
		writeJSON(w, 200, map[string]any{"notes": list, "matches": matches, "themes": themeList, "theme": theme, "vault": filepath.Base(absolute), "vaultId": revision(absolute)[:16], "token": a.token, "version": versionString(), "warnings": warnings, "limits": map[string]int{"lines": maxLines, "bytes": maxBodyBytes}})
		return nil
	}
	if route == "GET /api/note" || route == "GET /api/export" {
		n, v, err := a.current(r.URL.Query().Get("id"), notes, "")
		if err != nil {
			return err
		}
		if route == "GET /api/export" {
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename*=UTF-8''`+url.PathEscape(path.Base(n.ID)+".md"))
			_, _ = io.WriteString(w, n.Body)
		} else {
			writeJSON(w, 200, v)
		}
		return nil
	}
	in, err := decode(w, r)
	if err != nil {
		return err
	}
	switch route {
	case "POST /api/note":
		if in.ID == "" {
			in.ID = freeName(notes, "", "Untitled")
		}
		if err = checkName(in.ID); err != nil {
			return &apiError{status: 422, message: err.Error()}
		}
		for _, n := range notes {
			if strings.EqualFold(n.ID, in.ID) {
				return &apiError{status: 409, message: "A note with that name already exists."}
			}
		}
		if err = validateBody(in.Body); err != nil {
			return err
		}
		n, err := a.store.create(in.ID)
		if err != nil {
			return err
		}
		if in.Body != "" {
			if err = a.store.save(n, in.Body); err != nil {
				return err
			}
			n.Body = in.Body
		}
		writeJSON(w, 201, views(a.store, []note{n}, true)[0])
		return nil
	case "PUT /api/note", "DELETE /api/note", "POST /api/rename":
		if in.Revision == "" {
			return &apiError{status: 428, message: "A revision is required to protect existing edits."}
		}
		n, _, err := a.current(in.ID, notes, in.Revision)
		if err != nil {
			return err
		}
		switch route {
		case "PUT /api/note":
			if err = validateBody(in.Body); err != nil {
				return err
			}
			_, crlf := editorText(n.Body)
			body := diskText(in.Body, crlf)
			if err = a.store.save(n, body); err != nil {
				return &apiError{status: 409, message: err.Error()}
			}
			n.Body = body
			for i := range notes {
				if notes[i].ID == n.ID {
					notes[i] = n
				}
			}
			_, view, err := a.current(n.ID, notes, "")
			if err != nil {
				return err
			}
			writeJSON(w, 200, view)
		case "DELETE /api/note":
			trashID, err := a.store.trash(n)
			if err != nil {
				return err
			}
			writeJSON(w, 200, map[string]string{"trashed": n.ID, "trashId": trashID})
		case "POST /api/rename":
			if in.Name == n.ID {
				writeJSON(w, 200, map[string]any{"note": views(a.store, []note{n}, true)[0], "warnings": []string{}})
				return nil
			}
			if err = checkName(in.Name); err != nil {
				return &apiError{status: 422, message: err.Error()}
			}
			for _, other := range notes {
				if other.ID != n.ID && strings.EqualFold(other.ID, in.Name) {
					return &apiError{status: 409, message: "A note with that name already exists."}
				}
			}
			if err = a.store.rename(n, in.Name); err != nil {
				return err
			}
			warnings := a.rewriteLinks(notes, n.ID, in.Name)
			refreshed, _, err := a.load()
			if err != nil {
				return err
			}
			_, view, err := a.current(in.Name, refreshed, "")
			if err != nil {
				return err
			}
			writeJSON(w, 200, map[string]any{"note": view, "warnings": warnings})
		}
		return nil
	case "POST /api/restore":
		// Name is the note's original path when its trash name has a suffix.
		to := in.Name
		if to == "" {
			to = in.ID
		}
		n, err := a.store.restore(in.ID, to)
		if err != nil {
			return &apiError{status: 409, message: err.Error()}
		}
		writeJSON(w, 200, views(a.store, []note{n}, true)[0])
		return nil
	case "POST /api/settings":
		if !validTheme(in.Theme) {
			return &apiError{status: 422, message: "unknown theme"}
		}
		if err = atomicWrite(a.store.config, "theme", []byte(in.Theme)); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]string{"theme": in.Theme})
		return nil
	case "POST /api/resolve":
		if len(in.Body) > 4096 {
			return &apiError{status: 422, message: "link target is too long"}
		}
		links := parseLinks("[[" + in.Body + "]]")
		if len(links) != 1 {
			return &apiError{status: 422, message: "invalid wiki link"}
		}
		l := links[0]
		id, found := newResolver(notes).resolve(l.target, in.ID)
		writeJSON(w, 200, map[string]any{"id": id, "found": found, "target": l.target, "heading": l.heading})
		return nil
	case "POST /api/render":
		if err = validateBody(in.Body); err != nil {
			return err
		}
		out, err := a.render(in.Body, in.ID, notes)
		if err != nil {
			return err
		}
		writeJSON(w, 200, map[string]string{"html": out})
		return nil
	case "POST /api/recovery":
		if !validID(in.ID) {
			return &apiError{status: 422, message: "invalid note path"}
		}
		if err = validateBody(in.Body); err != nil {
			return err
		}
		file, err := a.store.writeRecovery(note{ID: in.ID}, in.Body)
		if err != nil {
			return err
		}
		writeJSON(w, 201, map[string]string{"path": file})
		return nil
	}
	return &apiError{status: 404, message: "API route not found"}
}

func (a *webApp) rewriteLinks(before []note, oldID, newID string) []string {
	after := append([]note{}, before...)
	for i := range after {
		if after[i].ID == oldID {
			after[i].ID = newID
		}
	}
	oldR, newR := newResolver(before), newResolver(after)
	warnings := []string{}
	for i, n := range after {
		body := n.Body
		links := parseLinks(body)
		for j := len(links) - 1; j >= 0; j-- {
			l := links[j]
			destination, ok := oldR.resolve(l.target, before[i].ID)
			if !ok {
				continue
			}
			if destination == oldID {
				destination = newID
			}
			if got, ok := newR.resolve(l.target, n.ID); ok && got == destination {
				continue
			}
			target := destination
			if !strings.Contains(l.target, "/") {
				target = newR.shortTarget(destination, n.ID)
			}
			body = body[:l.targetStart] + target + body[l.targetEnd:]
		}
		if body != n.Body {
			if err := a.store.save(n, body); err != nil {
				warnings = append(warnings, "Could not update links in "+n.ID+": "+err.Error())
			}
		}
	}
	return warnings
}

func (a *webApp) render(body, from string, notes []note) (string, error) {
	resolver := newResolver(notes)
	links := parseLinks(body)
	for i := len(links) - 1; i >= 0; i-- {
		l := links[i]
		label := l.alias
		if label == "" {
			label = l.target
			if l.heading != "" {
				label += " › " + l.heading
			}
		}
		target := "/?new=" + url.QueryEscape(l.target)
		if id, ok := resolver.resolve(l.target, from); ok {
			target = "/?note=" + url.QueryEscape(id)
		}
		if l.heading != "" {
			target += "#" + url.PathEscape(l.heading)
		}
		label = strings.NewReplacer("\\", "\\\\", "[", "\\[", "]", "\\]", "*", "\\*", "_", "\\_", "`", "\\`").Replace(label)
		body = body[:l.start] + "[" + label + "](" + target + ")" + body[l.end:]
	}
	var output bytes.Buffer
	context := parser.NewContext(parser.WithIDs(newHeadingIDs()))
	if err := a.renderer.Convert([]byte(body), &output, parser.WithContext(context)); err != nil {
		return "", err
	}
	// No remote images in a local notebook: replace generated image tags with
	// their alt text so opening a note cannot make a tracking request.
	return suppressImages(output.String()), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	var api *apiError
	if errors.As(err, &api) {
		writeJSON(w, api.status, map[string]any{"error": api.message, "current": api.current})
		return
	}
	writeJSON(w, 500, map[string]string{"error": err.Error()})
}
