// Reorder workspace shortcuts without changing their actions or saved view.
import { storage } from "./core.js";

const key = "labradorite-rail-order";
function setupRailOrder() {
  const rail = document.querySelector<HTMLElement>(".activity-rail")!;
  const groups = [rail, rail.querySelector<HTMLElement>(".rail-bottom")!];
  // The plugin switcher stays under the logo, like the logo itself.
  const buttons = (group: HTMLElement) => [...group.querySelectorAll<HTMLButtonElement>(":scope > button:not(#plugin-switcher)")];
  let saved: unknown;
  try { saved = JSON.parse(storage.get(key) || "null"); } catch { /* Keep the default order. */ }
  groups.forEach((group, index) => {
    const defaults = buttons(group);
    const order = Array.isArray(saved) && Array.isArray(saved[index]) ? saved[index] : [];
    const ordered = [...new Set([...order, ...defaults.map(button => button.id)])]
      .map(id => defaults.find(button => button.id === id)).filter((button): button is HTMLButtonElement => Boolean(button));
    const anchor = group === rail ? rail.querySelector(".rail-bottom") : null;
    for (const button of ordered) group.insertBefore(button, anchor);
  });
  const persist = () => storage.set(key, JSON.stringify(groups.map(group => buttons(group).map(button => button.id))));
  let dragged: HTMLButtonElement | null = null;
  const clear = () => rail.querySelectorAll(".rail-drop-target").forEach(el => el.classList.remove("rail-drop-target"));
  for (const group of groups) for (const button of buttons(group)) {
    button.draggable = true;
    button.setAttribute("aria-description", "Drag to reorder, or press Alt Shift Up or Down.");
    button.addEventListener("dragstart", event => {
      dragged = button;
      event.dataTransfer?.setData("text/plain", "labradorite-rail:" + button.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    button.addEventListener("dragover", event => {
      if (!dragged || dragged === button || dragged.parentElement !== group) return;
      event.preventDefault();
      clear();
      button.classList.add("rail-drop-target");
      button.dataset.dropEdge = event.clientY < button.getBoundingClientRect().top + button.offsetHeight / 2 ? "before" : "after";
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    button.addEventListener("drop", event => {
      if (!dragged || dragged === button || dragged.parentElement !== group) return;
      event.preventDefault();
      group.insertBefore(dragged, button.dataset.dropEdge === "after" ? button.nextSibling : button);
      persist();
      dragged.focus();
      clear();
      dragged = null;
    });
    button.addEventListener("dragend", () => { clear(); dragged = null; });
    button.addEventListener("keydown", event => {
      if (!event.altKey || !event.shiftKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const siblings = buttons(group), index = siblings.indexOf(button);
      const target = siblings[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (!target) return;
      group.insertBefore(button, event.key === "ArrowUp" ? target : target.nextSibling);
      persist();
      button.focus();
    });
  }
}
export { setupRailOrder };
