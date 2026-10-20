// Personal navigation lives in this browser, scoped to the vault, never in notes.
import { $, showError, showToast, state, storage } from "./core.js";
import { openNote } from "./editor.js";
import { closeUnifiedSearch } from "./search.js";
import { icon } from "./icons.js";
import { browseFolder, shortDate, updateFoldButton } from "./list.js";
import { setSidebar } from "./sidebar.js";

type Collection = "pins" | "recent";
const key = (kind: Collection) => `labradorite-${kind}:${state.vaultId}`;
function ids(kind: Collection): string[] {
  try {
    const value: unknown = JSON.parse(storage.get(key(kind)) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [];
  } catch { return []; }
}
function keep(kind: Collection, values: string[]) {
  if (!storage.set(key(kind), JSON.stringify(values)))
    showToast("Navigation works in this tab, but this browser could not remember it.", { persistent: true });
}
function rememberNote(id: string) {
  keep("recent", [id, ...ids("recent").filter((entry) => entry !== id)].slice(0, 30));
}
function renameNavigation(before: string, after: string) {
  // Publish the new address before any asynchronous list/editor refresh.
  const url = new URL(location.href);
  if (url.searchParams.get("note") === before) {
    url.searchParams.set("note", after);
    history.replaceState(null, "", url);
  }
  state.back = state.back.map(id => id === before ? after : id);
  state.forward = state.forward.map(id => id === before ? after : id);
  for (const kind of ["pins", "recent"] as const)
    keep(kind, [...new Set(ids(kind).map((id) => id === before ? after : id))]);
}
function hasPins() {
  const existing = new Set(state.notes.map((note) => note.id));
  return ids("pins").some((id) => existing.has(id));
}
function setPinsOpen(open: boolean) {
  $("pinned-notes").open = open;
  if (state.vaultId) storage.set(`labradorite-pins-open:${state.vaultId}`, String(open));
}
function togglePin() {
  const id = state.current?.id;
  if (!id) return;
  const pinned = ids("pins");
  keep("pins", pinned.includes(id) ? pinned.filter((entry) => entry !== id) : [...pinned, id]);
  renderNavigation();
}
function fillCollection(kind: Collection, element: HTMLElement) {
  element.replaceChildren();
  for (const id of ids(kind)) {
    const note = state.notes.find((entry) => entry.id === id);
    if (!note) continue;
    const button = document.createElement("button");
    button.className = "navigation-note";
    button.title = id;
    button.dataset.note = id;
    button.setAttribute("aria-current", state.current?.id === id ? "page" : "false");
    const title = document.createElement("span");
    title.textContent = note.title.split("/").pop() || note.title;
    const folder = document.createElement("small");
    folder.textContent = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "Notebook";
    if (kind === "pins") {
      const head = document.createElement("span");
      head.className = "note-row-head";
      title.className = "note-title";
      const date = document.createElement("time");
      date.className = "note-date";
      date.dateTime = note.modified;
      date.textContent = shortDate(note.modified);
      head.append(title, date);
      button.append(head);
    } else button.append(title, folder);
    button.onclick = () => openNote(id).catch(showError);
    element.append(button);
  }
}
function renderBreadcrumbs() {
  const container = $("note-folder");
  container.replaceChildren();
  if (!state.current) return;
  const folders = state.current.id.split("/").slice(0, -1);
  if (!folders.length) return;
  function crumb(label: string, folder: string | null) {
    const button = document.createElement("button");
    button.className = "breadcrumb";
    button.title = folder || "All notes";
    button.setAttribute("aria-label", folder ? `Browse ${folder}` : "Browse all notes");
    if (folder) button.textContent = label;
    else {
      button.innerHTML = icon("folder");
      // Crop the glyph's view box to its path so its bottom is the baseline.
      button.querySelector("svg")?.setAttribute("viewBox", "3 4 18 15");
    }
    button.onclick = () => browseFolder(folder);
    container.append(button);
  }
  crumb("Notebook", null);
  for (let i = 0; i < folders.length; i++) {
    const separator = document.createElement("span");
    separator.className = "breadcrumb-separator";
    separator.textContent = "/";
    separator.setAttribute("aria-hidden", "true");
    container.append(separator);
    crumb(folders[i], folders.slice(0, i + 1).join("/"));
  }
  void document.fonts.ready.then(() => {
    const name = container.querySelector<HTMLElement>(".breadcrumb:not(:has(svg))");
    if (!name) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    context.font = getComputedStyle(name).font;
    const capHeight = context.measureText("H").actualBoundingBoxAscent;
    if (capHeight) container.style.setProperty("--breadcrumb-cap", `${capHeight}px`);
  });
}
let pinnedVault = "";
function renderNavigation() {
  if (state.vaultId && state.vaultId !== pinnedVault) {
    pinnedVault = state.vaultId;
    $("pinned-notes").open = storage.get(`labradorite-pins-open:${state.vaultId}`) !== "false";
  }
  renderBreadcrumbs();
  $("find-replace").disabled = !state.current || Boolean(state.pendingDraft) || state.busy;
  fillCollection("pins", $("pinned-list"));
  $("pinned-notes").hidden = !$("pinned-list").childElementCount;
  fillCollection("recent", $("recent-list"));
  if (!$("recent-list").childElementCount) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = "Notes you open will appear here.";
    $("recent-list").append(empty);
  }
  const pinned = Boolean(state.current && ids("pins").includes(state.current.id));
  $("pin-note").setAttribute("aria-pressed", String(pinned));
  $("pin-note").title = pinned ? "Unpin note" : "Pin note";
  $("pin-note").setAttribute("aria-label", pinned ? "Unpin note" : "Pin note");
  updateFoldButton();
}
function showRecent() {
  closeUnifiedSearch().catch(showError);
  $("app").classList.add("show-recents");
  $("recent-panel").hidden = false;
  $("recent-notes").setAttribute("aria-pressed", "true");
  renderNavigation();
  setSidebar(true);
  $("recent-list").querySelector<HTMLButtonElement>("button")?.focus();
}
function showAllNotes() {
  $("app").classList.remove("show-recents");
  $("recent-panel").hidden = true;
  $("recent-notes").setAttribute("aria-pressed", "false");
}
export { hasPins, setPinsOpen, rememberNote, renameNavigation, renderNavigation, showAllNotes, showRecent, togglePin };
