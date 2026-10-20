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
    return [{ types, attributes: { source: kept, sourceKey: kept } }];
  },
});

function fingerprint(node: JSONContent) {
  const text = JSON.stringify(node, (key, value) => key === "source" || key === "sourceKey" ? undefined : value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
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
  let depth = 0;
  this.readingSource = true;
  this.parseToken = (token, implicit) => {
    depth++;
    try {
      const parsed = parseToken.call(this, token, implicit);
      const node = Array.isArray(parsed) ? (parsed.length === 1 ? parsed[0] : undefined) : parsed;
      if (depth === 1 && node && types.includes(node.type || "") && token.raw)
        node.attrs = { ...node.attrs, source: token.raw.replace(/(?:\n[ \t]*)+$/, "") };
      return parsed;
    } finally { depth--; }
  };
  try { return parseTokens.call(this, tokens, top); }
  finally { delete (this as Partial<Parser>).parseToken; this.readingSource = false; }
};
