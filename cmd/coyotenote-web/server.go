package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	"unicode"
	"unicode/utf8"

	"github.com/eg36/coyotenote/internal/vault"
	"github.com/eg36/coyotenote/internal/version"
	"github.com/eg36/coyotenote/web"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
)

const maxBodyBytes = 4 << 20

type webApp struct {
	store    *vault.Store
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

func newWebApp(s *vault.Store) (*webApp, error) {
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
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": version.String()})
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
		data, _ := web.Files.ReadFile("index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
		return
	}
	if r.URL.Path == "/assets/logo.png" {
		data, _ := web.Files.ReadFile("logo.png")
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		http.FileServer(http.FS(web.Files)).ServeHTTP(w, r)
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
		return &apiError{status: 422, message: "A note can contain up to 4 MiB in the web app."}
	case !utf8.ValidString(body) || vault.HasControl(body):
		return &apiError{status: 422, message: "Notes must be UTF-8 text without control characters."}
	case vault.LineCount(body) > vault.MaxLines:
		return &apiError{status: 422, message: "A note can contain up to 10,000 lines."}
	}
	return nil
}

func (a *webApp) load() ([]vault.Note, vault.LoadReport, error) {
	notes, report, err := a.store.Load()
	if err != nil {
		return nil, report, err
	}
	allowed := notes[:0]
	for _, n := range notes {
		if len(n.Body) > maxBodyBytes {
			report.Skipped = append(report.Skipped, n.ID+" (over the web app's 4 MiB limit)")
		} else {
			allowed = append(allowed, n)
		}
	}
	return allowed, report, nil
}

func view(s *vault.Store, n vault.Note, includeBody bool) noteView {
	text, _ := vault.EditorText(n.Body)
	fields := strings.Fields(text)
	excerpt := ""
	for _, word := range fields {
		if excerpt != "" {
			excerpt += " "
		}
		excerpt += word
		if utf8.RuneCountInString(excerpt) > 140 {
			excerpt = string([]rune(excerpt)[:140]) + "…"
			break
		}
	}
	modified := n.Modified
	if modified.IsZero() {
		if info, err := os.Stat(s.Path(n.ID)); err == nil {
			modified = info.ModTime()
		}
	}
	v := noteView{ID: n.ID, Title: vault.DisplayName(n.ID, n.Body), Excerpt: excerpt, Revision: revision(n.Body), Words: len(fields), Backlinks: []string{}}
	if !modified.IsZero() {
		v.Modified = modified.UTC().Format(time.RFC3339Nano)
	}
	if includeBody {
		v.Body = text
	}
	return v
}

// eachBacklink calls visit for every note linking to another note, once
// per pair.
func eachBacklink(notes []vault.Note, visit func(from, to string)) {
	resolver := vault.NewResolver(notes)
	for _, n := range notes {
		seen := map[string]bool{}
		for _, l := range vault.ParseLinks(n.Body) {
			if id, ok := resolver.Resolve(l.Target, n.ID); ok && id != n.ID && !seen[id] {
				visit(n.ID, id)
				seen[id] = true
			}
		}
	}
}

func views(s *vault.Store, notes []vault.Note, includeBody bool) []noteView {
	result := make([]noteView, 0, len(notes))
	byID := make(map[string]int)
	for _, n := range notes {
		byID[n.ID] = len(result)
		result = append(result, view(s, n, includeBody))
	}
	eachBacklink(notes, func(from, to string) {
		result[byID[to]].Backlinks = append(result[byID[to]].Backlinks, from)
	})
	return result
}

func (a *webApp) current(id string, notes []vault.Note, expected string) (vault.Note, *noteView, error) {
	if !vault.ValidID(id) {
		return vault.Note{}, nil, &apiError{status: 400, message: "invalid note path"}
	}
	for _, n := range notes {
		if n.ID == id {
			v := view(a.store, n, true)
			eachBacklink(notes, func(from, to string) {
				if to == id {
					v.Backlinks = append(v.Backlinks, from)
				}
			})
			if expected != "" && expected != v.Revision {
				return n, &v, &apiError{status: 409, message: "This note changed in another tab or program. Your edits are kept locally.", current: &v}
			}
			return n, &v, nil
		}
	}
	return vault.Note{}, nil, &apiError{status: 404, message: "Note not found. It may have been moved or deleted."}
}

func (a *webApp) api(w http.ResponseWriter, r *http.Request) error {
	if r.Method+" "+r.URL.Path == "GET /api/session" {
		// A cheap way for an open tab to renew its token after a restart.
		absolute, _ := filepath.Abs(a.store.Dir)
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
		if b, e := os.ReadFile(filepath.Join(a.store.Config, "theme")); e == nil && validTheme(strings.TrimSpace(string(b))) {
			theme = strings.TrimSpace(string(b))
		}
		list := views(a.store, notes, false)
		// Notes always lists the whole vault; matches names the search hits,
		// so a filtered sidebar never leaves stale notes behind.
		var matches []string
		snippets := map[string]string{}
		if q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))); q != "" {
			matches = []string{}
			for _, n := range notes {
				if strings.Contains(strings.ToLower(n.ID+"\n"+n.Body), q) {
					matches = append(matches, n.ID)
					if s := snippet(n.Body, q); s != "" {
						snippets[n.ID] = s
					}
				}
			}
		}
		themeList := []map[string]any{}
		for _, t := range themes {
			p := t.colors
			themeList = append(themeList, map[string]any{"id": t.id, "name": t.name, "light": t.light, "colors": map[string]string{"surface": p.surface, "chrome": p.chrome, "text": p.text, "muted": p.muted, "accent": p.accent, "cyan": p.cyan, "good": p.good, "warn": p.warn, "danger": p.danger, "line": p.line, "pink": p.pink, "blue": p.blue, "onPill": p.onPill}})
		}
		absolute, _ := filepath.Abs(a.store.Dir)
		warnings := append([]string{}, report.Skipped...)
		if report.Orphans > 0 {
			warnings = append(warnings, fmt.Sprintf("%d interrupted-write files retained in the vault", report.Orphans))
		}
		if report.Recoveries > 0 {
			warnings = append(warnings, fmt.Sprintf("%d recovery copies retained in the vault", report.Recoveries))
		}
		writeJSON(w, 200, map[string]any{"notes": list, "matches": matches, "snippets": snippets, "themes": themeList, "theme": theme, "vault": filepath.Base(absolute), "vaultId": revision(absolute)[:16], "token": a.token, "version": version.String(), "warnings": warnings, "limits": map[string]int{"lines": vault.MaxLines, "bytes": maxBodyBytes}})
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
	if route == "GET /api/trash" {
		list, err := a.store.Trashed()
		if err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"notes": list})
		return nil
	}
	in, err := decode(w, r)
	if err != nil {
		return err
	}
	switch route {
	case "POST /api/note":
		if in.ID == "" {
			in.ID = vault.FreeName(notes, "", "Untitled")
		}
		if err = vault.CheckName(in.ID); err != nil {
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
		n, err := a.store.Create(in.ID, in.Body)
		if err != nil {
			return err
		}
		writeJSON(w, 201, views(a.store, []vault.Note{n}, true)[0])
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
			_, crlf := vault.EditorText(n.Body)
			body := vault.DiskText(in.Body, crlf)
			if err = a.store.Save(n, body); err != nil {
				return &apiError{status: 409, message: err.Error()}
			}
			n.Body, n.Modified = body, time.Time{}
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
			trashID, err := a.store.Trash(n)
			if err != nil {
				return err
			}
			writeJSON(w, 200, map[string]string{"trashed": n.ID, "trashId": trashID})
		case "POST /api/rename":
			if in.Name == n.ID {
				writeJSON(w, 200, map[string]any{"note": views(a.store, []vault.Note{n}, true)[0], "warnings": []string{}})
				return nil
			}
			if err = vault.CheckName(in.Name); err != nil {
				return &apiError{status: 422, message: err.Error()}
			}
			for _, other := range notes {
				if other.ID != n.ID && strings.EqualFold(other.ID, in.Name) {
					return &apiError{status: 409, message: "A note with that name already exists."}
				}
			}
			if err = a.store.Rename(n, in.Name); err != nil {
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
		n, err := a.store.Restore(in.ID, to)
		if err != nil {
			return &apiError{status: 409, message: err.Error()}
		}
		writeJSON(w, 200, views(a.store, []vault.Note{n}, true)[0])
		return nil
	case "POST /api/settings":
		if !validTheme(in.Theme) {
			return &apiError{status: 422, message: "unknown theme"}
		}
		if err = vault.AtomicWrite(a.store.Config, "theme", []byte(in.Theme)); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]string{"theme": in.Theme})
		return nil
	case "POST /api/resolve":
		if len(in.Body) > 4096 {
			return &apiError{status: 422, message: "link target is too long"}
		}
		links := vault.ParseLinks("[[" + in.Body + "]]")
		if len(links) != 1 {
			return &apiError{status: 422, message: "invalid wiki link"}
		}
		l := links[0]
		id, found := vault.NewResolver(notes).Resolve(l.Target, in.ID)
		writeJSON(w, 200, map[string]any{"id": id, "found": found, "target": l.Target, "heading": l.Heading})
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
		if !vault.ValidID(in.ID) {
			return &apiError{status: 422, message: "invalid note path"}
		}
		if err = validateBody(in.Body); err != nil {
			return err
		}
		file, err := a.store.WriteRecovery(vault.Note{ID: in.ID}, in.Body)
		if err != nil {
			return err
		}
		writeJSON(w, 201, map[string]string{"path": file})
		return nil
	}
	return &apiError{status: 404, message: "API route not found"}
}

func (a *webApp) rewriteLinks(before []vault.Note, oldID, newID string) []string {
	after := append([]vault.Note{}, before...)
	for i := range after {
		if after[i].ID == oldID {
			after[i].ID = newID
		}
	}
	oldR, newR := vault.NewResolver(before), vault.NewResolver(after)
	warnings := []string{}
	for i, n := range after {
		body := n.Body
		links := vault.ParseLinks(body)
		for j := len(links) - 1; j >= 0; j-- {
			l := links[j]
			destination, ok := oldR.Resolve(l.Target, before[i].ID)
			if !ok {
				continue
			}
			if destination == oldID {
				destination = newID
			}
			if got, ok := newR.Resolve(l.Target, n.ID); ok && got == destination {
				continue
			}
			target := destination
			if !strings.Contains(l.Target, "/") {
				target = newR.ShortTarget(destination, n.ID)
			}
			body = body[:l.TargetStart] + target + body[l.TargetEnd:]
		}
		if body != n.Body {
			if err := a.store.Save(n, body); err != nil {
				warnings = append(warnings, "Could not update links in "+n.ID+": "+err.Error())
			}
		}
	}
	return warnings
}

func (a *webApp) render(body, from string, notes []vault.Note) (string, error) {
	resolver := vault.NewResolver(notes)
	links := vault.ParseLinks(body)
	for i := len(links) - 1; i >= 0; i-- {
		l := links[i]
		label := l.Alias
		if label == "" {
			label = l.Target
			if l.Heading != "" {
				label += " › " + l.Heading
			}
		}
		target := "/?new=" + url.QueryEscape(l.Target)
		if id, ok := resolver.Resolve(l.Target, from); ok {
			target = "/?note=" + url.QueryEscape(id)
		}
		if l.Heading != "" {
			target += "#" + url.PathEscape(l.Heading)
		}
		label = strings.NewReplacer("\\", "\\\\", "[", "\\[", "]", "\\]", "*", "\\*", "_", "\\_", "`", "\\`").Replace(label)
		body = body[:l.Start] + "[" + label + "](" + target + ")" + body[l.End:]
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

// snippet is the passage of body around the first match of the lower-case
// query q, with whitespace collapsed, or "" when only the note's path matches.
func snippet(body, q string) string {
	text := []rune(strings.Join(strings.Fields(body), " "))
	query := []rune(strings.Join(strings.Fields(q), " "))
	lower := make([]rune, len(text))
	for i, r := range text {
		lower[i] = unicode.ToLower(r)
	}
	at := -1
	for i := 0; i+len(query) <= len(lower) && at < 0; i++ {
		if string(lower[i:i+len(query)]) == string(query) {
			at = i
		}
	}
	if at < 0 || len(query) == 0 {
		return ""
	}
	start, end := max(0, at-40), min(len(text), at+len(query)+80)
	result := strings.TrimSpace(string(text[start:end]))
	if start > 0 {
		result = "…" + result
	}
	if end < len(text) {
		result += "…"
	}
	return result
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
