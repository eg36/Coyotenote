package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/eg36/coyotenote/internal/vault"
)

func testApp(t *testing.T) *webApp {
	t.Helper()
	s, err := vault.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	app, err := newWebApp(s)
	if err != nil {
		t.Fatal(err)
	}
	app.port = 4280
	return app
}

func request(t *testing.T, a *webApp, method, path string, body any, want int) map[string]any {
	t.Helper()
	var text string
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		text = string(b)
	}
	r := httptest.NewRequest(method, "http://127.0.0.1:4280"+path, strings.NewReader(text))
	r.Header.Set("X-Coyote-Token", a.token)
	r.Header.Set("Origin", "http://127.0.0.1:4280")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != want {
		t.Fatalf("%s %s: status %d want %d: %s", method, path, w.Code, want, w.Body.String())
	}
	result := map[string]any{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("%s: invalid JSON: %v: %s", path, err, w.Body.String())
	}
	return result
}

func TestNoteLifecycleAndPersistence(t *testing.T) {
	a := testApp(t)
	n := request(t, a, "POST", "/api/note", mutation{ID: "Work/First", Body: "# Hello\n\nworld"}, 201)
	if n["id"] != "Work/First" || n["body"] != "# Hello\n\nworld" {
		t.Fatalf("unexpected note: %v", n)
	}
	n = request(t, a, "PUT", "/api/note", mutation{ID: "Work/First", Body: "Edited\t世界\n", Revision: n["revision"].(string)}, 200)
	disk, err := os.ReadFile(a.store.Path("Work/First"))
	if err != nil {
		t.Fatal(err)
	}
	if string(disk) != "Edited\t世界\n" {
		t.Fatalf("disk contents %q", disk)
	}
	got := request(t, a, "GET", "/api/note?id=Work%2FFirst", nil, 200)
	if got["revision"] != n["revision"] {
		t.Fatal("revision did not persist")
	}
	request(t, a, "DELETE", "/api/note", mutation{ID: "Work/First", Revision: n["revision"].(string)}, 200)
	if _, err = os.Stat(a.store.Path("Work/First")); !os.IsNotExist(err) {
		t.Fatalf("note was not removed: %v", err)
	}
	restored := request(t, a, "POST", "/api/restore", mutation{ID: "Work/First"}, 200)
	if restored["body"] != "Edited\t世界\n" {
		t.Fatal("trash restore lost data")
	}
	request(t, a, "POST", "/api/note", mutation{ID: "work/first"}, 409)
	report := request(t, a, "GET", "/api/state", nil, 200)
	if len(report["notes"].([]any)) != 1 {
		t.Fatal("unexpected note count")
	}
}

func TestConflictDoesNotOverwriteAndRecovery(t *testing.T) {
	a := testApp(t)
	n := request(t, a, "POST", "/api/note", mutation{ID: "Thought", Body: "original"}, 201)
	if err := os.WriteFile(a.store.Path("Thought"), []byte("changed outside"), 0600); err != nil {
		t.Fatal(err)
	}
	error := request(t, a, "PUT", "/api/note", mutation{ID: "Thought", Body: "unsaved local edit", Revision: n["revision"].(string)}, 409)
	if error["current"].(map[string]any)["body"] != "changed outside" {
		t.Fatal("conflict response has no disk version")
	}
	recovered := request(t, a, "POST", "/api/recovery", mutation{ID: "Thought", Body: "unsaved local edit"}, 201)
	copy, err := os.ReadFile(recovered["path"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if string(copy) != "unsaved local edit" {
		t.Fatal("recovery content lost")
	}
	disk, err := os.ReadFile(a.store.Path("Thought"))
	if err != nil {
		t.Fatal(err)
	}
	if string(disk) != "changed outside" {
		t.Fatal("external version overwritten")
	}
	request(t, a, "DELETE", "/api/note", mutation{ID: "Thought", Revision: n["revision"].(string)}, 409)
}

func TestLineEndingsPreserved(t *testing.T) {
	a := testApp(t)
	if err := os.WriteFile(a.store.Path("Windows"), []byte("hello\r\nworld\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	n := request(t, a, "GET", "/api/note?id=Windows", nil, 200)
	if n["body"] != "hello\nworld\n" {
		t.Fatal("line endings not normalized for browser")
	}
	request(t, a, "PUT", "/api/note", mutation{ID: "Windows", Body: "hello\nchanged\n", Revision: n["revision"].(string)}, 200)
	b, err := os.ReadFile(a.store.Path("Windows"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "hello\r\nchanged\r\n" {
		t.Fatalf("line endings changed: %q", b)
	}
}

func TestRenameRewritesLinksAndBacklinks(t *testing.T) {
	a := testApp(t)
	note := request(t, a, "POST", "/api/note", mutation{ID: "Work/Plan", Body: "# Plan"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Ideas", Body: "[[Work/Plan#Details|project]] and `[[Work/Plan]]`"}, 201)
	state := request(t, a, "GET", "/api/state", nil, 200)
	found := false
	for _, raw := range state["notes"].([]any) {
		n := raw.(map[string]any)
		if n["id"] == "Work/Plan" {
			found = true
			if len(n["backlinks"].([]any)) != 1 {
				t.Fatal("missing backlink")
			}
		}
	}
	if !found {
		t.Fatal("missing note")
	}
	request(t, a, "POST", "/api/rename", mutation{ID: "Work/Plan", Name: "Work/New plan", Revision: note["revision"].(string)}, 200)
	updated := request(t, a, "GET", "/api/note?id=Ideas", nil, 200)
	if updated["body"] != "[[Work/New plan#Details|project]] and `[[Work/Plan]]`" {
		t.Fatalf("wrong link rewrite: %v", updated["body"])
	}
	// A note linking to itself is rewritten at its new path without a conflict.
	self := request(t, a, "POST", "/api/note", mutation{ID: "Loop", Body: "Back to [[Loop#Top]]."}, 201)
	renamed := request(t, a, "POST", "/api/rename", mutation{ID: "Loop", Name: "Spiral", Revision: self["revision"].(string)}, 200)
	if len(renamed["warnings"].([]any)) != 0 || renamed["note"].(map[string]any)["body"] != "Back to [[Spiral#Top]]." {
		t.Fatalf("self link: %v", renamed)
	}
}

// A move that completes but cannot be synced is reported as done, with a
// warning, so links are still rewritten and clients see where the note is.
func TestMovesReportSuccessWhenDirectorySyncFails(t *testing.T) {
	a := testApp(t)
	note := request(t, a, "POST", "/api/note", mutation{ID: "Work/Plan", Body: "# Plan"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Ideas", Body: "See [[Work/Plan]]."}, 201)
	sync := vault.MoveSync
	vault.MoveSync = func(string) error { return errors.New("disk said no") }
	t.Cleanup(func() { vault.MoveSync = sync })

	renamed := request(t, a, "POST", "/api/rename", mutation{ID: "Work/Plan", Name: "Work/Project", Revision: note["revision"].(string)}, 200)
	if warnings := fmt.Sprint(renamed["warnings"]); !strings.Contains(warnings, "disk said no") {
		t.Fatalf("rename warnings: %v", warnings)
	}
	if body := request(t, a, "GET", "/api/note?id=Ideas", nil, 200)["body"]; body != "See [[Work/Project]]." {
		t.Fatalf("links not rewritten after the move: %v", body)
	}
	moved := renamed["note"].(map[string]any)
	trashed := request(t, a, "DELETE", "/api/note", mutation{ID: "Work/Project", Revision: moved["revision"].(string)}, 200)
	if !strings.Contains(trashed["warning"].(string), "disk said no") || trashed["trashId"] != "Work/Project" {
		t.Fatalf("trash response: %v", trashed)
	}
	restored := request(t, a, "POST", "/api/restore", mutation{ID: "Work/Project"}, 200)
	if restored["id"] != "Work/Project" || !strings.Contains(restored["warning"].(string), "disk said no") {
		t.Fatalf("restore response: %v", restored)
	}
	if _, err := os.Stat(filepath.Join(a.store.Dir, "Work", "Project.md")); err != nil {
		t.Fatal(err)
	}
}

func TestThemesMatchMainAndPersist(t *testing.T) {
	a := testApp(t)
	state := request(t, a, "GET", "/api/state", nil, 200)
	if len(state["themes"].([]any)) != 14 {
		t.Fatalf("theme count: %v", state["themes"])
	}
	for _, theme := range themes {
		request(t, a, "POST", "/api/settings", mutation{Theme: theme.id}, 200)
		got := request(t, a, "GET", "/api/state", nil, 200)
		if got["theme"] != theme.id {
			t.Fatalf("theme not persisted: %s", theme.id)
		}
	}
	request(t, a, "POST", "/api/settings", mutation{Theme: "not-a-theme"}, 422)
}

func TestMarkdownRenderingSafety(t *testing.T) {
	a := testApp(t)
	request(t, a, "POST", "/api/note", mutation{ID: "Plan"}, 201)
	source := "# Heading\n\n**bold** and [[Plan#Details|project]].\n\n- [x] Done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n![tracker](https://example.com/image.png)\n\n[bad](javascript:alert(1))\n\n```go\nfmt.Println(1)\n```"
	result := request(t, a, "POST", "/api/render", mutation{Body: source, ID: "Other"}, 200)["html"].(string)
	for _, expected := range []string{"<h1", "<strong>bold</strong>", "/?note=Plan", "<table>", "type=\"checkbox\"", "<pre><code", "[image: tracker]"} {
		if !strings.Contains(result, expected) {
			t.Errorf("missing %q in %s", expected, result)
		}
	}
	for _, unsafe := range []string{"<script>", "<img", "href=\"javascript:"} {
		if strings.Contains(result, unsafe) {
			t.Errorf("unsafe markup %q", unsafe)
		}
	}
}

func TestInvalidInputAndFiles(t *testing.T) {
	a := testApp(t)
	request(t, a, "POST", "/api/note", mutation{ID: "../escape"}, 422)
	request(t, a, "POST", "/api/note", mutation{ID: "Good", Body: "kept"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Too big", Body: strings.Repeat("line\n", 10000)}, 422)
	for name, body := range map[string]string{"Invalid": "\xff", "Control": "hello\x1b[31m"} {
		if err := os.WriteFile(a.store.Path(name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(a.store.Path("Good"), a.store.Path("Linked")); err != nil {
		t.Fatal(err)
	}
	state := request(t, a, "GET", "/api/state", nil, 200)
	if len(state["notes"].([]any)) != 1 || len(state["warnings"].([]any)) != 3 {
		t.Fatalf("unsafe files were not skipped: %v", state)
	}
}

func TestLocalRequestProtection(t *testing.T) {
	a := testApp(t)
	for _, tc := range []struct{ host, origin, token string }{
		{"attacker.example:4280", "", a.token},
		{"127.0.0.1:4280", "https://attacker.example", a.token},
		{"127.0.0.1:4280", "http://127.0.0.1:4280", ""},
	} {
		r := httptest.NewRequest("POST", "http://"+tc.host+"/api/note", strings.NewReader(`{"id":"Bad"}`))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-Coyote-Token", tc.token)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("host %s origin %s: status %d", tc.host, tc.origin, w.Code)
		}
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:4280/", nil)
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "coyotenote") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("index or protection headers missing")
	}
}

func TestAtomicWriteAndWriterLock(t *testing.T) {
	a := testApp(t)
	if second, err := vault.Open(a.store.Dir); err == nil {
		second.Close()
		t.Fatal("second vault writer allowed")
	}
	n, err := a.store.Create("Safe", "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		body := fmt.Sprintf("revision %d", i)
		if err = a.store.Save(n, body); err != nil {
			t.Fatal(err)
		}
		n.Body = body
	}
	entries, err := os.ReadDir(a.store.Dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".pending-") {
			t.Fatal("temporary write leaked")
		}
	}
	if err = os.WriteFile(filepath.Join(a.store.Dir, ".pending-interrupted"), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	notes, report, err := a.store.Load()
	if err != nil || report.Orphans != 1 || notes[0].Body != "revision 3" {
		t.Fatalf("recovery: %v %+v %v", notes, report, err)
	}
}

func TestTrashKeepsNotesWithRepeatedNames(t *testing.T) {
	a := testApp(t)
	trashIDs := []string{}
	for _, body := range []string{"first", "second", "third"} {
		n := request(t, a, "POST", "/api/note", mutation{ID: "Folder/Dup", Body: body}, 201)
		trashed := request(t, a, "DELETE", "/api/note", mutation{ID: "Folder/Dup", Revision: n["revision"].(string)}, 200)
		trashIDs = append(trashIDs, trashed["trashId"].(string))
	}
	if strings.Join(trashIDs, ",") != "Folder/Dup,Folder/Dup 2,Folder/Dup 3" {
		t.Fatalf("trash names %v", trashIDs)
	}
	for i, body := range []string{"first", "second", "third"} {
		b, err := os.ReadFile(filepath.Join(a.store.Dir, ".trash", filepath.FromSlash(trashIDs[i])+".md"))
		if err != nil || string(b) != body {
			t.Fatalf("trashed %s = %q, %v", trashIDs[i], b, err)
		}
	}
	restored := request(t, a, "POST", "/api/restore", mutation{ID: "Folder/Dup 2", Name: "Folder/Dup"}, 200)
	if restored["id"] != "Folder/Dup" || restored["body"] != "second" {
		t.Fatalf("restored %v", restored)
	}
	request(t, a, "POST", "/api/restore", mutation{ID: "Folder/Dup 3", Name: "Folder/Dup"}, 409)
}

func TestHeadingIDsCannotShadowAppElements(t *testing.T) {
	a := testApp(t)
	result := request(t, a, "POST", "/api/render", mutation{Body: "# Modal\n## Word count\n## Word count\n# ¿Qué tal?\n# !!!", ID: "Other"}, 200)["html"].(string)
	for _, expected := range []string{`id="h-modal"`, `id="h-word-count"`, `id="h-word-count-1"`, `id="h-qué-tal"`, `id="h-heading"`} {
		if !strings.Contains(result, expected) {
			t.Errorf("missing %s in %s", expected, result)
		}
	}
	for _, shadow := range []string{`id="modal"`, `id="word-count"`} {
		if strings.Contains(result, shadow) {
			t.Errorf("heading took app element %s", shadow)
		}
	}
}

func TestSearchReportsMatchesAlongsideEveryNote(t *testing.T) {
	a := testApp(t)
	request(t, a, "POST", "/api/note", mutation{ID: "Garden", Body: "Tomatoes and basil"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Work/Basil plan", Body: "Quarterly"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Other", Body: "Nothing here"}, 201)
	state := request(t, a, "GET", "/api/state?q=BASIL", nil, 200)
	if len(state["notes"].([]any)) != 3 {
		t.Fatalf("search should still list every note: %v", state["notes"])
	}
	if got := fmt.Sprint(state["matches"]); got != "[Garden Work/Basil plan]" {
		t.Fatalf("matches %s", got)
	}
	if state := request(t, a, "GET", "/api/state", nil, 200); state["matches"] != nil {
		t.Fatalf("unfiltered state reported matches %v", state["matches"])
	}
}

func TestSessionRenewsTokenForTheSameVaultOnly(t *testing.T) {
	a := testApp(t)
	session := request(t, a, "GET", "/api/session", nil, 200)
	state := request(t, a, "GET", "/api/state", nil, 200)
	if session["token"] != a.token || session["vaultId"] != state["vaultId"] {
		t.Fatalf("session %v does not match state", session)
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:4280/api/session", nil)
	r.Header.Set("Origin", "https://attacker.example")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden || strings.Contains(w.Body.String(), a.token) {
		t.Fatalf("cross-origin session request: %d %s", w.Code, w.Body.String())
	}
}

func TestLoadCacheNeverServesStaleText(t *testing.T) {
	a := testApp(t)
	n := request(t, a, "POST", "/api/note", mutation{ID: "Cached", Body: "aaa"}, 201)
	p := a.store.Path("Cached")
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	// A coarse file system can give a quick same-size save the same time.
	n = request(t, a, "PUT", "/api/note", mutation{ID: "Cached", Body: "bbb", Revision: n["revision"].(string)}, 200)
	if err = os.Chtimes(p, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if got := request(t, a, "GET", "/api/note?id=Cached", nil, 200); got["body"] != "bbb" || got["revision"] != n["revision"] {
		t.Fatalf("own save served stale text: %v", got)
	}
	// Another editor may keep the length and restore the time.
	if err = os.WriteFile(p, []byte("ccc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(p, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if got := request(t, a, "GET", "/api/note?id=Cached", nil, 200); got["body"] != "ccc" {
		t.Fatalf("same-size outside change missed: %v", got)
	}
	if err = os.WriteFile(p, []byte("changed outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := request(t, a, "GET", "/api/note?id=Cached", nil, 200); got["body"] != "changed outside" {
		t.Fatalf("outside change missed: %v", got)
	}
	if err = os.WriteFile(p, []byte{0xff}, 0600); err != nil {
		t.Fatal(err)
	}
	state := request(t, a, "GET", "/api/state", nil, 200)
	if len(state["notes"].([]any)) != 0 || !strings.Contains(fmt.Sprint(state["warnings"]), "Cached.md (not UTF-8)") {
		t.Fatalf("invalid file was not skipped: %v", state)
	}
}

func TestMovesRemoveFoldersTheyLeaveEmpty(t *testing.T) {
	a := testApp(t)
	exists := func(rel string) bool {
		_, err := os.Stat(filepath.Join(a.store.Dir, filepath.FromSlash(rel)))
		return err == nil
	}
	n := request(t, a, "POST", "/api/note", mutation{ID: "A/B/Moved"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Keep/Sibling"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Keep/Deep/Leaving"}, 201)
	request(t, a, "POST", "/api/rename", mutation{ID: "A/B/Moved", Name: "Top", Revision: n["revision"].(string)}, 200)
	if exists("A") {
		t.Fatal("renaming left empty folders behind")
	}
	leaving := request(t, a, "GET", "/api/note?id=Keep%2FDeep%2FLeaving", nil, 200)
	request(t, a, "DELETE", "/api/note", mutation{ID: "Keep/Deep/Leaving", Revision: leaving["revision"].(string)}, 200)
	if exists("Keep/Deep") || !exists("Keep/Sibling.md") {
		t.Fatal("trash pruned the wrong folders")
	}
	request(t, a, "POST", "/api/restore", mutation{ID: "Keep/Deep/Leaving"}, 200)
	if exists(".trash/Keep") || !exists(".trash") || !exists("Keep/Deep/Leaving.md") {
		t.Fatal("restore did not tidy the trash folders")
	}
}

func TestTrashListsNotesForRestore(t *testing.T) {
	a := testApp(t)
	if list := request(t, a, "GET", "/api/trash", nil, 200)["notes"].([]any); len(list) != 0 {
		t.Fatalf("new vault trash %v", list)
	}
	for _, id := range []string{"Old/Plan", "Recent"} {
		n := request(t, a, "POST", "/api/note", mutation{ID: id, Body: "Body of " + id}, 201)
		request(t, a, "DELETE", "/api/note", mutation{ID: id, Revision: n["revision"].(string)}, 200)
	}
	if err := os.Symlink(a.store.Path("Elsewhere"), filepath.Join(a.store.Dir, ".trash", "Link.md")); err != nil {
		t.Fatal(err)
	}
	list := request(t, a, "GET", "/api/trash", nil, 200)["notes"].([]any)
	ids := []string{}
	for _, item := range list {
		ids = append(ids, item.(map[string]any)["id"].(string))
	}
	if len(ids) != 2 || !strings.Contains(strings.Join(ids, ","), "Old/Plan") || list[0].(map[string]any)["excerpt"] == "" {
		t.Fatalf("trash list %v", list)
	}
	request(t, a, "POST", "/api/restore", mutation{ID: "Old/Plan"}, 200)
	if list := request(t, a, "GET", "/api/trash", nil, 200)["notes"].([]any); len(list) != 1 {
		t.Fatalf("restored note still listed: %v", list)
	}
}

func TestSearchSnippetsShowTheMatchingPassage(t *testing.T) {
	a := testApp(t)
	long := strings.Repeat("filler ", 30) + "the \n  QUARTZ clock ticks " + strings.Repeat("after ", 30)
	request(t, a, "POST", "/api/note", mutation{ID: "Long", Body: long}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Quartz path only", Body: "Nothing relevant"}, 201)
	state := request(t, a, "GET", "/api/state?q=quartz+clock", nil, 200)
	snippets := state["snippets"].(map[string]any)
	got, _ := snippets["Long"].(string)
	if !strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "…") || !strings.Contains(got, "the QUARTZ clock ticks") || len([]rune(got)) > 140 {
		t.Fatalf("snippet %q", got)
	}
	state = request(t, a, "GET", "/api/state?q=quartz", nil, 200)
	if _, ok := state["snippets"].(map[string]any)["Quartz path only"]; ok {
		t.Fatal("a path-only match should keep its excerpt")
	}
	if got := snippet("Straße İstanbul", "i̇stanbul"); got != "" && !strings.Contains(got, "İstanbul") {
		t.Fatalf("unicode snippet %q", got)
	}
}

func raw(t *testing.T, a *webApp, method, path string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:4280"+path, bytes.NewReader(body))
	r.Header.Set("X-Coyote-Token", a.token)
	r.Header.Set("Origin", "http://127.0.0.1:4280")
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}

var tinyPNG = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89")

func TestAttachmentsUploadServeAndRender(t *testing.T) {
	a := testApp(t)
	w := raw(t, a, "POST", "/api/attachment?name=Trip%20photo.png", tinyPNG, nil)
	if w.Code != 201 || !strings.Contains(w.Body.String(), `"path":"attachments/Trip-photo.png"`) {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	for name, body := range map[string][]byte{"fake.png": []byte("not an image"), "notes.txt": []byte("x"), "x.svg": []byte("<html>")} {
		if w := raw(t, a, "POST", "/api/attachment?name="+name, body, nil); w.Code != 415 {
			t.Errorf("%s accepted: %d", name, w.Code)
		}
	}
	if w := raw(t, a, "POST", "/api/attachment?name=a.png", tinyPNG, map[string]string{"X-Coyote-Token": "wrong"}); w.Code != 403 {
		t.Errorf("upload without the token: %d", w.Code)
	}

	// The file is served to this app's pages only, and may not run scripts.
	w = raw(t, a, "GET", "/vault-file?from=Trip%2FLisbon&src=..%2Fattachments%2FTrip-photo.png", nil, map[string]string{"Sec-Fetch-Site": "same-origin"})
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") || !bytes.Equal(w.Body.Bytes(), tinyPNG) {
		t.Fatalf("serve: %d %v", w.Code, w.Header())
	}
	if w := raw(t, a, "GET", "/vault-file?src=attachments%2FTrip-photo.png", nil, map[string]string{"Sec-Fetch-Site": "cross-site"}); w.Code != 403 {
		t.Errorf("cross-site embed: %d", w.Code)
	}
	os.MkdirAll(filepath.Join(a.store.Dir, ".trash"), 0700)
	os.WriteFile(filepath.Join(a.store.Dir, ".trash", "x.png"), tinyPNG, 0600)
	request(t, a, "POST", "/api/note", mutation{ID: "Readme", Body: "text"}, 201)
	for _, src := range []string{".trash/x.png", "../x.png", "Readme.md", "missing.png"} {
		if w := raw(t, a, "GET", "/vault-file?src="+url.QueryEscape(src), nil, nil); w.Code != 404 {
			t.Errorf("%s served: %d", src, w.Code)
		}
	}

	body := "![Trip](attachments/Trip-photo.png) ![[Trip-photo.png|Embedded]] ![gone](nothing.png) ![remote](https://example.com/x.png)"
	html := request(t, a, "POST", "/api/render", mutation{ID: "Readme", Body: body}, 200)["html"].(string)
	for _, want := range []string{
		`<img loading="lazy" src="/vault-file?from=&amp;src=attachments%2FTrip-photo.png" alt="Trip">`,
		`<img loading="lazy" src="/vault-file?from=&amp;src=attachments%2FTrip-photo.png" alt="Embedded">`,
		"[missing image: gone]",
		"[image: remote]",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("render lacks %s:\n%s", want, html)
		}
	}
	if state := request(t, a, "GET", "/api/state", nil, 200); len(state["notes"].([]any)) != 1 {
		t.Fatalf("attachments listed as notes: %v", state["notes"])
	}
}

func TestHistoryKeepsReplacedTextAndRestoresIt(t *testing.T) {
	a := testApp(t)
	n := request(t, a, "POST", "/api/note", mutation{ID: "Plan", Body: "first"}, 201)
	versions := func(id string) []any {
		return request(t, a, "GET", "/api/history?id="+id, nil, 200)["versions"].([]any)
	}
	// The first save in a session keeps what it replaces; autosaves soon after do not.
	n = request(t, a, "PUT", "/api/note", mutation{ID: "Plan", Body: "second", Revision: n["revision"].(string)}, 200)
	n = request(t, a, "PUT", "/api/note", mutation{ID: "Plan", Body: "third", Revision: n["revision"].(string)}, 200)
	if got := versions("Plan"); len(got) != 1 {
		t.Fatalf("versions after quick saves: %v", got)
	}
	// Text changed outside the app is always kept before it is replaced.
	if err := os.WriteFile(a.store.Path("Plan"), []byte("from another editor"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := request(t, a, "GET", "/api/note?id=Plan", nil, 200)
	request(t, a, "PUT", "/api/note", mutation{ID: "Plan", Body: "fourth", Revision: outside["revision"].(string)}, 200)
	got := versions("Plan")
	if len(got) != 2 {
		t.Fatalf("versions after an outside edit: %v", got)
	}
	newest := got[0].(map[string]any)["id"].(string)
	oldest := got[1].(map[string]any)["id"].(string)
	if body := request(t, a, "GET", "/api/version?id=Plan&v="+newest, nil, 200)["body"]; body != "from another editor" {
		t.Fatalf("newest version %v", body)
	}
	request(t, a, "GET", "/api/version?id=Plan&v=nope", nil, 404)

	// Restoring needs the current revision and keeps the text it replaces.
	current := request(t, a, "GET", "/api/note?id=Plan", nil, 200)
	request(t, a, "POST", "/api/history/restore", mutation{ID: "Plan", Name: oldest, Revision: "stale"}, 409)
	restored := request(t, a, "POST", "/api/history/restore", mutation{ID: "Plan", Name: oldest, Revision: current["revision"].(string)}, 200)
	if restored["body"] != "first" {
		t.Fatalf("restored %v", restored["body"])
	}
	if got := versions("Plan"); len(got) != 3 || request(t, a, "GET", "/api/version?id=Plan&v="+got[0].(map[string]any)["id"].(string), nil, 200)["body"] != "fourth" {
		t.Fatalf("restore did not keep the replaced text: %v", got)
	}
	request(t, a, "POST", "/api/rename", mutation{ID: "Plan", Name: "Archive/Plan", Revision: restored["revision"].(string)}, 200)
	if got := versions("Archive%2FPlan"); len(got) != 3 {
		t.Fatalf("history did not follow the rename: %v", got)
	}
}
