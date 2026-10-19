// The sidebar note list: ordering, excerpts and search highlights.
import { icon } from "./icons.js";
import { $, showError, state, storage } from "./core.js";
import { openNote } from "./editor.js";
import { moveNote } from "./dialogs.js";

// excerpt cleans a note's opening text for the list, leaving out a leading
// heading that only repeats the note's title.
function excerpt(text, title = "") {
  const plain = text
    .replace(/^#+\s*/, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[*`_]/g, "");
  return title && plain.toLowerCase().startsWith(title.toLowerCase() + " ")
    ? plain.slice(title.length + 1)
    : plain;
}
// shortDate names the day a note changed, adding the year only when it is
// not the current one.
function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const options = { month: "short", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return date.toLocaleDateString(undefined, options);
}
const noteCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
// hasTag reports whether note carries tag, ignoring letter case.
const hasTag = (note, tag) =>
  note.tags?.some((t) => t.toLowerCase() === tag.toLowerCase());
function visibleNotes() {
  const notes = state.notes.filter(
    (note) =>
      (!state.filteredIds || state.filteredIds.has(note.id)) &&
      (!state.tag || hasTag(note, state.tag)),
  );
  const folder = (note) => note.id.slice(0, Math.max(0, note.id.lastIndexOf("/")));
  const title = (note) => note.title.split("/").pop();
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
function highlight(element, text, query) {
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
    return new Set(JSON.parse(storage.get(collapsedKey()) || "[]"));
  } catch {
    return new Set();
  }
}
function setCollapsed(folder, collapsed) {
  const folders = collapsedFolders();
  if (collapsed === folders.has(folder)) return;
  if (collapsed) folders.add(folder);
  else folders.delete(folder);
  storage.set(collapsedKey(), JSON.stringify([...folders]));
}
// revealNote expands the folder holding id, so the open note is listed.
function revealNote(id) {
  setCollapsed(id.split("/").slice(0, -1).join("/"), false);
}
const noteType = "application/x-coyote-note";
// renderTags offers the vault's tags, with how many notes carry each, as a
// filter for the list. It hides while the vault has no tags.
function renderTags() {
  const counts = new Map();
  for (const note of state.notes)
    for (const tag of note.tags || []) {
      const key = tag.toLowerCase();
      counts.set(key, { tag: counts.get(key)?.tag || tag, n: (counts.get(key)?.n || 0) + 1 });
    }
  const select = $("tag-filter");
  if (state.tag && !counts.has(state.tag.toLowerCase())) state.tag = "";
  select.hidden = counts.size === 0;
  const options = [...counts.values()]
    .sort((a, b) => noteCollator.compare(a.tag, b.tag))
    .map(({ tag, n }) => [`#${tag} · ${n}`, tag]);
  // Rebuilding the menu while it is open would close it, so only on change.
  const signature = JSON.stringify(options);
  if (select.dataset.signature !== signature) {
    select.dataset.signature = signature;
    select.replaceChildren(new Option("All tags", ""));
    for (const [label, tag] of options) select.append(new Option(label, tag));
  }
  select.value = state.tag
    ? [...select.options].find((o) => o.value.toLowerCase() === state.tag.toLowerCase())?.value || ""
    : "";
  select.classList.toggle("active", Boolean(state.tag));
}
// filterTag shows only notes with tag, or every note for "".
function filterTag(tag) {
  state.tag = tag;
  renderTags();
  renderList();
  if (tag) $("app").classList.add("sidebar-open");
}
function renderList() {
  renderTags();
  const notes = visibleNotes();
  const list = $("note-list");
  list.replaceChildren();
  $("note-count").textContent = notes.length;
  if (!notes.length) {
    const el = document.createElement("p");
    el.className = "list-empty";
    el.textContent = state.search
      ? "No matching notes. Try a different word."
      : state.tag
        ? "No notes with this tag."
        : "No notes yet.";
    list.append(el);
    return;
  }
  list.classList.toggle("searching", Boolean(state.filteredIds));
  const collapsed = state.filteredIds || state.tag ? new Set() : collapsedFolders();
  const folderOf = (note) => note.id.split("/").slice(0, -1).join("/");
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
      count.textContent = notes.filter((n) => folderOf(n) === folder).length;
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
    button.className =
      "note-row" + (state.current?.id === note.id ? " selected" : "");
    button.dataset.note = note.id;
    button.title = note.id;
    button.setAttribute(
      "aria-current",
      state.current?.id === note.id ? "page" : "false",
    );
    const head = document.createElement("span");
    head.className = "note-row-head";
    const label = document.createElement("span");
    label.className = "note-title";
    label.textContent = note.title.split("/").pop();
    const date = document.createElement("time");
    date.className = "note-date";
    date.textContent = shortDate(note.modified);
    head.append(label, date);
    button.append(head);
    const text = document.createElement("span");
    text.className = "note-excerpt";
    const found = state.filteredIds && state.snippets?.[note.id];
    if (found) highlight(text, found, state.searched);
    else
      text.textContent =
        excerpt(note.excerpt, label.textContent) || "Empty note";
    button.append(text);
    button.onclick = () => openNote(note.id).catch(showError);
    button.dataset.folder = folder;
    button.draggable = true;
    button.ondragstart = (event) => {
      event.dataTransfer.setData(noteType, note.id);
      event.dataTransfer.effectAllowed = "move";
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
  const target = (event) =>
    event.dataTransfer?.types.includes(noteType) &&
    event.target.closest("[data-folder]");
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
    event.dataTransfer.dropEffect = "move";
    clear();
    list.querySelector(`.folder-group[data-folder="${CSS.escape(over.dataset.folder)}"]`)?.classList.add("drop-target");
  });
  list.addEventListener("dragleave", (event) => {
    if (!list.contains(event.relatedTarget)) clear();
  });
  list.addEventListener("dragend", end);
  list.addEventListener("drop", (event) => {
    const over = target(event);
    end();
    if (!over) return;
    event.preventDefault();
    moveNote(event.dataTransfer.getData(noteType), over.dataset.folder).catch(showError);
  });
}
function updateBacklinks() {
  const note = state.notes.find((n) => n.id === state.current?.id);
  state.currentBacklinks = state.current?.backlinks || note?.backlinks || [];
  $("backlinks-count").textContent = state.currentBacklinks.length;
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
