// The quick switcher: jump to a note, a heading of the open note or a command
// by typing a few letters of it.
import { icon } from "./icons.js";
import { $, showError, state } from "./core.js";
import { draftsDialog } from "./drafts.js";
import { chooseImages } from "./attachments.js";
import { historyDialog } from "./history.js";
import { splitFrontMatter } from "./frontmatter.js";
import { shortDate } from "./list.js";
import {
  createNote,
  editProperties,
  openNote,
  refresh,
  save,
  setMode,
} from "./editor.js";
import {
  backlinksDialog,
  closeModal,
  deleteDialog,
  helpDialog,
  newNoteDialog,
  openModal,
  renameDialog,
  themeDialog,
  trashDialog,
} from "./dialogs.js";
import { headings, jumpToHeading, toggleOutline } from "./outline.js";
import { findNotes, toggleFocus } from "./shortcuts.js";

// fuzzyMatch finds the letters of query in text, in order, and scores the
// match: word starts and runs of consecutive letters count for more, and
// shorter texts win ties. It returns null when a letter is missing.
function fuzzyMatch(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, at: [] };
  const lower = text.toLowerCase();
  const at = [];
  let score = 0,
    from = 0;
  for (const letter of q) {
    let index = lower.indexOf(letter, from);
    // Prefer this letter at the start of a later word.
    for (let next = index; next >= 0; next = lower.indexOf(letter, next + 1))
      if (next === 0 || /[\s/_\-.]/.test(lower[next - 1])) {
        if (next - index < 12) index = next;
        break;
      }
    if (index < 0) return null;
    const start = index === 0 || /[\s/_\-.]/.test(lower[index - 1]);
    score += start ? 8 : 1;
    if (at.length && at.at(-1) === index - 1) score += 5;
    at.push(index);
    from = index + 1;
  }
  return { score: score - text.length / 100, at };
}

// marked fills element with text, marking the matched letters.
function marked(element, text, at) {
  const hits = new Set(at);
  let run = "";
  const flush = (mark) => {
    if (!run) return;
    if (mark) {
      const m = document.createElement("mark");
      m.textContent = run;
      element.append(m);
    } else element.append(run);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    if (i > 0 && hit !== hits.has(i - 1)) flush(!hit);
    run += text[i];
  }
  flush(hits.has(text.length - 1));
}

// addProperties starts front matter with a tags field, ready to fill in.
function addProperties() {
  editProperties("tags: ");
  if (state.mode === "write") {
    const box = $("properties-text");
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

// Commands name what they do; those needing an open note hide without one.
const commands = [
  ["New note", "Ctrl N", newNoteDialog],
  ["Rename or move note", "Ctrl Shift R", renameDialog, true],
  ["Move note to trash", "Ctrl Shift D", deleteDialog, true],
  ["Save now", "Ctrl S", () => save().catch(showError), true],
  ["Show notes linking here", "", backlinksDialog, true],
  ["Insert image", "", chooseImages, true],
  ["Add properties (front matter)", "", addProperties, true, () => !splitFrontMatter(state.body)],
  ["Show note history", "", () => historyDialog().catch(showError), true],
  ["Download note as Markdown", "", () => $("export-note").click(), true],
  ["Write view", "", () => setMode("write").catch(showError), true],
  ["Markdown view", "", () => setMode("source").catch(showError), true],
  ["Preview view", "", () => setMode("preview").catch(showError), true],
  ["Split view", "", () => setMode("split").catch(showError), true],
  ["Toggle focus mode", "Ctrl Shift F", toggleFocus],
  ["Show or hide outline", "Alt O", () => toggleOutline(), true],
  ["Choose a theme", "Ctrl Shift T", themeDialog],
  ["Open the trash", "", () => trashDialog().catch(showError)],
  ["Review unsaved drafts", "", draftsDialog, false, () => state.orphans?.length],
  ["Keyboard shortcuts", "F1", helpDialog],
].map(([label, keys, run, needsNote = false, when]) => ({
  label,
  keys: /Mac|iPhone|iPad/.test(navigator.platform)
    ? keys.replace(/^Ctrl /, "⌘")
    : keys,
  run,
  when: () => (!needsNote || state.current) && (!when || when()),
}));

function paletteDialog(prefix = "") {
  const container = document.createElement("div");
  const input = document.createElement("input");
  input.placeholder = "Go to a note, # heading or > command";
  input.setAttribute("aria-label", "Search notes, headings and commands");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "palette-list");
  input.autocomplete = "off";
  input.value = prefix;
  const list = document.createElement("div");
  list.id = "palette-list";
  list.className = "palette-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Results");
  const empty = document.createElement("p");
  empty.className = "theme-empty";
  empty.setAttribute("role", "status");
  const hints = document.createElement("p");
  hints.className = "theme-key-hints";
  hints.textContent = "↑↓ choose · Enter open · # headings · > commands · Esc close";
  let items = [],
    active = 0;

  function results() {
    const raw = input.value;
    const mode = raw.startsWith(">") ? "command" : raw.startsWith("#") ? "heading" : "all";
    const query = mode === "all" ? raw.trim() : raw.slice(1).trim();
    const found = [];
    if (mode === "heading") {
      const list = headings(state.current ? state.body : "");
      for (const [index, heading] of list.entries()) {
        const match = fuzzyMatch(query, heading.text);
        if (match)
          found.push({
            kind: "heading",
            label: heading.text,
            detail: "H" + heading.level,
            match,
            run: () => jumpToHeading(index),
          });
      }
      return query ? found.sort((a, b) => b.match.score - a.match.score) : found;
    }
    if (mode === "all") {
      const notes = [...state.notes].sort(
        (a, b) => (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0),
      );
      for (const note of notes) {
        const match = fuzzyMatch(query, note.title);
        if (match)
          found.push({
            kind: "note",
            label: note.title,
            detail: shortDate(note.modified),
            match,
            current: note.id === state.current?.id,
            id: note.id,
          });
      }
    }
    for (const command of commands) {
      if (!command.when()) continue;
      const match = fuzzyMatch(query, command.label);
      if (match && (mode === "command" || query))
        found.push({ kind: "command", label: command.label, detail: command.keys || "", match, run: command.run });
    }
    if (!query) return found.slice(0, 60);
    const ranked = found.sort((a, b) => b.match.score - a.match.score).slice(0, 60);
    if (mode === "all") {
      // What was typed can always become a search or a new note.
      ranked.push({
        kind: "command",
        label: `Search note contents for “${query}”`,
        detail: "",
        match: { at: [] },
        run: () => {
          $("search").value = query;
          state.search = query;
          refresh().catch(showError);
          findNotes();
        },
      });
      if (!state.notes.some((note) => note.id.toLowerCase() === query.toLowerCase()))
        ranked.push({
          kind: "command",
          label: `Create note “${query}”`,
          detail: "",
          match: { at: [] },
          run: () => createNote(query).catch(showError),
        });
    }
    return ranked;
  }

  function activate(index, scroll = true) {
    active = index;
    for (const [i, option] of [...list.children].entries()) {
      option.classList.toggle("chosen", i === active);
      option.setAttribute("aria-selected", String(i === active));
    }
    const option = list.children[active];
    if (option) {
      input.setAttribute("aria-activedescendant", option.id);
      if (scroll) option.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function choose(item) {
    if (!item) return;
    closeModal();
    if (item.kind === "note") openNote(item.id).catch(showError);
    else item.run();
  }

  function render() {
    items = results();
    list.replaceChildren();
    for (const [index, item] of items.entries()) {
      const option = document.createElement("div");
      option.className = "palette-option" + (item.current ? " current" : "");
      option.id = "palette-option-" + index;
      option.setAttribute("role", "option");
      option.innerHTML = icon(item.kind === "note" ? "file" : item.kind === "heading" ? "hash" : "command");
      const label = document.createElement("span");
      label.className = "palette-label";
      marked(label, item.label, item.match.at);
      const detail = document.createElement(item.kind === "command" ? "kbd" : "small");
      detail.textContent = item.detail;
      option.append(label);
      if (item.detail) option.append(detail);
      option.onmousemove = () => active !== index && activate(index, false);
      option.onclick = () => choose(item);
      list.append(option);
    }
    empty.hidden = items.length > 0;
    empty.textContent = input.value.startsWith("#") && !state.current
      ? "Open a note to jump to its headings."
      : "Nothing matches. Try fewer letters.";
    activate(0);
  }

  input.oninput = render;
  input.onkeydown = (event) => {
    if (event.isComposing) return;
    const moves = { ArrowDown: active + 1, ArrowUp: active - 1, PageDown: active + 8, PageUp: active - 8 };
    if (event.key in moves) {
      event.preventDefault();
      if (items.length) activate(Math.max(0, Math.min(items.length - 1, moves[event.key])));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[active]);
    }
  };
  container.append(input, list, empty, hints);
  openModal("Quick open", container, null, { className: "palette", hideFooter: true });
  render();
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
}

export { paletteDialog };
