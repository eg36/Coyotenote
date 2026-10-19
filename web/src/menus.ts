// The menu row under the note title: File, Edit, View and Insert hold the
// app's commands with their shortcuts, as a document editor's menus do.
import { $, showError, state } from "./core.js";
import { chooseImages } from "./attachments.js";
import { historyDialog } from "./history.js";
import { findInNote, save, setMode } from "./editor.js";
import {
  deleteDialog,
  helpDialog,
  linkDialog,
  newNoteDialog,
  renameDialog,
  trashDialog,
} from "./dialogs.js";
import { findNotes, toggleFocus } from "./shortcuts.js";
import { paletteDialog } from "./palette.js";
import { toggleOutline } from "./outline.js";
import { dailyNote } from "./daily.js";
import { settingsDialog } from "./settings.js";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const keys = (text: string) => (mac ? text.replace(/^Ctrl /, "⌘").replace(/^Alt /, "⌥") : text);
const note = () => Boolean(state.current) && !state.pendingDraft;
const writing = () => note() && state.mode === "write";
const rich = (name: string) => () => state.rich?.command(name);

// Each item is [label, shortcut, action, when it is available]; "-" separates.
type MenuEntry = "-" | [label: string, shortcut: string, run: () => unknown, when?: () => boolean];
const menus: Record<string, MenuEntry[]> = {
  file: [
    ["New note", "Ctrl N", newNoteDialog],
    ["Today's note", "Alt J", () => dailyNote().catch(showError)],
    ["Quick open", "Ctrl K", () => paletteDialog()],
    "-",
    ["Rename or move…", "Ctrl Shift R", renameDialog, note],
    ["Note history", "", () => historyDialog().catch(showError), note],
    ["Download as Markdown", "", () => $("export-note").click(), note],
    "-",
    ["Move to trash", "Ctrl Shift D", deleteDialog, note],
    ["Open the trash", "", () => trashDialog().catch(showError)],
  ],
  edit: [
    ["Undo", "Ctrl Z", rich("undo"), writing],
    ["Redo", "Ctrl Shift Z", rich("redo"), writing],
    "-",
    ["Save now", "Ctrl S", () => save().catch(showError), note],
    ["Find and replace…", "", () => findInNote().catch(showError), note],
    ["Search all notes", "Ctrl Shift E", findNotes],
  ],
  view: [
    ["Write", "", () => setMode("write").catch(showError), note],
    ["Markdown", "", () => setMode("source").catch(showError), note],
    ["Preview", "", () => setMode("preview").catch(showError), note],
    ["Split", "", () => setMode("split").catch(showError), note],
    "-",
    ["Notes sidebar", "", () => $("sidebar-toggle").click()],
    ["Outline", "Alt O", () => toggleOutline(), note],
    ["Focus mode", "Ctrl Shift F", toggleFocus],
    "-",
    ["Settings…", "Ctrl Shift T", () => settingsDialog()],
    ["Keyboard shortcuts", "F1", helpDialog],
  ],
  insert: [
    ["Link…", "", () => linkDialog(), note],
    ["Link to a note…", "", () => linkDialog(true), note],
    ["Image…", "", chooseImages, note],
    "-",
    ["Table", "", rich("table"), writing],
    ["Checklist", "", rich("taskList"), writing],
    ["Quote", "", rich("blockquote"), writing],
  ],
};

let openName = "";
function closeMenu(refocus = false) {
  if (!openName) return;
  const button = $("menu-bar").querySelector<HTMLButtonElement>(`[data-menu="${openName}"]`);
  button?.setAttribute("aria-expanded", "false");
  $("menu-popup").hidden = true;
  openName = "";
  if (refocus) button?.focus();
}

function openMenu(name: string, focusItem = 0) {
  closeMenu();
  const button = $("menu-bar").querySelector<HTMLButtonElement>(`[data-menu="${name}"]`);
  if (!button || !menus[name]) return;
  const popup = $("menu-popup");
  popup.replaceChildren();
  for (const entry of menus[name]) {
    if (entry === "-") {
      const line = document.createElement("div");
      line.className = "menu-separator";
      line.setAttribute("role", "separator");
      popup.append(line);
      continue;
    }
    const [label, shortcut, run, when] = entry;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.setAttribute("role", "menuitem");
    item.disabled = when ? !when() : false;
    const text = document.createElement("span");
    text.textContent = label;
    item.append(text);
    if (shortcut) {
      const kbd = document.createElement("kbd");
      kbd.textContent = keys(shortcut);
      item.append(kbd);
    }
    item.onclick = () => {
      closeMenu();
      run();
    };
    popup.append(item);
  }
  const box = button.getBoundingClientRect();
  popup.hidden = false;
  popup.style.top = box.bottom + 4 + "px";
  popup.style.left = Math.min(box.left, innerWidth - popup.offsetWidth - 8) + "px";
  popup.setAttribute("aria-label", button.textContent || "");
  button.setAttribute("aria-expanded", "true");
  openName = name;
  const items = [...popup.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
  items.at(focusItem)?.focus();
}

function setupMenus() {
  const bar = $("menu-bar");
  const names = Object.keys(menus);
  for (const button of bar.querySelectorAll<HTMLButtonElement>("[data-menu]")) {
    button.onclick = () =>
      openName === button.dataset.menu ? closeMenu() : openMenu(button.dataset.menu || "");
    // Once a menu is open, pointing at another one switches to it.
    button.onmouseenter = () => {
      if (openName && openName !== button.dataset.menu) openMenu(button.dataset.menu || "");
    };
    button.onkeydown = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openMenu(button.dataset.menu || "");
      }
    };
  }
  $("menu-popup").onkeydown = (event) => {
    const items = [...$("menu-popup").querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
    const index = items.findIndex((item) => item === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step) items[(index + step + items.length) % items.length]?.focus();
    else if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items.at(-1)?.focus();
    else if (event.key === "Escape") closeMenu(true);
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const next = names[(names.indexOf(openName) + (event.key === "ArrowRight" ? 1 : -1) + names.length) % names.length];
      openMenu(next);
    } else if (event.key === "Tab") closeMenu();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("mousedown", (event) => {
    if (openName && !(event.target instanceof Element && event.target.closest("#menu-popup, #menu-bar"))) closeMenu();
  });
  addEventListener("resize", () => closeMenu());
}

export { setupMenus };
