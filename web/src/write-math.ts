import { Node, InputRule } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

// These mirror the preview's dollar grammar in cmd/labradorite/math.go, so a
// formula is a formula in Write exactly when the preview renders it.
const space = /[ \t\n\r\v\f]/;
export function inlineMathToken(source: string, previous = "") {
  if (source[0] !== "$" || previous === "$") return undefined;
  const end = source.indexOf("\n");
  const line = end < 0 ? source : source.slice(0, end + 1);
  if (line.length < 3 || line[1] === "$" || space.test(line[1])) return undefined;
  for (let i = 2; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] !== "$") continue;
    // A closing dollar followed by a digit belongs to money, as in $5 and $6.
    if (space.test(line[i - 1]) || /[$0-9]/.test(line[i + 1] || "")) return undefined;
    return { type: "inlineMath", raw: line.slice(0, i + 1), tex: line.slice(1, i) };
  }
  return undefined;
}

// Display formulas are $$ lines around TeX, or $$…$$ on one line. Every
// delimiter, indent and trailing space is kept so saving changes nothing.
export function mathBlockToken(source: string) {
  const lines = source.split("\n");
  const indent = /^ {0,3}/.exec(lines[0])![0];
  const rest = lines[0].slice(indent.length);
  const trimmed = rest.trimEnd();
  if (!trimmed.startsWith("$$")) return undefined;
  let open: string, tex: string, close: string, single = false, filled = true, count = 1;
  if (trimmed.length > 4 && trimmed.endsWith("$$")) {
    open = indent + "$$"; tex = trimmed.slice(2, -2); close = "$$" + rest.slice(trimmed.length); single = true;
  } else {
    if (trimmed !== "$$") return undefined;
    const last = lines.findIndex((line, i) => i > 0 && line.trim() === "$$");
    if (last < 0) return undefined;
    open = lines[0]; tex = lines.slice(1, last).join("\n"); close = lines[last];
    filled = last > 1; count = last + 1;
  }
  const raw = lines.slice(0, count).join("\n");
  const after = /^\n(?:[ \t]*\n)*/.exec(source.slice(raw.length))?.[0] || "";
  return { type: "mathBlock", raw: raw + after, open, tex, close, single, filled, after };
}

interface BlockAttrs { open: string; tex: string; close: string; single: boolean; filled: boolean }
function blockMarkdown({ open, tex, close, single, filled }: BlockAttrs) {
  return single ? open + tex + close : `${open}\n${filled ? tex + "\n" : ""}${close}`;
}

// KaTeX, its stylesheet and fonts load only once a formula is on screen.
function render(target: HTMLElement, tex: string, display: boolean) {
  target.textContent = tex;
  if (!tex.trim()) return;
  import("./preview-math.js").then(({ renderFormula }) => {
    if (target.isConnected && target.dataset.tex === tex) return renderFormula(target, tex, display);
  }).catch(() => undefined);
}

let fieldId = 0;
let openNext = false;
// A formula shows rendered; activating it opens its TeX in a field below,
// with a live rendering, until Apply (Ctrl/⌘ Enter) or Cancel (Escape).
function formulaView(display: boolean, validate: (value: string, pos: number, editor: Editor, attrs: Record<string, unknown>) => string | Record<string, unknown>) {
  return ({ node, editor, getPos }: { node: import("@tiptap/pm/model").Node; editor: Editor; getPos: () => number | undefined }) => {
    let current = node;
    const dom = document.createElement(display ? "div" : "span");
    dom.className = display ? "write-math-block" : "write-math";
    const formula = document.createElement(display ? "div" : "span");
    formula.className = "write-math-formula"; formula.setAttribute("role", "button"); formula.tabIndex = 0;
    formula.setAttribute("aria-expanded", "false");
    const panel = document.createElement(display ? "div" : "span");
    panel.className = "write-math-panel write-footnote-definition"; panel.hidden = true;
    const label = document.createElement("label"); label.textContent = display ? "Display formula (TeX)" : "Formula (TeX)";
    const input = document.createElement("textarea"); input.rows = display ? 3 : 1; input.spellcheck = false;
    input.setAttribute("aria-label", display ? "Display formula TeX" : "Formula TeX");
    const preview = document.createElement(display ? "div" : "span"); preview.className = "write-math-preview"; preview.setAttribute("aria-hidden", "true");
    const error = document.createElement("span"); error.className = "write-footnote-error"; error.setAttribute("role", "alert");
    error.id = `math-error-${++fieldId}`; input.setAttribute("aria-describedby", error.id);
    const actions = document.createElement("span"); actions.className = "write-footnote-actions";
    const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Apply"; apply.className = "primary-button";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.className = "secondary-button";
    let timer = 0;
    function show(target: HTMLElement, tex: string) { target.dataset.tex = tex; render(target, tex, display); }
    function close() {
      panel.hidden = true; formula.setAttribute("aria-expanded", "false"); formula.focus();
    }
    function open() {
      if (!editor.isEditable) return;
      input.value = current.attrs.tex; error.textContent = ""; input.removeAttribute("aria-invalid");
      show(preview, input.value);
      panel.hidden = false; formula.setAttribute("aria-expanded", "true"); input.focus();
      panel.scrollIntoView({ block: "nearest" });
    }
    function commit() {
      if (!editor.isEditable) return;
      const pos = getPos(); if (pos === undefined) return;
      if (input.value !== current.attrs.tex) {
        const attrs = validate(input.value, pos, editor, current.attrs);
        if (typeof attrs === "string") { error.textContent = attrs; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
      }
      close();
    }
    formula.onclick = () => panel.hidden ? open() : close();
    formula.onkeydown = event => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); panel.hidden ? open() : close(); }
    };
    input.oninput = () => { clearTimeout(timer); timer = window.setTimeout(() => show(preview, input.value), 150); };
    panel.onkeydown = event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
    };
    apply.onclick = commit; cancel.onclick = close;
    label.append(input); actions.append(apply, cancel); panel.append(label, preview, error, actions); dom.append(formula, panel);
    function sync() {
      const tex = current.attrs.tex as string;
      if (formula.dataset.tex !== tex) show(formula, tex);
      if (!tex.trim()) formula.textContent = "Empty formula";
      formula.classList.toggle("empty", !tex.trim());
      formula.title = tex; formula.setAttribute("aria-label", `Edit formula ${tex}`);
      formula.setAttribute("aria-disabled", String(!editor.isEditable));
      input.readOnly = !editor.isEditable; apply.disabled = !editor.isEditable;
    }
    sync();
    if (openNext) { openNext = false; requestAnimationFrame(open); }
    return {
      dom, stopEvent: () => true, ignoreMutation: () => true,
      update(next: import("@tiptap/pm/model").Node) { if (next.type !== current.type) return false; current = next; sync(); return true; },
      destroy() { clearTimeout(timer); },
    };
  };
}

export const InlineMath = Node.create({
  name: "inlineMath", group: "inline", inline: true, atom: true,
  addAttributes() { return { tex: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-inline-math]", getAttrs: el => ({ tex: el.getAttribute("data-inline-math") }) }]; },
  renderHTML({ node }) { return ["span", { "data-inline-math": node.attrs.tex }, `$${node.attrs.tex}$`]; },
  renderText({ node }) { return `$${node.attrs.tex}$`; },
  markdownTokenName: "inlineMath",
  markdownTokenizer: {
    name: "inlineMath", level: "inline", start: "$",
    tokenize(source, tokens) { return inlineMathToken(source, tokens?.at(-1)?.raw?.slice(-1)); },
  },
  parseMarkdown(token) { return { type: "inlineMath", attrs: { tex: token.tex } }; },
  renderMarkdown(node) { return `$${node.attrs?.tex || ""}$`; },
  // Typing the closing dollar of $x^2$ turns it into a formula, by the same
  // rules as the preview: no space inside the dollars, nor a $ before them.
  addInputRules() {
    return [new InputRule({ find: /(?<![\\$])\$((?:\\.|[^$\\\n])+)\$$/, handler: ({ range, match, commands }) => {
      if (inlineMathToken(match[0])?.raw !== match[0]) return null;
      commands.insertContentAt(range, { type: this.name, attrs: { tex: match[1] } });
    } })];
  },
  addNodeView() {
    return formulaView(false, (value, pos, editor) => {
      const before = pos > 0 ? editor.state.doc.textBetween(pos - 1, pos, "", "￼") : "";
      const after = editor.state.doc.textBetween(pos + 1, Math.min(pos + 2, editor.state.doc.content.size), "", "￼");
      const raw = `$${value}$`;
      if (inlineMathToken(raw + after, before)?.raw !== raw)
        return "Use TeX on one line, without spaces just inside the dollars or an unescaped $, and not before a digit.";
      return { tex: value };
    });
  },
});

export const MathBlock = Node.create({
  name: "mathBlock", group: "block", atom: true, isolating: true,
  addAttributes() {
    return { open: { default: "$$" }, tex: { default: "" }, close: { default: "$$" }, single: { default: false }, filled: { default: false }, after: { default: "" } };
  },
  parseHTML() { return [{ tag: "div[data-math-block]", getAttrs: el => ({ tex: el.getAttribute("data-math-block") }) }]; },
  renderHTML({ node }) { return ["div", { "data-math-block": node.attrs.tex }, blockMarkdown(node.attrs as BlockAttrs)]; },
  renderText({ node }) { return blockMarkdown(node.attrs as BlockAttrs); },
  markdownTokenName: "mathBlock",
  markdownTokenizer: {
    name: "mathBlock", level: "block",
    start: text => /^ {0,3}\$\$/m.exec(text)?.index ?? -1,
    tokenize: source => mathBlockToken(source),
  },
  parseMarkdown(token) {
    const { open, tex, close, single, filled, after } = token;
    return { type: "mathBlock", attrs: { open, tex, close, single, filled, after } };
  },
  renderMarkdown(node) { return blockMarkdown(node.attrs as BlockAttrs); },
  // $$ then Enter in an empty paragraph starts a display formula.
  addKeyboardShortcuts() {
    return { Enter: ({ editor }) => {
      const { $from, empty } = editor.state.selection;
      if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.textContent !== "$$" || $from.depth !== 1) return false;
      openNext = true;
      return editor.chain().deleteRange({ from: $from.before(), to: $from.after() })
        .insertContentAt($from.before(), { type: this.name }).run();
    } };
  },
  addNodeView() {
    return formulaView(true, (value, _pos, _editor, attrs) => {
      let next = { ...attrs, tex: value, filled: value !== "" } as BlockAttrs;
      if (next.single && value.includes("\n")) next = { ...next, open: next.open, close: "$$", single: false };
      if (next.single && !value) return "Write the formula between the $$ signs.";
      const raw = blockMarkdown(next);
      if (mathBlockToken(raw)?.raw !== raw) return "A line holding only $$ would end the formula early.";
      return { ...next };
    });
  },
});

// A backslash-escaped dollar shows as $ and saves with its backslash, so
// prices such as \$5 never turn into formulas when the note is saved.
export const EscapedDollar = Node.create({
  name: "escapedDollar", group: "inline", inline: true, atom: true,
  parseHTML() { return [{ tag: "span[data-escaped-dollar]" }]; },
  renderHTML() { return ["span", { "data-escaped-dollar": "" }, "$"]; },
  renderText() { return "$"; },
  markdownTokenName: "escapedDollar",
  markdownTokenizer: {
    name: "escapedDollar", level: "inline", start: "\\$",
    tokenize(source) { if (source.startsWith("\\$")) return { type: "escapedDollar", raw: "\\$" }; },
  },
  parseMarkdown() { return { type: "escapedDollar" }; },
  renderMarkdown() { return "\\$"; },
});
