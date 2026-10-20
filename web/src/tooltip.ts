// Themed tooltips for every element with a title. The title is set aside
// while the tooltip shows, so the browser's plain one never appears, and
// is put back afterwards. Text after " · " is shown as its shortcut.
const tip = document.createElement("div");
tip.className = "tooltip";
tip.setAttribute("role", "tooltip");
tip.setAttribute("popover", "manual");
// Older browsers without popovers show it in the page instead.
const topLayer = "showPopover" in HTMLElement.prototype;

let target: HTMLElement | null = null;
let saved = "";
let timer: ReturnType<typeof setTimeout> | undefined;
// Moving from one control to the next shows its tooltip at once.
let warmUntil = 0;
const mac = /Mac|iPhone|iPad/.test(navigator.platform);

function fill(text: string) {
  const [label, ...rest] = target?.id === "document-title" ? [text] : text.split(" · ");
  tip.replaceChildren(label || "");
  if (rest.length) {
    const keys = document.createElement("kbd");
    // Titles name both platforms' keys; show this one's.
    keys.textContent = rest.join(" · ").replaceAll("Ctrl/⌘ ", mac ? "⌘" : "Ctrl ");
    tip.append(keys);
  }
}

function place(el: HTMLElement) {
  const box = el.getBoundingClientRect();
  const width = tip.offsetWidth,
    height = tip.offsetHeight;
  const below = box.bottom + 6 + height <= innerHeight - 8;
  tip.style.top = (below ? box.bottom + 6 : box.top - 6 - height) + "px";
  tip.style.left =
    Math.max(8, Math.min(box.left + box.width / 2 - width / 2, innerWidth - width - 8)) + "px";
}

// Code may set a new title while the tooltip shows; take it over.
const watch = new MutationObserver(() => {
  if (!target?.hasAttribute("title")) return;
  saved = target.title;
  target.removeAttribute("title");
  fill(saved);
  place(target);
});

function show(el: HTMLElement) {
  if (target === el) return;
  hide();
  if (!el.title.trim() || !el.isConnected) return;
  target = el;
  saved = el.title;
  el.removeAttribute("title");
  watch.observe(el, { attributes: true, attributeFilter: ["title"] });
  fill(saved);
  if (topLayer) tip.showPopover();
  else tip.hidden = false;
  place(el);
}

function hide() {
  clearTimeout(timer);
  if (!target) return;
  watch.disconnect();
  if (!target.hasAttribute("title")) target.title = saved;
  target = null;
  if (topLayer) {
    if (tip.matches(":popover-open")) tip.hidePopover();
  } else tip.hidden = true;
  warmUntil = Date.now() + 400;
}

function titled(node: EventTarget | null) {
  return node instanceof Element ? node.closest<HTMLElement>("[title]") : null;
}

function setupTooltips() {
  if (!topLayer) {
    tip.removeAttribute("popover");
    tip.hidden = true;
  }
  document.body.append(tip);
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    if (target && event.target instanceof Node && target.contains(event.target)) return;
    const el = titled(event.target);
    hide();
    if (el) timer = setTimeout(() => show(el), Date.now() < warmUntil ? 0 : 450);
  });
  document.addEventListener("pointerout", (event) => {
    const into = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (target ? !into || !target.contains(into) : !into) hide();
  });
  document.addEventListener("focusin", (event) => {
    const el = titled(event.target);
    if (el && el.matches(":focus-visible")) show(el);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  }, true);
  addEventListener("scroll", hide, true);
  addEventListener("resize", hide);
}

export { setupTooltips };
