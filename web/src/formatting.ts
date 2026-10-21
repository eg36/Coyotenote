// A left-hand inspector keeps formatting out of the document header.
import { $, state, storage } from "./core.js";
import { calloutTypes } from "./callout-types.js";

// The callout button makes the type last chosen from its menu, kept in this
// browser; the menu lists every type.
const calloutKey = "labradorite-callout-type";
const capitalised = (kind: string) => kind.slice(0, 1).toUpperCase() + kind.slice(1);
function calloutKind() {
  const kind = storage.get(calloutKey) || "";
  return calloutTypes.includes(kind) ? kind : "note";
}
function showCalloutKind() {
  const name = capitalised(calloutKind());
  $("callout-label").textContent = name;
  $("callout-insert").setAttribute("aria-label", `${name} callout`);
}
function insertCallout(kind = calloutKind()) {
  storage.set(calloutKey, kind);
  showCalloutKind();
  state.rich?.command("callout", kind);
}

// The panel is one toolbar: Tab enters it at the control used last and
// leaves it, and the arrow keys, Home and End move between its controls.
// Controls that use the arrows themselves (the style list, the callout
// type menu) handle them first.
function setupToolbar() {
  const bar = $("editor-toolbar");
  const all = () => [...bar.querySelectorAll<HTMLButtonElement>("button")];
  const usable = () => all().filter((button) => !button.disabled && button.getClientRects().length > 0);
  const rove = (target: HTMLButtonElement) => { for (const button of all()) button.tabIndex = button === target ? 0 : -1; };
  bar.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLButtonElement) rove(event.target);
  });
  bar.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLButtonElement)) return;
    const list = usable(), index = list.indexOf(event.target);
    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[event.key];
    const next = step ? list[(index + step + list.length) % list.length]
      : event.key === "Home" ? list[0] : event.key === "End" ? list.at(-1) : undefined;
    if (!next) return;
    event.preventDefault();
    next.focus();
  });
  rove(all()[0]);
}

function setupFormatting() {
  setupToolbar();
  const desktop = matchMedia("(min-width: 1100px)");
  const key = () => desktop.matches ? "labradorite-formatting-desktop" : "labradorite-formatting-mobile";
  let open = storage.get(key()) !== "false" && (desktop.matches || storage.get(key()) === "true");
  function update() {
    const available = Boolean(state.current) && state.mode === "write";
    const visible = available && open && !$("app").classList.contains("focus-mode");
    $("format-toggle").hidden = !available;
    $("format-panel").hidden = !visible;
    $("formatting-scrim").hidden = !visible || desktop.matches;
    $("format-toggle").setAttribute("aria-expanded", String(visible));
    $("app").classList.toggle("formatting-open", visible);
  }
  const setOpen = (value: boolean) => {
    open = value;
    if (value) $("app").classList.remove("focus-mode");
    storage.set(key(), String(value));
    update();
  };
  $("format-toggle").onclick = () => setOpen(!$("app").classList.contains("formatting-open"));
  const close = () => { setOpen(false); $("format-toggle").focus(); };
  $("formatting-scrim").onclick = close;
  $("format-panel").addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  });
  document.addEventListener("editor-mode-change", update);
  document.addEventListener("note-selection-change", update);
  document.addEventListener("workspace-focus-change", update);
  desktop.addEventListener("change", () => {
    open = storage.get(key()) !== "false" && (desktop.matches || storage.get(key()) === "true");
    update();
  });
  showCalloutKind();
  update();
}
export { calloutKind, capitalised, insertCallout, setupFormatting };
