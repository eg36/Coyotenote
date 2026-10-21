// Keep desktop and phone choices separate when the layout changes.
import { $, storage } from "./core.js";

const mobile = matchMedia("(max-width: 799px)");
function preferenceKey() {
  return mobile.matches ? "labradorite-sidebar-mobile" : "labradorite-sidebar-desktop";
}
function setSidebar(open: boolean, persist = true, dismissSearch = true) {
  $("app").classList.toggle("sidebar-open", mobile.matches && open);
  $("app").classList.toggle("sidebar-hidden", !mobile.matches && !open);
  if (open) $("app").classList.remove("focus-mode");
  $("sidebar-toggle").setAttribute("aria-expanded", String(open));
  $("panel-toggle").setAttribute("aria-expanded", String(open));
  // The phone drawer covers the note: what is beneath it cannot be reached
  // by keyboard or pointer, and closing it returns focus to its button.
  const covering = mobile.matches && open;
  for (const covered of document.querySelectorAll<HTMLElement>(".workspace, #format-panel")) covered.inert = covering;
  if (!covering && mobile.matches && $("sidebar").contains(document.activeElement)) $("sidebar-toggle").focus();
  if (!open && dismissSearch && $("app").classList.contains("search-in-note"))
    document.dispatchEvent(new Event("search-closed"));
  if (persist) storage.set(preferenceKey(), String(open));
}
function restoreSidebar() {
  const stored = storage.get(preferenceKey());
  setSidebar(stored === "true" || (stored !== "false" && !mobile.matches), false, false);
}
function toggleSidebar() {
  const open = mobile.matches
    ? $("app").classList.contains("sidebar-open")
    : !$("app").classList.contains("sidebar-hidden");
  setSidebar(!open);
}
mobile.addEventListener("change", () => {
  const focusedInPanel = $("sidebar").contains(document.activeElement);
  restoreSidebar();
  if (focusedInPanel) setSidebar(true, false);
});

export { restoreSidebar, setSidebar, toggleSidebar };
