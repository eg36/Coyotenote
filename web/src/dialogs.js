// The modal dialog and the dialogs built on it, including themes and trash.
import { icon } from "./icons.js";
import { $, showError, showToast, state, storage } from "./core.js";
import { api } from "./api.js";
import { draftKey } from "./drafts.js";
import { excerpt, shortDate, visibleNotes } from "./list.js";
import {
  applyEditability,
  createNote,
  emptyNotebook,
  focusEditor,
  openNote,
  refresh,
  save,
} from "./editor.js";
import { shortcuts } from "./shortcuts.js";

let modalAction = null,
  modalBusy = 0,
  themeOriginal = null;
function applyTheme(id) {
  const theme = state.themes.find((t) => t.id === id) || state.themes[0];
  if (!theme) return;
  state.theme = theme.id;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.light ? "light" : "dark";
  for (const [role, color] of Object.entries(theme.colors))
    root.style.setProperty("--" + role, color);
  $("theme-name").textContent = theme.name;
}
async function chooseTheme(id) {
  await api("/api/settings", "POST", { theme: id });
  applyTheme(id);
  showToast(
    `${state.themes.find((t) => t.id === id)?.name} · made for this mood`,
  );
}
function openModal(
  title,
  content,
  action,
  { submit = "Continue", hideFooter = false, className = "" } = {},
) {
  $("modal").className = className;
  $("modal-title").textContent = title;
  $("modal-content").replaceChildren(content);
  $("modal-error").textContent = "";
  $("modal-submit").textContent = submit;
  $("modal-footer").hidden = hideFooter;
  modalAction = action;
  $("modal").showModal();
  setTimeout(
    () =>
      (
        $("modal-content").querySelector("input,button,select") ||
        $("modal-close")
      ).focus(),
    30,
  );
}
// A dialog stays open while its action runs, so nothing can be edited or
// opened between the request and the screen catching up with it.
function busyModal(busy) {
  modalBusy += busy ? 1 : -1;
  for (const id of ["modal-submit", "modal-cancel", "modal-close"])
    $(id).disabled = modalBusy > 0;
}
function modalIsBusy() {
  return modalBusy > 0;
}
function dismissModal() {
  if (!modalBusy) closeModal();
}
function closeModal() {
  if (themeOriginal) {
    applyTheme(themeOriginal);
    themeOriginal = null;
  }
  $("modal").close();
  modalAction = null;
  focusEditor();
}
function inputDialog(title, label, value, action, options = {}) {
  const container = document.createElement("div");
  const text = document.createElement("label");
  text.className = "field-label";
  text.textContent = label;
  const input = document.createElement("input");
  input.id = "dialog-input";
  input.type = "text";
  input.value = value;
  input.autocomplete = "off";
  input.required = options.required ?? true;
  input.maxLength = 220;
  text.htmlFor = input.id;
  container.append(text, input);
  if (options.description) {
    const description = document.createElement("p");
    description.className = "dialog-description";
    description.textContent = options.description;
    container.append(description);
  }
  openModal(title, container, () => action(input.value.trim()), options);
  setTimeout(() => input.select(), 50);
}
function newNoteDialog() {
  const container = document.createElement("div");
  const label = document.createElement("label");
  label.className = "field-label";
  label.htmlFor = "dialog-input";
  label.textContent = "Name your note";
  const input = document.createElement("input");
  input.id = "dialog-input";
  input.autocomplete = "off";
  input.maxLength = 220;
  input.placeholder = "Untitled";
  const description = document.createElement("p");
  description.className = "dialog-description";
  description.textContent = "Use Folder/Name to keep related notes together. An empty name becomes Untitled.";
  const templateLabel = document.createElement("label");
  templateLabel.className = "field-label";
  templateLabel.htmlFor = "note-template";
  templateLabel.textContent = "Start with";
  const select = document.createElement("select");
  select.id = "note-template";
  select.add(new Option("Blank note", ""));
  for (const note of state.notes.filter((n) => n.id.startsWith("Templates/")).sort((a, b) => a.id.localeCompare(b.id)))
    select.add(new Option(note.id.slice("Templates/".length), note.id));
  const hint = document.createElement("p");
  hint.className = "dialog-description field-hint";
  hint.textContent = "Notes in Templates/ appear here as reusable starting points.";
  container.append(label, input, description, templateLabel, select, hint);
  openModal("New note", container, async () => {
    // Save before reading: the selected template might be the note being edited.
    await save();
    const template = select.value ? await api("/api/note?id=" + encodeURIComponent(select.value)) : null;
    await createNote(input.value.trim(), template?.body || "");
  }, { submit: "Create note" });
}
function renameDialog() {
  if (!state.current) return;
  inputDialog(
    "Rename note",
    "Note path",
    state.current.id,
    async (name) => {
      await save();
      const result = await api("/api/rename", "POST", {
        id: state.current.id,
        name,
        revision: state.current.revision,
      });
      await refresh();
      await openNote(result.note.id, { skipSave: true });
      if (result.warnings.length)
        showToast(result.warnings.join(" · "), { persistent: true });
    },
    {
      submit: "Rename note",
      description:
        "Use a folder path to move this note. Wiki links pointing here are updated.",
    },
  );
}
// moveNote moves note id into folder ("" is the vault's top level), keeping
// its name. Editing pauses meanwhile, as links in other notes, perhaps the
// open one, are rewritten to follow it.
async function moveNote(id, folder) {
  const name = (folder ? folder + "/" : "") + id.split("/").pop();
  const entry = state.notes.find((note) => note.id === id);
  if (!entry || name === id) return;
  await save();
  state.busy = true;
  applyEditability();
  try {
    const moving = state.current?.id === id;
    const result = await api("/api/rename", "POST", {
      id,
      name,
      revision: moving ? state.current.revision : entry.revision,
    });
    await refresh();
    const open = state.current && state.notes.find((n) => n.id === state.current.id);
    if (moving) await openNote(result.note.id, { skipSave: true, pushBack: false });
    else if (open && open.revision !== state.current.revision && !state.dirty)
      await openNote(open.id, { skipSave: true, pushBack: false });
    showToast(
      [`Moved “${name.split("/").pop()}” to ${folder || "the top of the vault"}.`, ...result.warnings].join(" · "),
      { persistent: result.warnings.length > 0 },
    );
  } finally {
    state.busy = false;
    applyEditability();
  }
}
function deleteDialog() {
  if (!state.current) return;
  const content = document.createElement("p");
  content.className = "dialog-description";
  content.textContent = `Move “${state.current.id}” to the vault’s trash? You can undo this during the current session.`;
  openModal(
    "Move note to trash?",
    content,
    async () => {
      await save();
      const id = state.current.id,
        key = draftKey();
      const { trashId, warning } = await api("/api/note", "DELETE", {
        id,
        revision: state.current.revision,
      });
      state.trash.push({ id, trashId });
      // Edits that never reached the file stay recoverable as a draft.
      if (state.current?.id !== id || !state.dirty) storage.remove(key);
      await refresh();
      const next = visibleNotes()[0] || state.notes[0];
      if (next) await openNote(next.id, { skipSave: true });
      else emptyNotebook();
      showToast(["Note moved to trash.", warning].filter(Boolean).join(" "), {
        undo: true,
      });
    },
    { submit: "Move to trash" },
  );
}
async function undoTrash() {
  const trashed = state.trash.at(-1);
  if (!trashed) return;
  await save();
  const note = await api("/api/restore", "POST", {
    id: trashed.trashId,
    name: trashed.id,
  });
  state.trash.pop();
  await refresh();
  // The open note is still there, so edits typed meanwhile are saved first.
  await openNote(note.id);
  showToast(["Note restored.", note.warning].filter(Boolean).join(" "));
}
async function trashDialog() {
  const { notes } = await api("/api/trash");
  const container = document.createElement("div");
  container.className = "link-list trash-list";
  if (!notes.length) {
    const text = document.createElement("p");
    text.className = "dialog-description";
    text.textContent =
      "The trash is empty. Notes you move to the trash wait here until you restore them.";
    container.append(text);
  }
  for (const note of notes) {
    const row = document.createElement("div");
    row.className = "trash-row";
    const label = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = note.id;
    const detail = document.createElement("small");
    const edited = shortDate(note.modified);
    detail.textContent = [
      edited && "Last edited " + edited,
      excerpt(note.excerpt),
    ]
      .filter(Boolean)
      .join(" · ");
    label.append(name, detail);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore";
    restore.setAttribute("aria-label", "Restore " + note.id);
    restore.onclick = async () => {
      restore.disabled = true;
      busyModal(true);
      try {
        await save();
        const restored = await api("/api/restore", "POST", { id: note.id });
        state.trash = state.trash.filter((item) => item.trashId !== note.id);
        await refresh();
        busyModal(false);
        closeModal();
        await openNote(restored.id);
        showToast(["Note restored.", restored.warning].filter(Boolean).join(" "));
      } catch (error) {
        if (modalBusy) busyModal(false);
        if ($("modal").open) {
          $("modal-error").textContent = error.message;
          restore.disabled = false;
        } else showError(error);
      }
    };
    row.append(label, restore);
    container.append(row);
  }
  if (notes.length) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "trash-empty";
    empty.textContent = "Delete all…";
    empty.onclick = () => emptyTrashDialog(notes.length);
    container.append(empty);
  }
  openModal("Trash", container, null, { hideFooter: true });
}
// emptyTrashDialog confirms deleting every trashed note for good.
function emptyTrashDialog(count) {
  const content = document.createElement("p");
  content.className = "dialog-description";
  const notes = count === 1 ? "1 note" : `${count} notes`;
  content.textContent = `This permanently deletes ${notes} in the trash and the history kept of them. It can't be undone.`;
  openModal(
    "Delete all notes in the trash?",
    content,
    async () => {
      const { deleted } = await api("/api/trash/empty", "POST", {});
      state.trash = [];
      $("undo-trash").hidden = true;
      showToast(deleted === 1 ? "Deleted 1 note for good." : `Deleted ${deleted} notes for good.`);
    },
    { submit: `Delete ${notes}`, className: "danger" },
  );
}
function themeDialog() {
  themeOriginal = state.theme;
  const container = document.createElement("div");
  const search = document.createElement("input");
  search.placeholder = "Find a theme…";
  search.setAttribute("aria-label", "Find a theme");
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-expanded", "true");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-controls", "theme-list");
  const list = document.createElement("div");
  list.id = "theme-list";
  list.className = "theme-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Themes");
  const empty = document.createElement("p");
  empty.className = "theme-empty";
  empty.setAttribute("role", "status");
  empty.textContent = "No matching themes";
  let active = -1;
  let options = [];
  function activate(index, preview = true, scroll = true) {
    active = index;
    for (const [i, option] of options.entries()) {
      option.classList.toggle("chosen", i === active);
      option.setAttribute("aria-selected", String(i === active));
    }
    const option = options[active];
    if (!option) {
      search.removeAttribute("aria-activedescendant");
      return;
    }
    search.setAttribute("aria-activedescendant", option.id);
    if (preview) applyTheme(option.dataset.themeId);
    if (scroll) option.scrollIntoView({ block: "nearest" });
  }
  function render(preview = false) {
    list.replaceChildren();
    options = [];
    for (const theme of state.themes.filter((t) =>
      t.name.toLowerCase().includes(search.value.trim().toLowerCase()),
    )) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "theme-option";
      button.id = "theme-option-" + theme.id;
      button.dataset.themeId = theme.id;
      button.tabIndex = -1;
      button.setAttribute("role", "option");
      const swatch = document.createElement("span");
      swatch.className = "theme-swatch";
      swatch.setAttribute("aria-hidden", "true");
      for (const color of [
        theme.colors.accent,
        theme.colors.pink,
        theme.colors.cyan,
        theme.colors.good,
      ]) {
        const dot = document.createElement("i");
        dot.style.background = color;
        swatch.append(dot);
      }
      const name = document.createElement("strong");
      name.textContent = theme.name;
      const type = document.createElement("small");
      type.textContent = theme.light ? "Light" : "Dark";
      button.append(swatch, name, type);
      const index = options.length;
      button.onmouseenter = () => activate(index, true, false);
      button.onfocus = () => activate(index);
      button.onclick = async () => {
        try {
          await chooseTheme(theme.id);
          themeOriginal = null;
          closeModal();
        } catch (error) {
          $("modal-error").textContent = error.message;
        }
      };
      options.push(button);
      list.append(button);
    }
    empty.hidden = options.length > 0;
    const selected = options.findIndex((option) => option.dataset.themeId === state.theme);
    activate(options.length ? Math.max(0, selected) : -1, preview);
  }
  search.oninput = () => render(true);
  container.onkeydown = (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        activate((active + step + options.length) % options.length);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      options[active]?.click();
    }
  };
  const searchRow = document.createElement("div");
  searchRow.className = "theme-search";
  searchRow.innerHTML = icon("chevronDown");
  searchRow.prepend(search);
  const hints = document.createElement("p");
  hints.className = "theme-key-hints";
  hints.textContent = "↑↓ preview · Enter select · Esc cancel";
  container.append(searchRow, list, empty, hints);
  openModal("Choose a theme", container, null, {
    className: "theme-picker",
    hideFooter: true,
  });
  render();
}
function linkDialog(wiki = false) {
  if (!state.current) return;
  if (wiki) {
    const container = document.createElement("div");
    const input = document.createElement("input");
    input.placeholder = "Search notes";
    input.setAttribute("aria-label", "Find a note to link");
    const list = document.createElement("div");
    list.className = "link-list";
    function render() {
      list.replaceChildren();
      for (const note of state.notes.filter((n) =>
        n.id.toLowerCase().includes(input.value.toLowerCase()),
      )) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = note.id;
        button.onclick = () => {
          if (state.mode === "write") state.rich.insertWiki(note.id);
          else state.source.insert(`[[${note.id}]]`);
          closeModal();
        };
        list.append(button);
      }
    }
    input.oninput = render;
    container.append(input, list);
    openModal("Link another note", container, null, { hideFooter: true });
    render();
    return;
  }
  inputDialog(
    "Insert link",
    "Web address",
    "https://",
    (url) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("Enter a full web address.");
      }
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol))
        throw new Error("Use an http, https or mailto link.");
      if (state.mode === "write") state.rich.command("link", url);
      else state.source.wrap("[", `](${url})`);
    },
    { submit: "Insert link" },
  );
}
async function followWiki(raw) {
  await save();
  const result = await api("/api/resolve", "POST", {
    id: state.current?.id || "",
    body: raw,
  });
  if (result.found) {
    await openNote(result.id, { heading: result.heading });
    return;
  }
  inputDialog(
    "This note doesn’t exist yet",
    "Note name",
    result.target,
    (name) => createNote(name),
    { submit: "Create linked note" },
  );
}
function backlinksDialog() {
  const container = document.createElement("div");
  container.className = "link-list";
  if (!state.currentBacklinks?.length) {
    const text = document.createElement("p");
    text.className = "dialog-description";
    text.textContent =
      "No notes link here yet. Add [[a note name]] in another note to connect them.";
    container.append(text);
  }
  for (const id of state.currentBacklinks || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = id;
    button.onclick = () => {
      closeModal();
      openNote(id).catch(showError);
    };
    container.append(button);
  }
  openModal("Notes linking here", container, null, { hideFooter: true });
}
function helpDialog() {
  const container = document.createElement("div");
  container.className = "help-grid";
  for (const [key, description] of shortcuts) {
    const k = document.createElement("kbd");
    k.textContent = key;
    const label = document.createElement("span");
    label.textContent = description;
    container.append(k, label);
  }
  const note = document.createElement("p");
  note.className = "help-note";
  note.textContent =
    "Browser shortcuts such as Ctrl+T, Ctrl+P, Ctrl+R and Ctrl+W stay with your browser. Use the Shift combinations above for the web app. Local app: " +
    (state.version || "dev");
  container.append(note);
  openModal("Keyboard shortcuts", container, null, { hideFooter: true });
}
$("modal-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!modalAction || modalBusy) return;
  busyModal(true);
  try {
    await modalAction();
    busyModal(false);
    closeModal();
  } catch (error) {
    busyModal(false);
    $("modal-error").textContent = error.message;
  }
};
$("modal-close").onclick = dismissModal;
$("modal-cancel").onclick = dismissModal;
$("modal").addEventListener("cancel", (event) => {
  event.preventDefault();
  dismissModal();
});
// Browsers close a dialog on a repeated Escape even when cancel is refused.
$("modal").addEventListener("close", () => {
  if (modalBusy) $("modal").showModal();
});
$("modal").onclick = (event) => {
  if (event.target === $("modal")) dismissModal();
};

export {
  applyTheme,
  backlinksDialog,
  busyModal,
  closeModal,
  deleteDialog,
  followWiki,
  helpDialog,
  linkDialog,
  modalIsBusy,
  moveNote,
  newNoteDialog,
  openModal,
  renameDialog,
  themeDialog,
  trashDialog,
  undoTrash,
};
