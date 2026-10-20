import { Extension } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

// Write saves a whole note at once, and its Markdown writer has one style
// (- bullets, ``` fences, # headings, --- rules, padded tables). Each top-level
// block therefore remembers the Markdown it was read from, and a fingerprint
// of what it looked like then. While a block is unchanged, saving writes that
// Markdown back as it was; only blocks someone edits are written anew.
const types = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "taskList", "codeBlock", "horizontalRule", "table"];

export const SourceBlocks = Extension.create({
  name: "sourceBlocks",
  addGlobalAttributes() {
    const kept = { default: null, rendered: false, keepOnSplit: false };
    return [{ types, attributes: { source: kept, sourceKey: kept, sourceIndex: kept, sourceGap: kept } }];
  },
});

function fingerprint(node: JSONContent) {
  const text = JSON.stringify(node, (key, value) => key === "source" || key === "sourceKey" ? undefined : value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}

// The text that separated two blocks when the note was read, while they are
// still neighbours; blank lines kept as empty paragraphs between them are
// part of that text.
export function sourceGap(previous: JSONContent | undefined, next: JSONContent | undefined) {
  const gap = previous?.attrs?.sourceGap, index = previous?.attrs?.sourceIndex;
  return typeof gap === "string" && typeof index === "number" && next?.attrs?.sourceIndex === index + 1 ? gap : undefined;
}

// The Markdown an unchanged block was read from, if it is still unchanged.
export function pristine(node: JSONContent) {
  const source = node.attrs?.source;
  return typeof source === "string" && node.attrs?.sourceKey === fingerprint(node) ? source : undefined;
}

// After a note loads, fingerprint each block that remembers its Markdown, as
// the editor holds it (with every default attribute), outside undo history.
export function stampSources(editor: Editor) {
  const tr = editor.state.tr;
  editor.state.doc.forEach((node, offset) => {
    if (typeof node.attrs.source !== "string") return;
    tr.setNodeMarkup(offset, undefined, { ...node.attrs, sourceKey: fingerprint(node.toJSON()) });
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}

// Top-level tokens become top-level blocks; each takes its token's Markdown,
// without the line breaks that separate it from the next block.
type Parser = { parseTokens(tokens: { raw?: string; type?: string }[], top?: boolean): JSONContent[]; parseToken(token: { raw?: string; type?: string }, top?: boolean): JSONContent | JSONContent[] | null };
const proto = MarkdownManager.prototype as unknown as Parser;
const parseTokens = proto.parseTokens;
proto.parseTokens = function (this: Parser & { readingSource?: boolean }, tokens, top) {
  if (!top || this.readingSource) return parseTokens.call(this, tokens, top);
  const parseToken = proto.parseToken;
  const read: { node?: JSONContent; raw: string }[] = [];
  let depth = 0;
  this.readingSource = true;
  this.parseToken = (token, implicit) => {
    depth++;
    try {
      const parsed = parseToken.call(this, token, implicit);
      const node = Array.isArray(parsed) ? (parsed.length === 1 ? parsed[0] : undefined) : parsed;
      if (depth === 1 && token.raw) {
        const kept = node && types.includes(node.type || "") ? node : undefined;
        if (kept) kept.attrs = { ...kept.attrs, source: token.raw.replace(/(?:\n[ \t]*)+$/, "") };
        read.push({ node: kept, raw: token.raw });
      }
      return parsed;
    } finally { depth--; }
  };
  try {
    const nodes = parseTokens.call(this, tokens, top);
    // Number the blocks in reading order and note the text after each one.
    const source = tokens.map(token => token.raw || "").join("");
    let at = 0;
    const found = read.map(({ node, raw }) => {
      const start = source.indexOf(raw, at);
      if (start >= 0) at = start + raw.length;
      return { node, start };
    });
    found.forEach(({ node, start }, i) => {
      const next = found[i + 1];
      if (!node || start < 0) return;
      const end = start + String(node.attrs?.source).length;
      node.attrs = { ...node.attrs, sourceIndex: i, sourceGap: next && next.start >= end ? source.slice(end, next.start) : null };
    });
    return nodes;
  } finally { delete (this as Partial<Parser>).parseToken; this.readingSource = false; }
};
