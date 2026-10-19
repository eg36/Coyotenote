import type { Note } from "./types.js";
// The sidebar note list: ordering, excerpts and search highlights.
import { icon } from "./icons.js";
import { $, showError, state, storage } from "./core.js";
import { openNote } from "./editor.js";
import { moveNote } from "./dialogs.js";

// excerpt cleans a note's opening text for the list, leaving out a leading
// heading that only repeats the note's title.
function excerpt(text: string, title = "") {
  const plain = text
    .replace(/^#+\s*/, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[*`_]/g, "");
  return title && plain.toLowerCase().startsWith(title.toLowerCase() + " ")
    ? plain.slice(title.length + 1)
    : plain;
}
// shortDate names the day a note changed, adding the year only when it is
// not the current one. The formatters are shared: building one per row
// took most of the list's render time in large vaults.
const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dayYearFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return (thisYear ? dayFormat : dayYearFormat).format(date);
}
const noteCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
// hasTag reports whether note carries tag, ignoring letter case.
const hasTag = (note: Note, tag: string) =>
  note.tags?.some((t) => t.toLowerCase() === tag.toLowerCase());
function visibleNotes() {
  const notes = state.notes.filter(
    (note) =>
      (!state.filteredIds || state.filteredIds.has(note.id)) &&
      (!state.tag || hasTag(note, state.tag)),
  );
  const folder = (note: Note) => note.id.slice(0, Math.max(0, note.id.lastIndexOf("/")));
  const title = (note: Note) => note.title.split("/").pop() || note.title;
  return notes.sort((a, b) => {
    // Group folders consistently, then order the notes inside each group.
    const groupOrder =
      noteCollator.compare(folder(a), folder(b)) ||
      folder(a).localeCompare(folder(b));
    if (groupOrder) return groupOrder;
    if (state.sort === "modified") {
      const modifiedOrder =
        (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0);
      if (modifiedOrder) return modifiedOrder;
    }
    const titleOrder = noteCollator.compare(title(a), title(b));
    return (
      (state.sort === "title-desc" ? -titleOrder : titleOrder) ||
      a.id.localeCompare(b.id)
    );
  });
}
// highlight fills element with text, marking each case-insensitive match of
// query. It builds text nodes, so note content never becomes markup.
function highlight(element: HTMLElement, text: string, query: string) {
  const needle = query.trim().replace(/\s+/g, " ").toLowerCase();
  const lower = text.toLowerCase();
  if (!needle || lower.length !== text.length) {
    element.textContent = text;
    return;
  }
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    element.append(text.slice(from, at));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + needle.length);
    element.append(mark);
    from = at + needle.length;
  }
  element.append(text.slice(from));
}
// Collapsed folders are remembered per vault in this browser. Searching
// shows every match, collapsed or not.
const collapsedKey = () => "coyote-collapsed:" + state.vaultId;
function collapsedFolders() {
  try {
    const value: unknown = JSON.parse(storage.get(collapsedKey()) || "[]");
    return new Set(Array.isArray(value) ? value.filter((folder): folder is string => typeof folder === "string") : []);
  } catch {
    return new Set<string>();
  }
}
function setCollapsed(folder: string, collapsed: boolean) {
  const folders = collapsedFolders();
  if (collapsed === folders.has(folder)) return;
  if (collapsed) folders.add(folder);
  else folders.delete(folder);
  storage.set(collapsedKey(), JSON.stringify([...folders]));
}
// revealNote expands the folder holding id, so the open note is listed.
function revealNote(id: string) {
  setCollapsed(id.split("/").slice(0, -1).join("/"), false);
}
const noteType = "application/x-coyote-note";
// renderTags offers the vault's tags, with how many notes carry each, as a
// filter for the list. It hides while the vault has no tags.
function renderTags() {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const note of state.notes)
    for (const tag of note.tags || []) {
      const key = tag.toLowerCase();
      counts.set(key, { tag: counts.get(key)?.tag || tag, n: (counts.get(key)?.n || 0) + 1 });
    }
  const filter = $("tag-filter");
  const list = $("tag-options");
  if (state.tag && !counts.has(state.tag.toLowerCase())) state.tag = "";
  filter.hidden = counts.size === 0;
  const options = [...counts.values()]
    .sort((a, b) => noteCollator.compare(a.tag, b.tag))
    .map(({ tag, n }): [string, number] => [tag, n]);
  // Keep the disclosure and its summary stable while note counts refresh.
  const signature = JSON.stringify(options);
  if (filter.dataset.signature !== signature) {
    filter.dataset.signature = signature;
    list.replaceChildren();
    for (const [tag, n] of [["", state.notes.length] as [string, number], ...options]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-option";
      button.dataset.tag = tag;
      const label = document.createElement("span");
      label.textContent = tag ? `#${tag}` : "All tags";
      const count = document.createElement("span");
      count.className = "tag-count";
      count.textContent = n.toLocaleString();
      button.append(label, count);
      list.append(button);
    }
  }
  const selected = state.tag.toLowerCase();
  for (const button of list.querySelectorAll<HTMLButtonElement>("[data-tag]"))
    button.setAttribute("aria-pressed", String((button.dataset.tag || "").toLowerCase() === selected));
  // The reset count also changes when untagged notes are created/deleted.
  const resetCount = list.firstElementChild?.querySelector(".tag-count");
  if (resetCount) resetCount.textContent = state.notes.length.toLocaleString();
  $("tag-filter-label").textContent = state.tag ? `#${(counts.get(selected)?.tag || state.tag)}` : "All tags";
  filter.classList.toggle("active", Boolean(state.tag));
}
// filterTag shows only notes with tag, or every note for "".
function filterTag(tag: string) {
  state.tag = tag;
  renderTags();
  renderList();
  if (tag) {
    $("tag-filter").open = true;
    $("app").classList.remove("sidebar-hidden", "focus-mode");
    $("app").classList.add("sidebar-open");
  }
}
// Rows remember what they show. A render that keeps the same rows in the
// same order (opening a note, an autosave) only touches the rows whose
// text or selection changed: rebuilding thousands of rows each time is
// slow in large vaults.
let listShape = "";
const rowContent = new WeakMap<HTMLElement, string>();
function fillRow(button: HTMLButtonElement, note: Note) {
  const selected = state.current?.id === note.id;
  button.classList.toggle("selected", selected);
  button.setAttribute("aria-current", selected ? "page" : "false");
  const found = state.filteredIds && state.snippets?.[note.id];
  const content = JSON.stringify([note.title, note.modified, note.excerpt, found, state.searched]);
  if (rowContent.get(button) === content) return;
  rowContent.set(button, content);
  const head = document.createElement("span");
  head.className = "note-row-head";
  const label = document.createElement("span");
  label.className = "note-title";
  label.textContent = note.title.split("/").pop() || note.title;
  const date = document.createElement("time");
  date.className = "note-date";
  date.textContent = shortDate(note.modified);
  head.append(label, date);
  const text = document.createElement("span");
  text.className = "note-excerpt";
  if (found) highlight(text, found, state.searched || "");
  else
    text.textContent =
      excerpt(note.excerpt, label.textContent) || "Empty note";
  button.replaceChildren(head, text);
}
function renderList() {
  renderTags();
  const notes = visibleNotes();
  const list = $("note-list");
  $("note-count").textContent = String(notes.length);
  if (!notes.length) {
    listShape = "";
    const el = document.createElement("p");
    el.className = "list-empty";
    el.textContent = state.search
      ? "No matching notes. Try a different word."
      : state.tag
        ? "No notes with this tag."
        : "No notes yet.";
    list.replaceChildren(el);
    return;
  }
  const collapsed = state.filteredIds || state.tag ? new Set() : collapsedFolders();
  const shape = JSON.stringify([notes.map((n) => n.id), [...collapsed], Boolean(state.filteredIds)]);
  if (shape === listShape) {
    const byId = new Map(notes.map((n) => [n.id, n]));
    for (const button of list.querySelectorAll<HTMLButtonElement>(".note-row")) {
      const note = byId.get(button.dataset.note || "");
      if (note) fillRow(button, note);
    }
    return;
  }
  listShape = shape;
  list.replaceChildren();
  list.classList.toggle("searching", Boolean(state.filteredIds));
  const folderOf = (note: Note) => note.id.split("/").slice(0, -1).join("/");
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(folderOf(note), (counts.get(folderOf(note)) || 0) + 1);
  let lastFolder = null;
  for (const note of notes) {
    const folder = folderOf(note);
    if (folder !== lastFolder) {
      const label = document.createElement("button");
      label.type = "button";
      label.className = "folder-group";
      label.dataset.folder = folder;
      label.setAttribute("aria-expanded", String(!collapsed.has(folder)));
      label.innerHTML = icon("chevronDown") + icon("folder");
      const name = document.createElement("span");
      name.textContent = folder || "Notebook";
      const count = document.createElement("small");
      count.textContent = String(counts.get(folder));
      label.append(name, count);
      label.onclick = () => {
        setCollapsed(folder, !collapsed.has(folder));
        renderList();
      };
      list.append(label);
      lastFolder = folder;
    }
    if (collapsed.has(folder)) continue;
    const button = document.createElement("button");
    button.className = "note-row";
    button.dataset.note = note.id;
    button.title = note.id;
    fillRow(button, note);
    button.onclick = () => openNote(note.id).catch(showError);
    button.dataset.folder = folder;
    button.draggable = true;
    button.ondragstart = (event) => {
      event.dataTransfer?.setData(noteType, note.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      // Without notes at the top level, offer it as a place to drop, at
      // the end so nothing moves under the pointer.
      if (!list.querySelector('.folder-group[data-folder=""]')) {
        const zone = document.createElement("div");
        zone.className = "folder-group drop-zone";
        zone.dataset.folder = "";
        zone.innerHTML = icon("folder");
        const name = document.createElement("span");
        name.textContent = "Top level, outside folders";
        zone.append(name);
        list.append(zone);
      }
    };
    list.append(button);
  }
}
// Dropping a note on a folder, or on a note in it, moves it there.
function setupDragging() {
  const list = $("note-list");
  const target = (event: DragEvent) =>
    event.dataTransfer?.types.includes(noteType) && event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-folder]") : null;
  const clear = () =>
    list.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  const end = () => {
    clear();
    list.querySelector(".drop-zone")?.remove();
  };
  list.addEventListener("dragover", (event) => {
    const over = target(event);
    if (!over) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    clear();
    list.querySelector(`.folder-group[data-folder="${CSS.escape(over.dataset.folder || "")}"]`)?.classList.add("drop-target");
  });
  list.addEventListener("dragleave", (event) => {
    if (!(event.relatedTarget instanceof Node) || !list.contains(event.relatedTarget)) clear();
  });
  list.addEventListener("dragend", end);
  list.addEventListener("drop", (event) => {
    const over = target(event);
    end();
    if (!over) return;
    event.preventDefault();
    moveNote(event.dataTransfer?.getData(noteType) || "", over.dataset.folder || "").catch(showError);
  });
}
function updateBacklinks() {
  const note = state.notes.find((n) => n.id === state.current?.id);
  state.currentBacklinks = state.current?.backlinks || note?.backlinks || [];
  $("backlinks-count").textContent = String(state.currentBacklinks.length);
  $("backlinks-label").textContent =
    state.currentBacklinks.length === 1 ? "backlink" : "backlinks";
  $("backlinks-button").disabled = !state.current;
}

export {
  excerpt,
  filterTag,
  renderList,
  revealNote,
  setupDragging,
  shortDate,
  updateBacklinks,
  visibleNotes,
};
