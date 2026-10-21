import { Node } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/core";

// Code tokens keep the newline after their fence; a separate space token
// holds any blank line. Remember both sides for list and quote writers.
type Token = { type?: string; raw?: string; lang?: string; tokens?: Token[]; items?: Token[]; diagramAttached?: boolean; diagramAfter?: string };
const reader = MarkdownManager.prototype as unknown as { parseTokens(tokens: Token[], top?: boolean): JSONContent[] };
const parseTokens = reader.parseTokens;
reader.parseTokens = function (tokens, top) {
  function remember(siblings: Token[]) {
    siblings.forEach((token, index) => {
      if (token.tokens) remember(token.tokens);
      if (token.items) remember(token.items);
      if (token.type !== "code" || token.lang?.split(/\s/)[0] !== "mermaid" || token.diagramAttached !== undefined) return;
      const previous = siblings[index - 1], next = siblings[index + 1];
      token.diagramAttached = !!previous && previous.type !== "space" && !/\n[ \t]*\n$/.test(previous.raw || "");
      token.diagramAfter = ((token.raw || "").endsWith("\n") ? "\n" : "") + (next?.type === "space" ? next.raw || "" : "");
    });
  }
  remember(tokens);
  return parseTokens.call(this, tokens, top);
};

// Keep the opening line, closing line and body independently: editing a
// diagram must not replace its fence, info string or source indentation.
// openNextDiagram makes the next diagram drawn open its source with the
// text selected, as one inserted from the Format panel should.
let openNext = false;
export function openNextDiagram() { openNext = true; }

export const MermaidBlock = Node.create({
  name: "mermaidBlock", priority: 200, group: "block", atom: true, isolating: true,
  addAttributes() {
    return { open: { default: "```mermaid" }, sourceText: { default: "" }, close: { default: "```" }, filled: { default: true }, attached: { default: false }, after: { default: "" }, written: { default: null, rendered: false } };
  },
  parseHTML() { return [{ tag: "div[data-mermaid-source]", getAttrs: el => ({ sourceText: el.getAttribute("data-mermaid-source") }) }]; },
  renderHTML({ node }) { return ["div", { "data-mermaid-source": node.attrs.sourceText }, node.attrs.sourceText]; },
  renderText({ node }) { return node.attrs.sourceText; },
  markdownTokenName: "code",
  parseMarkdown(token) {
    if (token.lang?.split(/\s/)[0] !== "mermaid") return [];
    const lines = (token.raw || "").split("\n");
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0])?.[1];
    if (!fence) return [];
    const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`);
    const end = lines.findIndex((line: string, i: number) => i > 0 && closing.test(line));
    return { type: this.name, attrs: { open: lines[0], sourceText: lines.slice(1, end < 0 ? undefined : end).join("\n"), close: end < 0 ? "" : lines[end], filled: end < 0 || end > 1, attached: token.diagramAttached || false, after: token.diagramAfter || "" } };
  },
  renderMarkdown({ attrs }) {
    return `${attrs?.open}\n${attrs?.filled ? attrs.sourceText + (attrs.close ? "\n" : "") : ""}${attrs?.close}`;
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node, timer = 0, destroyed = false;
      const dom = document.createElement("div"); dom.className = "write-diagram";
      const drawing = document.createElement("div"); drawing.className = "write-diagram-drawing";
      drawing.tabIndex = 0; drawing.setAttribute("role", "button"); drawing.setAttribute("aria-label", "Edit Mermaid diagram"); drawing.setAttribute("aria-expanded", "false");
      const panel = document.createElement("div"); panel.className = "write-math-panel write-footnote-definition"; panel.hidden = true;
      const label = document.createElement("label"); label.textContent = "Diagram source (Mermaid)";
      const input = document.createElement("textarea"); input.rows = 5; input.spellcheck = false; input.setAttribute("aria-label", "Mermaid source");
      const preview = document.createElement("div"); preview.className = "write-diagram-preview"; preview.setAttribute("aria-hidden", "true");
      const error = document.createElement("span"); error.className = "write-footnote-error"; error.setAttribute("role", "alert");
      const actions = document.createElement("span"); actions.className = "write-footnote-actions";
      const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Apply"; apply.className = "primary-button";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.className = "secondary-button";
      function show(target: HTMLElement, source: string) {
        const pre = document.createElement("pre"), code = document.createElement("code"); code.className = "language-mermaid"; code.textContent = source;
        pre.append(code); target.replaceChildren(pre);
        // The same lazy renderer as Preview owns security checks and the
        // render queue. Detached code is ignored after rapid edits or closing.
        import("./preview-diagrams.js").then(({ renderDiagrams }) => {
          if (!destroyed && code.isConnected) return renderDiagrams(target);
        }).catch(() => { if (code.isConnected) error.textContent = "Diagram renderer could not load. Reopen the note to retry."; });
      }
      function close() {
        clearTimeout(timer); panel.hidden = true; preview.replaceChildren(); drawing.setAttribute("aria-expanded", "false"); drawing.focus();
      }
      function open() {
        if (!editor.isEditable) return;
        input.value = current.attrs.sourceText; error.textContent = ""; input.removeAttribute("aria-invalid");
        panel.hidden = false; drawing.setAttribute("aria-expanded", "true"); show(preview, input.value); input.focus(); panel.scrollIntoView({ block: "nearest" });
      }
      function commit() {
        if (!editor.isEditable) return;
        const pos = getPos(); if (pos === undefined) return;
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(current.attrs.open)?.[1] || "```";
        if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`, "m").test(input.value)) {
          error.textContent = "A closing fence would end the diagram early. Remove that line before applying."; input.setAttribute("aria-invalid", "true"); input.focus(); return;
        }
        if (input.value !== current.attrs.sourceText) {
          editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, sourceText: input.value, filled: true }));
          editor.view.dispatch(closeHistory(editor.state.tr));
        }
        close();
      }
      drawing.onclick = () => panel.hidden ? open() : close();
      drawing.onkeydown = event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); panel.hidden ? open() : close(); } };
      input.oninput = () => { clearTimeout(timer); timer = window.setTimeout(() => show(preview, input.value), 150); };
      panel.onkeydown = event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
      };
      apply.onclick = commit; cancel.onclick = close;
      label.append(input); actions.append(apply, cancel); panel.append(label, preview, error, actions); dom.append(drawing, panel);
      let shown: string | undefined;
      function sync() {
        if (shown !== current.attrs.sourceText) { shown = current.attrs.sourceText; show(drawing, shown!); }
        input.readOnly = !editor.isEditable; apply.disabled = !editor.isEditable; drawing.setAttribute("aria-disabled", String(!editor.isEditable));
      }
      sync();
      if (openNext) { openNext = false; requestAnimationFrame(() => { open(); input.select(); }); }
      return { dom, stopEvent: () => true, ignoreMutation: () => true,
        update(next) { if (next.type !== current.type) return false; current = next; sync(); return true; },
        destroy() { destroyed = true; clearTimeout(timer); },
      };
    };
  },
});
