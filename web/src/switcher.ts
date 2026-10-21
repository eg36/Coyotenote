// The plugin switcher: the nine-dot rail button under the logo opens a panel
// that lists the enabled plugins. Alt P opens it; the arrow keys or a
// plugin's number choose one, and Escape returns to the button.
import { $ } from "./core.js";
import { icon } from "./icons.js";
import { activePlugin, plugins, switchPlugin } from "./plugins.js";
import { settingsDialog } from "./settings.js";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const altKey = mac ? "⌥" : "Alt";
const button = () => $("plugin-switcher");
const panel = () => $("plugin-switcher-panel");
const items = () => [...panel().querySelectorAll<HTMLButtonElement>("button")];

function render() {
  const current = activePlugin();
  const list = document.createElement("div");
  list.className = "switcher-list";
  for (const [index, plugin] of plugins().entries()) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "switcher-row";
    row.dataset.plugin = plugin.id;
    row.style.setProperty("--plugin-colour", `var(${plugin.colour})`);
    if (plugin === current) row.setAttribute("aria-current", "true");
    const tile = document.createElement("span");
    tile.className = "switcher-tile";
    tile.innerHTML = icon(plugin.icon);
    const text = document.createElement("span");
    text.className = "switcher-text";
    const name = document.createElement("span");
    name.className = "switcher-name";
    name.textContent = plugin.name;
    const description = document.createElement("span");
    description.className = "switcher-description";
    description.textContent = plugin.description;
    text.append(name, description);
    const check = document.createElement("span");
    check.className = "switcher-check";
    if (plugin === current) check.innerHTML = icon("check");
    const hint = document.createElement("kbd");
    hint.textContent = index < 9 ? String(index + 1) : "";
    row.append(tile, text, check, hint);
    row.onclick = () => choose(plugin.id);
    list.append(row);
  }
  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "switcher-empty";
    empty.textContent = "No plugins are enabled.";
    list.append(empty);
  }
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "switcher-manage";
  manage.innerHTML = icon("settings");
  manage.append("Add or manage plugins");
  manage.onclick = () => {
    closeSwitcher(false);
    settingsDialog({ plugins: true });
  };
  const header = document.createElement("div");
  header.className = "switcher-header";
  const title = document.createElement("span");
  title.textContent = "Labradorite Space";
  const shortcut = document.createElement("kbd");
  shortcut.textContent = altKey + " P";
  header.append(title, shortcut);
  panel().replaceChildren(header, list, manage);
}

function openSwitcher() {
  render();
  // The panel opens beside the rail, level with the button.
  const at = button().getBoundingClientRect();
  panel().style.top = at.top + "px";
  panel().style.left = at.right + 8 + "px";
  panel().hidden = false;
  button().setAttribute("aria-expanded", "true");
  const rows = items();
  (rows.find((row) => row.getAttribute("aria-current")) || rows[0])?.focus();
}
// closeSwitcher hides the panel, returning focus to the button unless focus
// already went elsewhere.
function closeSwitcher(restore = true) {
  if (panel().hidden) return;
  panel().hidden = true;
  button().setAttribute("aria-expanded", "false");
  if (restore) button().focus();
}
function toggleSwitcher() {
  if (panel().hidden) openSwitcher();
  else closeSwitcher();
}
function choose(id: string) {
  closeSwitcher(false);
  if (!switchPlugin(id)) button().focus();
}

// The button's dot shows the active plugin's colour.
function showActive() {
  const plugin = activePlugin();
  button().style.setProperty("--plugin-colour", plugin ? `var(${plugin.colour})` : "transparent");
  button().title = `Switch plugin · ${altKey} P${plugin ? " · " + plugin.name : ""}`;
  if (!panel().hidden) render();
}

function setupSwitcher() {
  button().innerHTML = `<span data-icon="apps">${icon("apps")}</span><span class="switcher-dot" aria-hidden="true"></span>`;
  button().onclick = toggleSwitcher;
  panel().addEventListener("keydown", (event) => {
    const rows = items(), at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const move: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 };
    if (event.key in move) {
      event.preventDefault();
      rows[(move[event.key] + rows.length) % rows.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSwitcher();
    } else if (/^Digit[1-9]$/.test(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const plugin = plugins()[Number(event.code.slice(5)) - 1];
      if (plugin) {
        event.preventDefault();
        choose(plugin.id);
      }
    }
  });
  // Focus leaving the button and panel, or a click outside, closes it.
  for (const el of [button(), panel()])
    el.addEventListener("focusout", (event) => {
      const to = event.relatedTarget as Node | null;
      if (to && (button().contains(to) || panel().contains(to))) return;
      setTimeout(() => {
        const now = document.activeElement;
        if (!button().contains(now) && !panel().contains(now)) closeSwitcher(false);
      }, 0);
    });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (!panel().hidden && !panel().contains(target) && !button().contains(target)) closeSwitcher(false);
  });
  document.addEventListener("plugin-change", showActive);
  showActive();
}

export { openSwitcher, setupSwitcher, toggleSwitcher };
