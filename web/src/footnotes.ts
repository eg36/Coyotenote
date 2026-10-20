import { Node, InputRule } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

interface Definition {
  label: string;
  prefix: string;
  body: string;
  before: string;
  after: string;
  start: number;
  end: number;
}

// Keep definition bodies opaque to the rich Markdown parser. In particular,
// indentation, blank lines, link syntax and trailing spaces remain original.
export function footnoteDefinitions(source: string): Definition[] {
  const lines = source.split("\n"), blocks: Definition[] = [];
  let offset = 0, fence = "", fenceLength = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (code) {
      if (!fence) { fence = code[1][0]; fenceLength = code[1].length; }
      else if (code[1][0] === fence && code[1].length >= fenceLength && !code[2].trim()) fence = "";
    }
    const match = !fence && /^( {0,3}\[\^([^\]\s]+)\]:[ \t]*)(.*)$/.exec(line);
    if (!match) { offset += line.length + 1; continue; }
    let last = i;
    for (let next = i + 1; next < lines.length; next++) {
      if (/^(?: {4}|\t)/.test(lines[next]) && lines[next].trim()) { last = next; continue; }
      if (!lines[next].trim()) continue;
      break;
    }
    const raw = lines.slice(i, last + 1).join("\n");
    const end = offset + raw.length;
    const after = /^\n(?:[ \t]*\n)*/.exec(source.slice(end))?.[0] || "";
    const before = /(?:\n[ \t]*)+$/.exec(source.slice(0, offset))?.[0] || "";
    blocks.push({ label: match[2], prefix: match[1], body: raw.slice(match[1].length), before, after, start: offset, end });
    offset = end + 1;
    i = last;
  }
  return blocks;
}

export function withoutFootnoteDefinitions(source: string) {
  for (const block of footnoteDefinitions(source).reverse())
    source = source.slice(0, block.start) + "\n".repeat(source.slice(block.start, block.end).split("\n").length - 1) + source.slice(block.end);
  return source;
}

export const FootnoteReference = Node.create({
  name: "footnoteReference", group: "inline", inline: true, atom: true,
  addAttributes() { return { label: { default: "" } }; },
  parseHTML() { return [{ tag: "sup[data-footnote-reference]", getAttrs: el => ({ label: el.getAttribute("data-footnote-reference") }) }]; },
  renderHTML({ node }) {
    return ["sup", { "data-footnote-reference": node.attrs.label, class: "write-footnote-ref", role: "button", tabindex: "0", "aria-label": `Edit footnote ${node.attrs.label}` }, node.attrs.label];
  },
  renderText({ node }) { return `[^${node.attrs.label}]`; },
  markdownTokenName: "footnoteReference",
  markdownTokenizer: {
    name: "footnoteReference", level: "inline", start: "[^",
    tokenize(source) {
      const match = /^\[\^([^\]\s]+)\](?!:)/.exec(source);
      if (match) return { type: "footnoteReference", raw: match[0], label: match[1] };
    },
  },
  parseMarkdown(token) { return { type: "footnoteReference", attrs: { label: token.label } }; },
  renderMarkdown(node) { return `[^${node.attrs?.label || ""}]`; },
  addInputRules() {
    return [new InputRule({ find: /\[\^([^\]\s]+)\]$/, handler: ({ range, match, commands }) => {
      commands.insertContentAt(range, { type: this.name, attrs: { label: match[1] } });
    } })];
  },
});

// Match the preview parser's balanced brackets, escapes and paragraph limit.
// The body stays opaque: its own Markdown never passes through serialization.
export function inlineFootnoteToken(source: string) {
  if (!source.startsWith("^[")) return undefined;
  let depth = 1;
  for (let i = 2; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "\n" && source[i + 1] === "\n") return undefined;
    if (source[i] === "[") depth++;
    if (source[i] === "]" && --depth === 0) {
      const body = source.slice(2, i);
      if (body.trim()) return { type: "inlineFootnote", raw: source.slice(0, i + 1), body };
      return undefined;
    }
  }
  return undefined;
}

export function withoutInlineFootnotes(source: string) {
  let result = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\") { result += source.slice(i, i + 2); i++; continue; }
    const token = inlineFootnoteToken(source.slice(i));
    if (token) { result += " "; i += token.raw.length - 1; }
    else result += source[i];
  }
  return result;
}

let inlineFieldId = 0;
const InlineFootnote = Node.create({
  name: "inlineFootnote", group: "inline", inline: true, atom: true,
  addAttributes() { return { body: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-inline-footnote]", getAttrs: el => ({ body: el.getAttribute("data-inline-footnote") }) }]; },
  renderHTML({ node }) { return ["span", { "data-inline-footnote": node.attrs.body }, `^[${node.attrs.body}]`]; },
  renderText({ node }) { return `^[${node.attrs.body}]`; },
  markdownTokenName: "inlineFootnote",
  markdownTokenizer: { name: "inlineFootnote", level: "inline", start: "^[", tokenize: inlineFootnoteToken },
  parseMarkdown(token) { return { type: "inlineFootnote", attrs: { body: token.body } }; },
  renderMarkdown(node) { return `^[${node.attrs?.body || ""}]`; },
  priority: 1100,
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      handleTextInput(view, from, to, text) {
        const at = view.state.doc.resolve(from);
        if (at.parent.type.spec.code || at.marks().some(mark => mark.type.name === "code")) return false;
        const prefix = at.parent.textBetween(0, at.parentOffset, "", "\ufffc");
        const candidate = prefix + text;
        for (let i = 0; i < candidate.length; i++) {
          if (candidate[i] === "\\") { i++; continue; }
          if (!candidate.startsWith("^[", i)) continue;
          const token = inlineFootnoteToken(candidate.slice(i));
          if (token && i + token.raw.length < candidate.length) { i += token.raw.length - 1; continue; }
          const tr = view.state.tr;
          if (token) {
            const start = from - prefix.length + i;
            tr.replaceWith(start, to, view.state.schema.nodes.inlineFootnote.create({ body: token.body }));
          } else tr.insertText(text, from, to);
          view.dispatch(tr);
          return true;
        }
        return false;
      },
    } })];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("span"); dom.className = "write-inline-footnote";
      const trigger = document.createElement("sup"); trigger.className = "write-footnote-ref";
      trigger.textContent = "note"; trigger.setAttribute("role", "button"); trigger.tabIndex = 0;
      trigger.setAttribute("aria-label", "Edit inline footnote"); trigger.setAttribute("aria-expanded", "false");
      const panel = document.createElement("span"); panel.className = "write-inline-footnote-panel write-footnote-definition"; panel.hidden = true;
      const label = document.createElement("label"); label.textContent = "Inline footnote (Markdown)";
      const input = document.createElement("textarea"); input.rows = 3; input.setAttribute("aria-label", "Inline footnote Markdown");
      const error = document.createElement("span"); error.className = "write-footnote-error"; error.setAttribute("role", "alert");
      error.id = `inline-footnote-error-${++inlineFieldId}`; input.setAttribute("aria-describedby", error.id);
      const actions = document.createElement("span"); actions.className = "write-footnote-actions";
      const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Apply";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
      apply.className = "primary-button"; cancel.className = "secondary-button";
      function close() {
        panel.hidden = true; trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
      }
      function open() {
        if (!editor.isEditable) return;
        input.value = current.attrs.body; error.textContent = ""; input.removeAttribute("aria-invalid");
        panel.hidden = false; trigger.setAttribute("aria-expanded", "true"); input.focus();
        panel.scrollIntoView({ block: "nearest" });
      }
      function commit() {
        if (!editor.isEditable) return;
        const raw = `^[${input.value}]`;
        if (inlineFootnoteToken(raw)?.raw !== raw) {
          error.textContent = "Use nonempty Markdown with balanced brackets and no blank lines. Escape literal brackets with a backslash.";
          input.setAttribute("aria-invalid", "true"); input.focus(); return;
        }
        const pos = getPos(); if (pos === undefined) return;
        if (input.value !== current.attrs.body)
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { body: input.value }));
        close();
      }
      trigger.onclick = () => panel.hidden ? open() : close();
      trigger.onkeydown = event => {
        if (["Enter", " "].includes(event.key)) { event.preventDefault(); panel.hidden ? open() : close(); }
      };
      panel.onkeydown = event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
      };
      apply.onclick = commit; cancel.onclick = close;
      label.append(input); actions.append(apply, cancel); panel.append(label, error, actions); dom.append(trigger, panel);
      function sync() {
        dom.dataset.inlineFootnote = current.attrs.body;
        trigger.title = current.attrs.body;
        trigger.setAttribute("aria-disabled", String(!editor.isEditable));
        input.readOnly = !editor.isEditable; apply.disabled = !editor.isEditable;
      }
      sync();
      return {
        dom, stopEvent: () => true, ignoreMutation: () => true,
        update(next) { if (next.type !== current.type) return false; current = next; sync(); return true; },
      };
    };
  },
});

function displayBody(raw: string) {
  return raw.split("\n").map((line, i) => i ? line.replace(/^(?: {4}|\t)/, "") : line).join("\n");
}
function indentedBody(value: string, original: string) {
  const old = original.split("\n");
  return value.split("\n").map((line, i) => {
    if (!i || !line.trim()) return line;
    return (/^(?: {4}|\t)/.exec(old[i] || "")?.[0] || "    ") + line;
  }).join("\n");
}

export function footnoteExtensions(source: () => string) {
  const definition = Node.create({
    name: "footnoteDefinition", group: "block", atom: true, isolating: true,
    addAttributes() {
      return { label: { default: "" }, prefix: { default: "" }, body: { default: "" }, before: { default: "\n\n" }, after: { default: "" } };
    },
    parseHTML() { return [{ tag: "div[data-footnote-definition]", getAttrs(el) {
      return { label: el.getAttribute("data-footnote-definition"), prefix: el.getAttribute("data-footnote-prefix"),
        body: el.getAttribute("data-footnote-body"), before: el.getAttribute("data-footnote-before"), after: el.getAttribute("data-footnote-after") };
    } }]; },
    renderHTML({ node }) {
      return ["div", { "data-footnote-definition": node.attrs.label, "data-footnote-prefix": node.attrs.prefix,
        "data-footnote-body": node.attrs.body, "data-footnote-before": node.attrs.before, "data-footnote-after": node.attrs.after,
        class: "write-footnote-definition" }, `${node.attrs.prefix}${node.attrs.body}`];
    },
    markdownTokenName: "footnoteDefinition",
    markdownTokenizer: {
      name: "footnoteDefinition", level: "block",
      start: text => /^ {0,3}\[\^[^\]\s]+\]:/m.exec(text)?.index ?? -1,
      tokenize(text) {
        const match = /^( {0,3}\[\^([^\]\s]+)\]:)/.exec(text);
        if (!match) return undefined;
        const block = footnoteDefinitions(source()).find(item => item.label === match[2] && text.startsWith(item.prefix + item.body + item.after))
          || footnoteDefinitions(text)[0];
        if (!block) return undefined;
        const raw = block.prefix + block.body + block.after;
        if (!text.startsWith(raw)) return undefined;
        return { type: "footnoteDefinition", raw, ...block };
      },
    },
    parseMarkdown(token) { return { type: "footnoteDefinition", attrs: { label: token.label, prefix: token.prefix, body: token.body, before: token.before, after: token.after } }; },
    renderMarkdown(node) { return `${node.attrs?.prefix || `[^${node.attrs?.label}]: `}${node.attrs?.body || ""}`; },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let current = node;
        const dom = document.createElement("div"); dom.className = "write-footnote-definition";
        const label = document.createElement("label");
        const heading = document.createElement("span"); heading.textContent = `Footnote [^${node.attrs.label}]`;
        const input = document.createElement("textarea"); input.rows = 1;
        input.setAttribute("aria-label", `Footnote ${node.attrs.label}`);
        dom.dataset.footnoteDefinition = node.attrs.label;
        const resize = () => { input.style.height = "auto"; input.style.height = input.scrollHeight + 2 + "px"; };
        const sync = () => {
          const value = displayBody(current.attrs.body);
          if (input.value !== value) input.value = value;
          input.readOnly = !editor.isEditable;
          resize();
        };
        input.oninput = () => {
          if (!editor.isEditable) return;
          const pos = getPos(); if (pos === undefined) return;
          const body = indentedBody(input.value, current.attrs.body);
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, body }));
          resize();
        };
        label.append(heading, input); dom.append(label);
        const observer = new ResizeObserver(resize); observer.observe(dom);
        sync();
        return {
          dom, stopEvent: event => event.target === input, ignoreMutation: () => true,
          update(next) { if (next.type !== current.type) return false; current = next; sync(); return true; },
          destroy() { observer.disconnect(); },
        };
      };
    },
  });
  // The stock document inserts two newlines between every block. Definitions
  // may instead be adjacent, followed by body text, or end with one newline.
  const documentNode = Node.create({
    name: "doc", topNode: true, content: "block+",
    renderMarkdown(node, helpers) {
      const nodes = (node.content || []).filter((item, index, all) => {
        if (item.type !== "paragraph" || item.content?.length) return true;
        let next = index + 1;
        while (all[next]?.type === "paragraph" && !all[next].content?.length) next++;
        if (all[next]?.type === "footnoteDefinition") return false;
        let previous = index - 1;
        while (all[previous]?.type === "paragraph" && !all[previous].content?.length) previous--;
        return next < all.length || !["footnoteDefinition", "taskList", "mathBlock"].includes(all[previous]?.type || "");
      });
      let result = "";
      nodes.forEach((child, i) => {
        const previous = nodes[i - 1];
        if (previous?.type === "footnoteDefinition") result += previous.attrs?.after || "\n\n";
        else if (previous?.type === "taskList" || previous?.type === "mathBlock") result += previous.attrs?.after || "\n\n";
        else if (child.type === "footnoteDefinition") result += child.attrs?.before || (i ? "\n\n" : "");
        else if (i) result += "\n\n";
        result += helpers.renderChild!(child, i);
      });
      const last = nodes.at(-1);
      if (last?.type === "footnoteDefinition") result += last.attrs?.after || "";
      else if (last?.type === "taskList" || last?.type === "mathBlock") result += last.attrs?.after || "";
      // A final paragraph has no visible newline node. Retain the source's
      // terminator when editing text or an inline footnote in that paragraph.
      else if (!result.endsWith("\n")) result += /(?:\n[ \t]*)+$/.exec(source())?.[0] || "";
      return result;
    },
  });
  return [documentNode, definition, FootnoteReference, InlineFootnote];
}
