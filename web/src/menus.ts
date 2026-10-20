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
    ["Editing…", "", () => openMenu("edit"), note],
    ["View options…", "", () => openMenu("view")],
    ["Insert…", "", () => openMenu("insert"), note],
    "-",
    ["Settings…", "Ctrl Shift T", () => settingsDialog()],
    ["Keyboard shortcuts", "F1", helpDialog],
  ],
  file: [
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
let activeParent: HTMLButtonElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
const trigger = () => $("menu-bar").querySelector<HTMLButtonElement>("button")!;
const itemsIn = (element: HTMLElement) => [...element.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
const sectionLabel = (name: string) => ({file:"Notes and files", edit:"Editing", view:"View options", insert:"Insert"}[name] || "Menu");
function closeCategory(refocus = false) {
  clearTimeout(hoverTimer);
  $("menu-submenu").hidden = true;
  $("menu-popup").querySelector(".menu-inline")?.remove();
  const parent = activeParent;
  parent?.setAttribute("aria-expanded", "false");
  activeParent = null;
  if (refocus) parent?.focus();
}
function closeMenu(refocus = false) {
  closeCategory();
  $("menu-popup").hidden = true;
  trigger().setAttribute("aria-expanded", "false");
  openName = "";
  if (refocus) trigger().focus();
}
function buildMenu(container: HTMLElement, name: string) {
  container.replaceChildren();
  container.setAttribute("aria-label", sectionLabel(name));
  for (const entry of menus[name]) {
    if (entry === "-") {
      const line = document.createElement("div");
      line.className = "menu-separator";
      line.setAttribute("role", "separator");
      container.append(line);
      continue;
    }
    const [label, shortcut, run, when] = entry;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.setAttribute("role", "menuitem");
    button.disabled = when ? !when() : false;
    const text = document.createElement("span");
    text.textContent = label;
    button.append(text);
    const section = name === "workspace" ? sections[label] : undefined;
    if (section) {
      button.dataset.submenu = section;
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      const arrow = document.createElement("span");
      arrow.className = "menu-chevron";
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML = icon("chevronDown");
      button.append(arrow);
      button.onclick = () => {
        if (activeParent === button && innerWidth < 640) closeCategory(true);
        else openCategory(section, button, true);
      };
    } else {
      if (shortcut) {
        const kbd = document.createElement("kbd");
        kbd.textContent = keys(shortcut);
        button.append(kbd);
      }
      button.onclick = () => { closeMenu(); run(); };
    }
    if (name === "workspace") button.onmouseenter = () => {
      clearTimeout(hoverTimer);
      if (innerWidth < 640 || button.disabled) return;
      hoverTimer = setTimeout(() => {
        if (section) openCategory(section, button, false);
        else closeCategory();
      }, 120);
    };
    container.append(button);
  }
}
function openCategory(name: string, parent: HTMLButtonElement, focus: boolean) {
  closeCategory();
  activeParent = parent;
  parent.setAttribute("aria-expanded", "true");
  if (innerWidth < 640) {
    const inline = document.createElement("div");
    inline.className = "menu-inline";
    inline.setAttribute("role", "menu");
    buildMenu(inline, name);
    parent.after(inline);
    if (focus) {
      const first = itemsIn(inline)[0];
      first?.focus();
      first?.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  const submenu = $("menu-submenu");
  buildMenu(submenu, name);
  submenu.hidden = false;
  const root = $("menu-popup").getBoundingClientRect();
  const row = parent.getBoundingClientRect();
  const right = root.right + 4;
  submenu.style.left = Math.max(8, right + submenu.offsetWidth <= innerWidth - 8 ? right : root.left - submenu.offsetWidth - 4) + "px";
  submenu.style.top = Math.max(8, Math.min(row.top, innerHeight - submenu.offsetHeight - 8)) + "px";
  if (focus) itemsIn(submenu)[0]?.focus();
}
function openMenu(name = "workspace") {
  if (name !== "workspace") {
    const parent = $("menu-popup").querySelector<HTMLButtonElement>(`[data-submenu="${name}"]`);
    if (parent) openCategory(name, parent, true);
    return;
  }
  closeMenu();
  const popup = $("menu-popup");
  buildMenu(popup, "workspace");
  popup.hidden = false;
  const box = trigger().getBoundingClientRect();
  popup.style.left = Math.max(8, Math.min(box.left, innerWidth - popup.offsetWidth - 8)) + "px";
  popup.style.top = Math.max(8, Math.min(box.bottom + 6, innerHeight - popup.offsetHeight - 8)) + "px";
  trigger().setAttribute("aria-expanded", "true");
  openName = "workspace";
  itemsIn(popup)[0]?.focus();
}
function handleKeys(event: KeyboardEvent, container: HTMLElement) {
  const items = itemsIn(container);
  const index = items.findIndex((item) => item === document.activeElement);
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (step) items[(index + step + items.length) % items.length]?.focus();
  else if (event.key === "Home") items[0]?.focus();
  else if (event.key === "End") items.at(-1)?.focus();
  else if (event.key === "Escape") closeMenu(true);
  else if (event.key === "ArrowLeft" && activeParent) closeCategory(true);
  else if (event.key === "ArrowRight" && items[index]?.dataset.submenu)
    openCategory(items[index].dataset.submenu!, items[index], true);
  else if (event.key === "Tab") closeMenu();
  else return;
  event.preventDefault();
  event.stopPropagation();
}
function setupMenus() {
  trigger().onclick = () => openName ? closeMenu() : openMenu();
  trigger().onkeydown = (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); openMenu(); }
  };
  $("menu-popup").onkeydown = (event) => handleKeys(event, $("menu-popup"));
  $("menu-submenu").onkeydown = (event) => handleKeys(event, $("menu-submenu"));
  $("menu-submenu").onmouseenter = () => clearTimeout(hoverTimer);
  document.addEventListener("mousedown", (event) => {
    if (openName && !(event.target instanceof Element && event.target.closest("#menu-bar, #menu-popup, #menu-submenu"))) closeMenu();
  });
  addEventListener("resize", () => closeMenu());
}
export { setupMenus };
