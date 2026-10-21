// The header's menus: File, Edit, View and Insert hold the app's commands
// with their shortcuts, as a document editor's menus do, and the chevron by
// the note title opens the note's own actions.
import { $, showError, state } from "./core.js";
import { icon } from "./icons.js";
import { chooseImages } from "./attachments.js";
import { historyDialog } from "./history.js";
import { exportNote, findInNote, save, setMode } from "./editor.js";
import {
  deleteDialog,
  helpDialog,
  linkDialog,
  newNoteDialog,
  renameDialog,
  renameInPlace,
  trashDialog,
} from "./dialogs.js";
import { findNotes, navigate, toggleFocus } from "./shortcuts.js";
import { paletteDialog } from "./palette.js";
import { toggleOutline } from "./outline.js";
import { dailyNote } from "./daily.js";
import { calloutKind, capitalised, insertCallout } from "./formatting.js";
import { calloutTypes } from "./callout-types.js";
import { settingsDialog } from "./settings.js";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const keys = (text: string) => (mac ? text.replace(/^Ctrl /, "⌘").replace(/^Alt /, "⌥") : text);
const note = () => Boolean(state.current) && !state.pendingDraft;
const writing = () => note() && state.mode === "write";
const rich = (name: string) => () => state.rich?.command(name);

// Each item is [label, shortcut, action, when it is available, icon]; "-"
// separates. Items with an icon show it before the label. The icon
// "radio:on" or "radio:off" makes a choice of one, "check:on" or
// "check:off" a choice of several; both show a check when chosen.
type MenuEntry = "-" | [label: string, shortcut: string, run: () => unknown, when?: () => boolean, iconName?: string];
const menus: Record<string, MenuEntry[]> = {
  file: [
    ["New note", "Ctrl N", newNoteDialog],
    ["Today's note", "Alt J", () => dailyNote().catch(showError)],
    ["Quick open", "Ctrl K", () => paletteDialog()],
    ["Commands…", "", () => paletteDialog(">")],
    "-",
    ["Rename or move…", "Ctrl Shift R", renameDialog, note],
    ["Note history", "", () => historyDialog().catch(showError), note],
    ["Download as Markdown", "", () => exportNote(), note],
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
    ["Image…", "", () => chooseImages(), note],
    ["PDF, audio or video…", "", () => chooseImages(true), note],
    "-",
    ["Table", "", rich("table"), writing],
    ["Checklist", "", rich("taskList"), writing],
    ["Quote", "", rich("blockquote"), writing],
  ],
  title: [
    ["Rename", "", renameInPlace, note, "note"],
    ["Move to folder…", "", renameDialog, note, "folder"],
    ["Export as Markdown", "", () => exportNote(), note, "download"],
    ["Version history", "", () => historyDialog().catch(showError), note, "history"],
    "-",
    ["All commands", "", () => paletteDialog(">"), undefined, "command"],
    "-",
    ["Move to trash", "", deleteDialog, note, "trash"],
  ],
};
// The callout button's type menu: each type with its colour.
menus.callout = calloutTypes.map((kind) => [capitalised(kind), "", () => insertCallout(kind), writing, "dot:" + kind]);
// The menu bar's own menus, in the order the arrow keys move between them.
const barMenus = ["file", "edit", "view", "insert"];
const trigger = (name: string) => document.querySelector<HTMLButtonElement>(`[data-menu="${name}"]`);

let openName = "";
function closeMenu(refocus = false) {
  if (!openName) return;
  const button = trigger(openName);
  button?.setAttribute("aria-expanded", "false");
  $("menu-popup").hidden = true;
  openName = "";
  if (refocus) button?.focus();
}

function openMenu(name: string, focusItem = 0) {
  closeMenu();
  const button = trigger(name);
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
    const [label, shortcut, run, when, iconName] = entry;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    if (iconName?.startsWith("dot:")) {
      const dot = document.createElement("span");
      dot.className = `menu-dot callout-${iconName.slice(4)}`;
      item.append(dot);
      item.classList.toggle("current", iconName.slice(4) === calloutKind());
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(iconName.slice(4) === calloutKind()));
    } else if (/^(radio|check):/.test(iconName || "")) {
      const [kind, on] = (iconName || "").split(":");
      item.setAttribute("role", kind === "radio" ? "menuitemradio" : "menuitemcheckbox");
      item.setAttribute("aria-checked", String(on === "on"));
      item.classList.toggle("current", on === "on");
      item.insertAdjacentHTML("beforeend", on === "on" ? icon("check") : '<span class="menu-check-space"></span>');
    } else if (iconName) item.insertAdjacentHTML("beforeend", icon(iconName));
    item.classList.toggle("danger", iconName === "trash");
    if (!item.hasAttribute("role")) item.setAttribute("role", "menuitem");
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
  popup.style.top = Math.max(8, Math.min(box.bottom + 4, innerHeight - popup.offsetHeight - 8)) + "px";
  popup.style.left = Math.max(8, Math.min(box.left, innerWidth - popup.offsetWidth - 8)) + "px";
  popup.setAttribute("aria-label", button.getAttribute("aria-label") || button.textContent || "");
  popup.dataset.openMenu = name;
  button.setAttribute("aria-expanded", "true");
  openName = name;
  const items = [...popup.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
  items.at(focusItem)?.focus();
}

function setupMenus() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-menu]")) {
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
    else if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && barMenus.includes(openName)) {
      const next = barMenus[(barMenus.indexOf(openName) + (event.key === "ArrowRight" ? 1 : -1) + barMenus.length) % barMenus.length];
      openMenu(next);
    } else if (event.key === "Tab") closeMenu();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("mousedown", (event) => {
    if (openName && !(event.target instanceof Element && event.target.closest("#menu-popup, [data-menu]"))) closeMenu();
  });
  // Focus moving anywhere but the menu or its button closes it, so only one
  // menu or list is open at a time.
  $("menu-popup").addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Element && next.closest("#menu-popup, [data-menu]")) return;
    closeMenu();
  });
  addEventListener("resize", () => closeMenu());
}

// showMenu opens a menu a caller builds, such as a property's choices,
// under the button that carries data-menu="name". It focuses the chosen item.
function showMenu(name: string, entries: MenuEntry[]) {
  menus[name] = entries;
  const chosen = entries.filter((entry) => entry !== "-" && (!entry[3] || entry[3]()))
    .findIndex((entry) => entry !== "-" && /:on$/.test(entry[4] || ""));
  openMenu(name, Math.max(0, chosen));
}
function toggleMenu(name: string, entries: () => MenuEntry[]) {
  if (openName === name) closeMenu();
  else showMenu(name, entries());
}

export type { MenuEntry };
export { setupMenus, showMenu, toggleMenu };
