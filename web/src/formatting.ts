// A left-hand inspector keeps formatting out of the document header.
import { $, state, storage } from "./core.js";

function setupFormatting() {
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
  $("close-formatting").onclick = close;
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
  update();
}
export { setupFormatting };
