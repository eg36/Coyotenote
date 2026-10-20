// One query field serves both vault search and find/replace in a note.
import { $, closeSearch, showError, state } from "./core.js";
import { refresh, setMode } from "./editor.js";
import { showNotes } from "./shortcuts.js";

type Scope = "all" | "note";
let scope: Scope = "all";
let previousMode: typeof state.mode | null = null;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
function updateMatches() {
  if (scope !== "note") return;
  const count = state.source?.matchCount() || 0;
  $("search-matches").textContent = !$("search").value ? "Type something to find in this note." : count < 0 ? "Invalid regular expression." : `${count} ${count === 1 ? "match" : "matches"}`;
  for (const id of ["search-previous", "search-next", "search-replace", "search-replace-all"] as const)
    $(id).disabled = count <= 0 || Boolean(state.pendingDraft) || state.busy;
}
function searchNote() {
  state.source?.search($("search").value, $("search-replacement").value, {
    caseSensitive: $("search-case").checked,
    wholeWord: $("search-word").checked,
    regexp: $("search-regex").checked,
  });
  updateMatches();
}
async function openSearch(next: Scope, query?: string) {
  if (next === "note" && (!state.current || state.pendingDraft || state.busy)) return;
  const request = ++generation;
  clearTimeout(timer);
  const restoreMode = next === "all" && scope === "note" ? previousMode : null;
  if (next === "note" && scope !== "note") previousMode = state.mode;
  if (next === "all") previousMode = null;
  scope = next;
  if (query !== undefined) $("search").value = query;
  state.folder = null;
  state.tag = "";
  state.search = next === "all" ? $("search").value : "";
  showNotes();
  $("app").classList.add("search-open");
  $("app").classList.toggle("search-in-note", next === "note");
  $("sidebar-search").setAttribute("aria-expanded", "true");
  $("search-all").setAttribute("aria-pressed", String(next === "all"));
  $("find-replace").setAttribute("aria-pressed", String(next === "note"));
  $("note-search-options").hidden = next !== "note";
  $("search").placeholder = next === "all" ? "Search all notes" : "Find in this note";
  $("search").setAttribute("aria-label", next === "all" ? "Search notes" : "Find in this note");
  refresh().catch(showError);
  if (next === "note") {
    if (!["source", "split"].includes(state.mode)) await setMode("source", { focus: false, persist: false });
    if (request !== generation) return;
    searchNote();
  } else {
    state.source?.search("", "");
    if (restoreMode && restoreMode !== state.mode)
      await setMode(restoreMode, { focus: false });
  }
  if (request === generation) $("search").focus();
}
async function closeUnifiedSearch() {
  const restoreMode = scope === "note" ? previousMode : null;
  ++generation;
  clearTimeout(timer);
  scope = "all";
  previousMode = null;
  $("app").classList.remove("search-open", "search-in-note");
  $("sidebar-search").setAttribute("aria-expanded", "false");
  $("search-all").setAttribute("aria-pressed", "true");
  $("find-replace").setAttribute("aria-pressed", "false");
  $("note-search-options").hidden = true;
  state.source?.search("", "");
  if (restoreMode && restoreMode !== state.mode)
    await setMode(restoreMode, { focus: false });
}
function setupSearch() {
  $("search-all").onclick = () => openSearch("all").catch(showError);
  $("find-replace").onclick = () => openSearch("note").catch(showError);
  $("search").onfocus = showNotes;
  $("search").oninput = () => {
    clearTimeout(timer);
    if (scope === "note") searchNote();
    else {
      state.search = $("search").value;
      const request = generation;
      timer = setTimeout(() => { if (request === generation) refresh().catch(showError); }, 120);
    }
  };
  $("search").onkeydown = (event) => {
    if (event.key === "Enter" && scope === "note") {
      event.preventDefault();
      state.source?.nextMatch(event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if ($("search").value) {
        $("search").value = "";
        $("search").dispatchEvent(new Event("input"));
      } else {
        $("sidebar-search").focus();
        closeSearch();
      }
    }
  };
  $("search-replacement").oninput = searchNote;
  for (const id of ["search-case", "search-word", "search-regex"] as const) $(id).onchange = searchNote;
  $("search-previous").onclick = () => state.source?.nextMatch(true);
  $("search-next").onclick = () => state.source?.nextMatch();
  $("search-replace").onclick = () => { state.source?.replaceMatch(); updateMatches(); };
  $("search-replace-all").onclick = () => { state.source?.replaceMatch(true); updateMatches(); };
  document.addEventListener("note-content-change", updateMatches);
  document.addEventListener("note-selection-change", () => {
    if (scope !== "note") return;
    if (!state.current) openSearch("all").catch(showError);
    else searchNote();
  });
  document.addEventListener("search-closed", () => closeUnifiedSearch().catch(showError));
  document.addEventListener("editor-mode-change", (event) => {
    if (scope !== "note") return;
    if (event instanceof CustomEvent && event.detail?.userInitiated) previousMode = null;
    if (!["source", "split"].includes(state.mode)) openSearch("all").catch(showError);
  });
}
export { closeUnifiedSearch, openSearch, setupSearch };
