import { icon } from "./icons.js";
// One menu keeps commands discoverable without a row of document menus.
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
import { findNotes, navigate, toggleFocus } from "./shortcuts.js";
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
const sections: Record<string, string> = { "Notes and files…": "file", "Editing…": "edit", "View options…": "view", "Insert…": "insert" };
const menus: Record<string, MenuEntry[]> = {
  workspace: [
    ["New note", "Ctrl N", newNoteDialog],
    ["Today's note", "Alt J", () => dailyNote().catch(showError)],
    ["Search", "Ctrl Shift E", findNotes],
    ["Commands…", "Ctrl K", () => paletteDialog(">")],
    "-",
    ["Notes and files…", "", () => openMenu("file")],
    ["Editing…", "", () => openMenu("edit")],
    ["View options…", "", () => openMenu("view")],
    ["Insert…", "", () => openMenu("insert")],
    "-",
    ["Settings…", "Ctrl Shift T", () => settingsDialog()],
    ["Keyboard shortcuts", "F1", helpDialog],
  ],
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
    ["Previous note", "Alt ↑", () => navigate(-1), () => state.notes.length > 0],
    ["Next note", "Alt ↓", () => navigate(1), () => state.notes.length > 0],
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
  const button = $("menu-bar").querySelector<HTMLButtonElement>('[data-menu="workspace"]');
  button?.setAttribute("aria-expanded", "false");
  $("menu-popup").hidden = true;
  openName = "";
  if (refocus) button?.focus();
}

function openMenu(name: string, focusItem = 0) {
  closeMenu();
  const button = $("menu-bar").querySelector<HTMLButtonElement>('[data-menu="workspace"]');
  if (!button || !menus[name]) return;
  const popup = $("menu-popup");
  popup.replaceChildren();
  const entries: MenuEntry[] = name === "workspace" ? menus[name] : [["Back to menu", "←", () => openMenu("workspace")], "-", ...menus[name]];
  for (const entry of entries) {
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
    if (name === "workspace" && sections[label]) {
      item.dataset.submenu = sections[label];
      item.setAttribute("aria-haspopup", "menu");
    }
    const text = document.createElement("span");
    text.textContent = label;
    item.append(text);
    if (item.dataset.submenu) {
      const arrow = document.createElement("span");
      arrow.className = "menu-chevron";
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML = icon("chevronDown");
      item.append(arrow);
    }
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
  const rail = document.querySelector(".activity-rail")?.getBoundingClientRect();
  popup.style.top = Math.max(8, Math.min(box.top, innerHeight - popup.offsetHeight - 8)) + "px";
  popup.style.left = Math.max(8, Math.min(rail ? rail.right + 8 : box.left, innerWidth - popup.offsetWidth - 8)) + "px";
  popup.setAttribute("aria-label", name === "workspace" ? "Menu" : ({file:"Notes and files", edit:"Editing", view:"View options", insert:"Insert"}[name] || name));
  button.setAttribute("aria-expanded", "true");
  openName = name;
  const items = [...popup.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
  items.at(focusItem)?.focus();
}

function setupMenus() {
  const bar = $("menu-bar");
  for (const button of bar.querySelectorAll<HTMLButtonElement>("[data-menu]")) {
    button.onclick = () =>
      openName ? closeMenu() : openMenu(button.dataset.menu || "");
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
    else if (event.key === "ArrowLeft" && openName !== "workspace") {
      openMenu("workspace");
    } else if (event.key === "ArrowRight") {
      const next = items[index]?.dataset.submenu;
      if (next) openMenu(next);
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
