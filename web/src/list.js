// The sidebar note list: ordering, excerpts and search highlights.
import { icon } from "./icons.js";
import { $, showError, state } from "./core.js";
import { openNote } from "./editor.js";

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
function visibleNotes() {
  const notes = state.filteredIds
    ? state.notes.filter((note) => state.filteredIds.has(note.id))
    : [...state.notes];
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
function renderList() {
  const notes = visibleNotes();
  const list = $("note-list");
  list.replaceChildren();
  $("note-count").textContent = notes.length;
  if (!notes.length) {
    const el = document.createElement("p");
    el.className = "list-empty";
    el.textContent = state.search
      ? "No matching notes. Try a different word."
      : "No notes yet.";
    list.append(el);
    return;
  }
  list.classList.toggle("searching", Boolean(state.filteredIds));
  let lastFolder = null;
  for (const note of notes) {
    const parts = note.id.split("/");
    parts.pop();
    const folder = parts.join("/");
    if (folder !== lastFolder) {
      const label = document.createElement("div");
      label.className = "folder-group";
      label.innerHTML = icon("folder");
      const name = document.createElement("span");
      name.textContent = folder || "Notebook";
      label.append(name);
      list.append(label);
      lastFolder = folder;
    }
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
    list.append(button);
  }
}
function updateBacklinks() {
  const note = state.notes.find((n) => n.id === state.current?.id);
  state.currentBacklinks = state.current?.backlinks || note?.backlinks || [];
  $("backlinks-count").textContent = state.currentBacklinks.length;
  $("backlinks-label").textContent =
    state.currentBacklinks.length === 1 ? "backlink" : "backlinks";
  $("backlinks-button").disabled = !state.current;
}

export { excerpt, renderList, shortDate, updateBacklinks, visibleNotes };
