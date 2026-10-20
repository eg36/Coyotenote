import { Extension, Node } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

// Write reads Markdown into a document and writes the document back. These
// pieces make edited text come back as it was written: escapes, entities,
// the delimiters chosen for emphasis and code, autolinks and line breaks.

// A backslash escape or a character reference shows as its character and is
// saved as written, so \# stays \# and &amp; stays &amp;.
function literal(name: string, start: string, pattern: RegExp, shown: (raw: string) => string) {
  return Node.create({
    name, group: "inline", inline: true, atom: true,
    addAttributes() { return { raw: { default: "" } }; },
    parseHTML() { return [{ tag: `span[data-${name}]`, getAttrs: el => ({ raw: el.getAttribute(`data-${name}`) }) }]; },
    renderHTML({ node }) { return ["span", { [`data-${name}`]: node.attrs.raw }, shown(node.attrs.raw)]; },
    renderText({ node }) { return shown(node.attrs.raw); },
    markdownTokenName: name,
    markdownTokenizer: {
      name, level: "inline", start,
      tokenize(source) { const raw = pattern.exec(source)?.[0]; if (raw) return { type: name, raw }; },
    },
    parseMarkdown(token) { return { type: name, attrs: { raw: token.raw } }; },
    renderMarkdown(node) { return node.attrs?.raw || ""; },
  });
}
function referenced(raw: string) {
  const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' };
  if (named[raw]) return named[raw];
  const code = raw[2] === "x" || raw[2] === "X" ? parseInt(raw.slice(3), 16) : parseInt(raw.slice(2), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
}
export const EscapedChar = literal("escapedChar", "\\", /^\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/, raw => raw.slice(1));
export const CharacterReference = literal("characterReference", "&", /^&(?:amp|lt|gt|quot|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});/, referenced);

// How each mark or break was written. The editor ignores these; only the
// Markdown writer reads them.
export const WrittenStyle = Extension.create({
  name: "writtenStyle",
  addGlobalAttributes() {
    const kept = { default: null, rendered: false };
    return [
      { types: ["bold", "italic", "strike", "code", "link"], attributes: { written: kept } },
      { types: ["hardBreak", "bulletList", "orderedList", "listItem", "codeBlock", "heading", "horizontalRule", "table"], attributes: { written: kept } },
    ];
  },
});

type Token = { type?: string; raw?: string; text?: string; href?: string };
function writtenFor(token: Token) {
  const raw = token.raw || "";
  switch (token.type) {
    case "strong": return raw.startsWith("__") ? "__" : "**";
    case "em": return raw[0] === "_" ? "_" : "*";
    case "del": return raw.startsWith("~~") ? "~~" : "~";
    case "codespan": {
      const fence = /^`+/.exec(raw)?.[0] || "`";
      const inner = raw.slice(fence.length, raw.length - fence.length);
      return inner === token.text ? fence : inner === ` ${token.text} ` ? fence + " " : null;
    }
    case "link": return raw.startsWith("[") ? null : raw;
    case "br": return raw;
  }
  return null;
}

// The opening and closing Markdown for a mark as it was written, while that
// still reads back the same; otherwise the writer's own choice.
function writtenMark(type: string, written: unknown, text: string): [string, string] | undefined {
  if (typeof written !== "string") return undefined;
  if (["bold", "italic", "strike"].includes(type)) return [written, written];
  if (type === "code") {
    const fence = written.trimEnd(), pad = written.length > fence.length ? " " : "";
    const runs = new Set((text.match(/`+/g) || []).map(run => run.length));
    if (runs.has(fence.length) || (!pad && (text.startsWith("`") || text.endsWith("`")))) return undefined;
    return [fence + pad, pad + fence];
  }
  if (type === "link") {
    if (written === `<${text}>`) return ["<", ">"];
    if (written === text) return ["", ""];
  }
  return undefined;
}

type Manager = {
  getHandlerForToken(type: string): { parseMarkdown?: (token: Token, helpers: unknown) => unknown } | undefined;
  getMarkOpening(type: string, mark: { attrs?: Record<string, unknown> }, mode?: string, text?: string): string;
  getMarkClosing(type: string, mark: { attrs?: Record<string, unknown> }, mode?: string, text?: string): string;
  renderNodeToMarkdown(node: JSONContent, parent?: JSONContent, index?: number, level?: number, meta?: object): string;
  renderNodesWithMarkBoundaries(nodes: JSONContent[], parent?: JSONContent, separator?: string, level?: number): string;
  encodeTextForMarkdown(text: string, node: JSONContent, parent?: JSONContent): string;
  applyMarkToContent(type: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent[];
  parse(markdown: string): JSONContent;
};
const proto = MarkdownManager.prototype as unknown as Manager;

// How a list, code block, heading or rule was written: its bullet or number
// delimiter, fence, underline or closing hashes, or the rule itself.
type Block = Token & { ordered?: boolean; items?: Token[]; depth?: number; lang?: string };
function blockWritten(token: Block) {
  const raw = token.raw || "", first = raw.split("\n")[0];
  switch (token.type) {
    case "list": return /^ *(?:[-+*]|\d+([.)]))/.exec(first)?.[1] ?? /^ *([-+*])/.exec(first)?.[1] ?? null;
    case "code": return /^ {0,3}(`{3,}|~{3,})/.exec(first)?.[1] ?? (/^(?: {4}|\t)/.test(first) ? "indented" : null);
    case "heading": {
      const underline = /\n *(=+|-+) *$/.exec(raw.trimEnd());
      if (underline && !first.trimStart().startsWith("#")) return underline[0].slice(1);
      return /[ \t]+#+[ \t]*$/.exec(first)?.[0] ?? null;
    }
    case "hr": return first.trim();
    case "table": return raw.replace(/(?:\n[ \t]*)+$/, "");
  }
  return null;
}
type BlockHandler = { parseMarkdown?: (token: Block, helpers: unknown) => unknown };
const blockHandlersFor = (proto as unknown as { getHandlersForToken(type: string): BlockHandler[] }).getHandlersForToken;
(proto as unknown as { getHandlersForToken(type: string): BlockHandler[] }).getHandlersForToken = function (type) {
  const handlers = blockHandlersFor.call(this, type);
  if (!["list", "code", "heading", "hr", "table"].includes(type)) return handlers;
  return handlers.map(handler => !handler.parseMarkdown ? handler : { ...handler, parseMarkdown(token: Block, helpers: unknown) {
    const result = handler.parseMarkdown!.call(handler, token, helpers) as JSONContent | JSONContent[] | null;
    const written = blockWritten(token);
    const node = Array.isArray(result) ? result[0] : result;
    if (node && written !== null) node.attrs = { ...node.attrs, written };
    // Whether a blank line follows each item, as in a loose list.
    if (node && token.items && node.content?.length === token.items.length)
      node.content.forEach((item, i) => {
        if (item.type === "listItem") item.attrs = { ...item.attrs, written: /\n[ \t]*\n$/.test(token.items![i].raw || "") ? "\n\n" : "\n" };
      });
    return result;
  } });
};

// Writing a block as it was written, when its content still allows that.
function writtenBlock(node: JSONContent, parent: JSONContent | undefined, markdown: string) {
  const written = node.attrs?.written;
  if (node.type === "listItem" && typeof parent?.attrs?.written === "string") {
    const marker = parent.attrs.written;
    if (parent.type === "bulletList" && /^[*+]$/.test(marker)) return markdown.replace(/^- /, marker + " ");
    if (parent.type === "orderedList" && marker === ")") return markdown.replace(/^(\d+)\. /, "$1) ");
    return markdown;
  }
  if (typeof written !== "string") return markdown;
  const text = String(node.content?.map(child => child.text || "").join("") ?? "");
  if (node.type === "horizontalRule") return written;
  if (node.type === "codeBlock" && written === "indented" && !node.attrs?.language)
    return text.split("\n").map(line => line ? "    " + line : line).join("\n");
  if (node.type === "codeBlock" && /^(`{3,}|~{3,})$/.test(written)) {
    // A longer or different fence inside the code would end it early.
    if (text.split("\n").some(line => line.trim().startsWith(written[0].repeat(3)) && line.trim().length >= written.length)) return markdown;
    return markdown.replace(/^`{3,}/, written).replace(/`{3,}$/, written);
  }
  if (node.type === "heading" && /^[=-]+$/.test(written.trim())) {
    const level = written.trim()[0] === "=" ? 1 : 2;
    const line = markdown.replace(/^#+ /, "");
    return node.attrs?.level === level && !line.includes("\n") && line.trim() ? `${line}\n${written}` : markdown;
  }
  if (node.type === "heading") return markdown + written;
  return markdown;
}

// Reading: remember how each mark and break was written.
const handlerFor = proto.getHandlerForToken;
proto.getHandlerForToken = function (type) {
  const handler = handlerFor.call(this, type);
  if (!handler?.parseMarkdown || !["strong", "em", "del", "codespan", "link", "br"].includes(type)) return handler;
  const parse = handler.parseMarkdown;
  return { ...handler, parseMarkdown(token: Token, helpers: unknown) {
    const result = parse.call(handler, token, helpers) as { mark?: string; attrs?: Record<string, unknown>; type?: string } | null;
    const written = writtenFor(token);
    if (result && written !== null) result.attrs = { ...result.attrs, written };
    return result;
  } };
};

// Writing has three modes. "exact" writes text as it is and marks as they
// were written; "careful" also escapes characters that could start
// formatting; "plain" is the writer's own escaping and delimiters.
let mode: "exact" | "careful" | "plain" = "plain";
const opening = proto.getMarkOpening, closing = proto.getMarkClosing;
proto.getMarkOpening = function (type, mark, openingMode = "markdown", text = "") {
  const written = mode !== "plain" && openingMode === "markdown" && writtenMark(type, mark.attrs?.written, text);
  return written ? written[0] : opening.call(this, type, mark, openingMode, text);
};
proto.getMarkClosing = function (type, mark, openingMode = "markdown", text = "") {
  const written = mode !== "plain" && openingMode === "markdown" && writtenMark(type, mark.attrs?.written, text);
  return written ? written[1] : closing.call(this, type, mark, openingMode, text);
};
const renderNode = proto.renderNodeToMarkdown;
proto.renderNodeToMarkdown = function (node, parent, index, level, meta) {
  const written = node.attrs?.written;
  if (node.type === "hardBreak" && written === "\n") return written;
  if (mode !== "plain" && node.type === "hardBreak" && typeof written === "string" && /^(?: {2,}|\\)\n$/.test(written)) return written;
  // The table writer pads every column and surrounds the table with line
  // breaks of its own; rows that did not change keep their line instead.
  if (node.type === "table") return writtenTable.call(this, node) ?? renderNode.call(this, node, parent, index, level, meta).replace(/^\n+|\n+$/g, "");
  // The writer puts list items on consecutive lines; keep blank lines that
  // separated them.
  if (["bulletList", "orderedList"].includes(node.type || "") && node.content?.some(item => item.attrs?.written === "\n\n"))
    return node.content.map((item, i) => (i ? node.content![i - 1].attrs?.written === "\n\n" ? "\n\n" : "\n" : "")
      + proto.renderNodeToMarkdown.call(this, item, node, i, (level || 0) + 1)).join("");
  return writtenBlock(node, parent, renderNode.call(this, node, parent, index, level, meta));
};
const encode = proto.encodeTextForMarkdown;
proto.encodeTextForMarkdown = function (text, node, parent) {
  if (mode === "plain" || parent?.type === "codeBlock" || node.marks?.some(mark => mark.type === "code")) return encode.call(this, text, node, parent);
  if (mode === "exact") return text;
  return text.replace(/\\(?=[!-/:-@[-`{-~]|$)/g, "\\\\").replace(/[`*~[\]]/g, "\\$&")
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, match => match.replace("_", "\\_"))
    .replace(/<(?=[A-Za-z/!?])/g, "\\<").replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&");
};

// A table as written: its delimiter row and every row whose cells still read
// the same keep their line; changed or new rows are written without padding.
function cellsOf(line: string) {
  return line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map(cell => cell.trim());
}
function writtenTable(this: Manager, node: JSONContent) {
  const written = node.attrs?.written;
  if (typeof written !== "string") return undefined;
  const lines = written.split("\n"), rows = node.content || [];
  const columns = cellsOf(lines[1] || "").length;
  const out: string[] = [];
  for (const [r, row] of rows.entries()) {
    const cells = (row.content || []).map(cell => {
      const text = (cell.content || []).map(block => proto.renderNodeToMarkdown.call(this, block, cell)).join(" ").trim();
      return text.replace(/(?<!\\)\|/g, "\\|");
    });
    if (cells.length !== columns) return undefined;
    const line = lines[r === 0 ? 0 : r + 1];
    out.push(line !== undefined && JSON.stringify(cellsOf(line)) === JSON.stringify(cells) ? line : `| ${cells.join(" | ")} |`);
  }
  return [out[0], lines[1], ...out.slice(1)].join("\n");
}

// Formulas and literal characters inside formatting go through the text
// path as placeholders, because the writer would otherwise close and reopen
// bold, italic, links and highlights around them; the reader likewise gives
// marks only to text, so **$x$** would lose its bold.
const textLike = new Set(["inlineMath", "escapedChar", "characterReference"]);
const applyMark = proto.applyMarkToContent;
proto.applyMarkToContent = function (type, content, attrs) {
  return applyMark.call(this, type, content, attrs).map((node, i) => !textLike.has(node.type || "") ? node
    : { ...node, content: undefined, marks: [...(content[i].marks || []), attrs ? { type, attrs } : { type }] });
};

// A line break inside a paragraph's text is a soft break: it shows as a
// break in Write and is saved as a plain line break, not as a hard break.
const parseInline = (proto as unknown as { parseInlineTokens(tokens: Token[]): JSONContent[] }).parseInlineTokens;
(proto as unknown as { parseInlineTokens(tokens: Token[]): JSONContent[] }).parseInlineTokens = function (tokens) {
  return parseInline.call(this, tokens).flatMap(node => {
    if (node.type !== "text" || !node.text?.includes("\n") || node.marks?.some(mark => mark.type === "code")) return [node];
    return node.text.split("\n").flatMap((text, i) => [
      ...(i ? [{ type: "hardBreak", attrs: { written: "\n" }, ...(node.marks ? { marks: node.marks } : {}) }] : []),
      ...(text ? [{ ...node, text }] : []),
    ]);
  });
};

// What a paragraph's inline content means, ignoring how it is written.
function meaning(this: Manager, nodes: JSONContent[]) {
  const runs: unknown[][] = [];
  for (const node of nodes) {
    const marks = (node.marks || []).map(mark => {
      const { href, colour, title } = (mark.attrs || {}) as Record<string, unknown>;
      return mark.type + JSON.stringify([href ?? null, colour || null, title ?? null]);
    }).sort().join(",");
    const last = runs.at(-1);
    // An escaped character or a reference means the character itself.
    const raw = String(node.attrs?.raw || "");
    const text = node.type === "escapedChar" ? raw.slice(1) : node.type === "characterReference" ? referenced(raw) : node.text || "";
    const isText = ["text", "escapedChar", "characterReference"].includes(node.type || "");
    if (isText && last?.[0] === "text" && last[2] === marks) last[1] += text;
    else if (isText) runs.push(["text", text, marks]);
    else if (node.type === "hardBreak") runs.push([node.type, "", marks]);
    else runs.push([node.type, renderNode.call(this, node), marks]);
  }
  return JSON.stringify(runs);
}
const readsBack = new Map<string, boolean>();
function sameMeaning(this: Manager, markdown: string, expected: string) {
  const key = expected + "\u0000" + markdown;
  let same = readsBack.get(key);
  if (same === undefined) {
    const previous = mode;
    mode = "plain";
    try {
      const blocks = this.parse(markdown).content || [];
      same = blocks.length === 1 && blocks[0].type === "paragraph" && meaning.call(this, blocks[0].content || []) === expected;
    } catch { same = false; } finally { mode = previous; }
    if (readsBack.size > 5000) readsBack.clear();
    readsBack.set(key, same);
  }
  return same;
}

const renderWithMarks = proto.renderNodesWithMarkBoundaries;
proto.renderNodesWithMarkBoundaries = function (nodes, parent, separator, level) {
  const kept: string[] = [];
  const mapped = nodes.map(node => {
    if (!textLike.has(node.type || "") || !node.marks?.length) return node;
    kept.push(renderNode.call(this, node, parent, 0, level));
    return { type: "text", text: `\ue000${kept.length - 1}\ue001`, marks: node.marks };
  });
  const write = (as: typeof mode) => {
    const previous = mode;
    mode = as;
    try {
      const result = renderWithMarks.call(this, mapped, parent, separator, level);
      return kept.length ? result.replace(/\ue000(\d+)\ue001/g, (_, i: string) => kept[Number(i)]) : result;
    } finally { mode = previous; }
  };
  if (!["paragraph", "heading"].includes(parent?.type || "")) return write("plain");
  // Text is written as it is when that reads back the same; characters that
  // would start formatting are escaped only when they must be.
  const exact = write("exact");
  const expected = meaning.call(this, nodes);
  if (sameMeaning.call(this, exact, expected)) return exact;
  const careful = write("careful");
  if (careful !== exact && sameMeaning.call(this, careful, expected)) return fewestEscapes.call(this, careful, exact, expected);
  return write("plain");
};

// Careful writing escapes every character that could start formatting.
// Drop each added backslash that the text reads back the same without.
function fewestEscapes(this: Manager, careful: string, exact: string, expected: string) {
  const added: number[] = [];
  for (let i = 0, j = 0; i < careful.length; i++) {
    if (careful[i] === exact[j]) j++;
    else added.push(i);
  }
  if (added.length > 64) return careful;
  let text = careful;
  for (const at of added.reverse()) {
    const without = text.slice(0, at) + text.slice(at + 1);
    if (sameMeaning.call(this, without, expected)) text = without;
  }
  return text;
}
