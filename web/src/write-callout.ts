import { Node, InputRule } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { icon } from "./icons.js";

// Callouts are quotes whose first line names a type, as in
// "> [!warning]- Mind the gap". Write shows them as the preview does and
// edits the type, title and folding in the header and the body as text,
// saving the first line exactly as written unless one of those changes.

// Every type and alias, with the type it looks like and its icon, as in
// the preview (cmd/labradorite/syntax.go). Unknown types look like a note.
const types: [string, string, string][] = [
  ["note", "pen", ""], ["abstract", "list", "summary tldr"], ["info", "info", ""],
  ["todo", "checkSquare", ""], ["tip", "flame", "hint important"],
  ["success", "check", "check done"], ["question", "help", "help faq"],
  ["warning", "alert", "caution attention"], ["failure", "close", "fail missing"],
  ["danger", "zap", "error"], ["bug", "bug", ""], ["example", "ordered", ""], ["quote", "quote", "cite"],
];
const looks = new Map<string, [string, string]>();
for (const [name, glyph, aliases] of types)
  for (const alias of [name, ...aliases.split(" ").filter(Boolean)]) looks.set(alias, [name, glyph]);
const lookOf = (kind: string) => looks.get(kind.toLowerCase()) || looks.get("note")!;
const capitalised = (kind: string) => kind.slice(0, 1).toUpperCase() + kind.slice(1).toLowerCase();

// A callout made by typing takes what is typed next as its title.
let titleNext = false;

const head = /^( {0,3}>[ \t]?)\[!([^\]\s]+)\]([+-]?)([ \t]*)(.*)$/;

// The callout's lines run while they start with ">". A line after them that
// is not blank would continue its last paragraph lazily, which Write would
// not keep; such callouts stay in Markdown (see continuedCallout).
type Lexed = { type?: string; raw?: string };
export function calloutToken(source: string, blockTokens: (text: string) => Lexed[]) {
  const lines = source.split("\n");
  const first = head.exec(lines[0]);
  if (!first) return undefined;
  let n = 1;
  while (n < lines.length && /^ {0,3}>/.test(lines[n])) n++;
  if (n < lines.length && lines[n].trim()) return undefined;
  const raw = lines.slice(0, n).join("\n") + (n < lines.length ? "\n" : "");
  const body = lines.slice(1, n).map(line => line.replace(/^ {0,3}>[ \t]?/, "")).join("\n");
  const tokens = body.trim() ? blockTokens(body) : [];
  // The line breaks between the body's blocks, to keep its spacing.
  const blocks = tokens.filter(token => token.type !== "space");
  const separators = blocks.slice(0, -1).map((token, i) => {
    let gap = /\n*$/.exec(token.raw || "")![0];
    for (let j = tokens.indexOf(token) + 1; j < tokens.length && tokens[j] !== blocks[i + 1]; j++) gap += tokens[j].raw || "";
    return gap;
  });
  return {
    type: "callout", raw, tokens,
    lead: first[1], kind: first[2], fold: first[3], space: first[4], title: first[5],
    gaps: separators, empty: !body.trim(),
    // How the body's lines start, "> " or ">", as its first line shows.
    prefix: /^ {0,3}>[ \t]?/.exec(lines.slice(1, n).find(line => line.replace(/^ {0,3}>/, "").trim()) || "")?.[0] || "> ",
  };
}

// Whether body has a callout that a following line continues lazily.
export function continuedCallout(body: string) {
  const lines = body.split("\n");
  let fence = "";
  for (let i = 0; i < lines.length; i++) {
    const code = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (code && (!fence || code[1][0] === fence[0])) fence = fence ? "" : code[1];
    if (fence || !head.test(lines[i].replace(/^(?: {0,3}>[ \t]?)+(?= {0,3}>[ \t]?\[!)/, ""))) continue;
    let n = i + 1;
    while (n < lines.length && /^ {0,3}>/.test(lines[n])) n++;
    if (n < lines.length && lines[n].trim()) return true;
  }
  return false;
}

type Helpers = { renderChild?: (node: JSONContent, index: number) => string; renderChildren: (nodes: JSONContent[]) => string };
function quoted(text: string, prefix: string) {
  return text.split("\n").map(line => line.trim() === "" ? prefix.trimEnd() : prefix + line).join("\n");
}

export const Callout = Node.create({
  name: "callout", group: "block", content: "block+", defining: true,
  addAttributes() {
    const kept = (value: unknown) => ({ default: value, rendered: false });
    return {
      lead: kept("> "), kind: kept("note"), fold: kept(""), space: kept(" "), title: kept(""),
      gaps: kept(null), empty: kept(false), prefix: kept("> "),
    };
  },
  parseHTML() { return [{ tag: "div[data-callout]", getAttrs: el => ({ kind: el.getAttribute("data-callout") || "note" }) }]; },
  renderHTML({ node }) { return ["div", { "data-callout": node.attrs.kind, class: "callout write-callout" }, 0]; },
  markdownTokenName: "callout",
  markdownTokenizer: {
    name: "callout", level: "block",
    start: text => /^ {0,3}>[ \t]?\[!/m.exec(text)?.index ?? -1,
    tokenize: (source, _tokens, helpers) => calloutToken(source, text => helpers.blockTokens(text)),
  },
  parseMarkdown(token, helpers) {
    const { lead, kind, fold, space, title, gaps, empty, prefix } = token;
    const content = helpers.parseChildren(token.tokens || []);
    return helpers.createNode("callout", { lead, kind, fold, space, title, gaps, empty, prefix },
      content.length ? content : [helpers.createNode("paragraph", {}, [])]);
  },
  renderMarkdown(node, h) {
    const { lead = "> ", kind = "note", fold = "", space = "", title = "", gaps, empty, prefix = "> " } = node.attrs || {};
    const first = `${lead}[!${kind}]${fold}${title && !space ? " " : space}${title}`;
    const children = node.content || [];
    if (empty && children.length === 1 && children[0].type === "paragraph" && !children[0].content?.length) return first;
    const helpers = h as unknown as Helpers;
    const same = Array.isArray(gaps) && gaps.length === children.length - 1;
    return first + children.map((child, i) => {
      const text = quoted(helpers.renderChild?.(child, i) ?? helpers.renderChildren([child]), prefix);
      if (!i) return "\n" + text;
      // Blank lines between blocks are written as ">" lines, as before.
      const blank = same ? Math.max((gaps[i - 1].match(/\n/g) || []).length - 1, 0) : 1;
      return "\n" + ">\n".repeat(blank) + text;
    }).join("");
  },
  // Typing [!type] at the start of a quote makes it a callout of that type.
  addInputRules() {
    return [new InputRule({ find: /^\[!([^\]\s]+)\]([+-]?) $/, handler: ({ state, range, match }) => {
      const $from = state.doc.resolve(range.from);
      const depth = $from.depth - 1;
      if (depth < 1 || $from.node(depth).type.name !== "blockquote" || $from.index(depth) !== 0) return null;
      titleNext = true;
      state.tr.delete(range.from, range.to)
        .setNodeMarkup($from.before(depth), this.type, { kind: match[1], fold: match[2], space: "", title: "", empty: true });
    } })];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("div");
      const header = document.createElement("div"); header.className = "callout-title write-callout-header"; header.contentEditable = "false";
      const glyph = document.createElement("span"); glyph.className = "callout-icon";
      const kind = document.createElement("select"); kind.setAttribute("aria-label", "Callout type");
      const title = document.createElement("input"); title.type = "text"; title.setAttribute("aria-label", "Callout title (Markdown)"); title.spellcheck = true;
      const fold = document.createElement("select"); fold.setAttribute("aria-label", "Callout folding");
      for (const [value, label] of [["", "Always open"], ["+", "Folds, shown open"], ["-", "Folds, shown closed"]]) fold.add(new Option(label, value));
      const content = document.createElement("div"); content.className = "callout-content";
      header.append(glyph, kind, title, fold); dom.append(header, content);
      const change = (attrs: Record<string, unknown>) => {
        const pos = getPos();
        if (!editor.isEditable || pos === undefined) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
      };
      kind.onchange = () => change({ kind: kind.value });
      title.oninput = () => change({ title: title.value });
      title.onkeydown = event => {
        // Enter moves on to the body, as it would after a heading.
        // Focus moves at once, so the next keys typed land in the body.
        if (event.key === "Enter") {
          event.preventDefault();
          const pos = getPos();
          if (pos === undefined) return;
          editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 2))));
          editor.view.focus();
        }
      };
      fold.onchange = () => change({ fold: fold.value });
      function sync() {
        const { kind: name, fold: folding, title: text } = current.attrs;
        const [look, symbol] = lookOf(name);
        dom.className = `callout callout-${look} write-callout`;
        dom.dataset.callout = name;
        glyph.innerHTML = icon(symbol);
        // The type as written keeps its spelling; an alias or unknown type
        // is offered first, as itself.
        if (kind.dataset.options !== name) {
          const names = types.map(([type]) => type);
          const known = names.includes(name.toLowerCase());
          kind.replaceChildren(...(known ? [] : [new Option(capitalised(name), name)]),
            ...names.map(type => new Option(capitalised(type), type === name.toLowerCase() ? name : type)));
          kind.dataset.options = name;
        }
        kind.value = name;
        if (document.activeElement !== title) title.value = text;
        title.placeholder = capitalised(name);
        fold.value = folding;
        for (const control of [kind, title, fold]) control.disabled = !editor.isEditable;
      }
      sync();
      if (titleNext) { titleNext = false; requestAnimationFrame(() => title.focus()); }
      return {
        dom, contentDOM: content,
        stopEvent: event => header.contains(event.target as globalThis.Node),
        ignoreMutation: mutation => header.contains(mutation.target),
        update(next) { if (next.type !== current.type) return false; current = next; sync(); return true; },
      };
    };
  },
});
