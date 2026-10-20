import type { RichEditor } from "./types.js";
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type FileUrl = (src: string) => string | null;
interface RichOptions {
  onChange(body: string): void;
  onSelection?(): void;
  onWarning(message: string): void;
  onWiki(raw: string): void;
  onFiles(files: File[]): void;
  fileUrl: FileUrl;
  imageFiles(transfer: DataTransfer | null): File[];
}

import { marked } from "marked";
import { Editor, Mark, Node, InputRule, markInputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { writingSettings } from "./preferences.js";

const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-wiki]",
        getAttrs: (el) => ({ raw: el.getAttribute("data-wiki") || "" }),
      },
    ];
  },
  renderHTML({ node }) {
    const raw = node.attrs.raw;
    const parts = raw.split("|");
    const label = parts[1] || parts[0];
    return [
      "span",
      {
        "data-wiki": raw,
        class: "wiki-link",
        title: raw,
        tabindex: "0",
        role: "link",
      },
      label,
    ];
  },
  renderText({ node }) {
    return `[[${node.attrs?.raw || ""}]]`;
  },
  markdownTokenName: "wikiLink",
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start: "[[",
    tokenize(src) {
      const match = /^\[\[([^\]\n]+)\]\]/.exec(src);
      if (match) return { type: "wikiLink", raw: match[0], text: match[1] };
    },
  },
  parseMarkdown(token) {
    return { type: "wikiLink", attrs: { raw: token.text } };
  },
  renderMarkdown(node) {
    return `[[${node.attrs?.raw || ""}]]`;
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\]\n]+)\]\]$/,
        handler: ({ range, match, commands }) => {
          commands.insertContentAt(range, {
            type: this.name,
            attrs: { raw: match[1] },
          });
        },
      }),
    ];
  },
});

// Highlight is ==marked text==, matching the preview's rules: exactly two
// equals signs, touching the text inside. A leading colour emoji such as 🔴
// is kept as the mark's colour and written back in front of the text.
const highlightPattern = /==(?!=)(🔴|🟠|🟡|🟢|🔵|🟣)?(?=\S)((?:[^=\n]|=(?!=))*?[^\s=])==(?!=)/gu;
const highlightAtStart = new RegExp("^" + highlightPattern.source, "u");
const highlightColours: Record<string, string> = {
  "🔴": "red", "🟠": "orange", "🟡": "yellow", "🟢": "green", "🔵": "blue", "🟣": "purple",
};
const Highlight = Mark.create({
  name: "highlight",
  // Outside bold, italic and links, so one highlight stays one piece.
  priority: 1001,
  addAttributes() {
    return { colour: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "mark", getAttrs: (el) => ({ colour: el.getAttribute("data-colour") || "" }) }];
  },
  renderHTML({ mark }) {
    const colour = mark.attrs.colour || "";
    const name = highlightColours[colour];
    return ["mark", { "data-colour": colour, class: name ? "hl-" + name : null }, 0];
  },
  markdownTokenName: "highlight",
  markdownTokenizer: {
    name: "highlight",
    level: "inline",
    start: "==",
    tokenize(src, _tokens, helpers) {
      const match = highlightAtStart.exec(src);
      if (!match) return undefined;
      return { type: "highlight", raw: match[0], colour: match[1] || "", tokens: helpers.inlineTokens(match[2]) };
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.applyMark("highlight", helpers.parseInline(token.tokens || []), { colour: token.colour || "" });
  },
  renderMarkdown(node, helpers) {
    return `==${node.attrs?.colour || ""}${helpers.renderChildren(node)}==`;
  },
  // Typing ==text== (or ==🟢text==) after a space or at a line start marks it.
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)(==(🔴|🟠|🟡|🟢|🔵|🟣)?([^=\s](?:[^=]*[^=\s])?)==)$/u,
        type: this.type,
        getAttributes: (match) => ({ colour: match[2] || "" }),
      }),
    ];
  },
});

// imageNode shows a picture through fileUrl while keeping the address the
// Markdown gives it, so saving writes back exactly what was there. Remote
// images, which fileUrl refuses, show as their description.
function imageNode(fileUrl: FileUrl) {
  return Node.create({
    name: "image",
    group: "inline",
    inline: true,
    atom: true,
    draggable: true,
    addAttributes() {
      return { src: { default: "" }, alt: { default: "" }, title: { default: null } };
    },
    parseHTML() {
      return [
        {
          tag: "[data-image-src]",
          getAttrs: (el) => ({
            src: el.getAttribute("data-image-src"),
            alt: el.getAttribute("data-image-alt") || "",
            title: el.getAttribute("title"),
          }),
        },
      ];
    },
    renderHTML({ node }) {
      const { src, alt, title } = node.attrs;
      const url = fileUrl(src);
      const data = { "data-image-src": src, "data-image-alt": alt, title };
      if (!url)
        return ["span", { ...data, class: "image-placeholder" }, `[image: ${alt || src}]`];
      return ["img", { ...data, src: url, alt, loading: "lazy" }];
    },
    renderText({ node }) {
      return node.attrs.alt;
    },
    markdownTokenName: "image",
    parseMarkdown(token) {
      return {
        type: "image",
        attrs: { src: token.href || "", alt: token.text || "", title: token.title || null },
      };
    },
    renderMarkdown(node) {
      const { src = "", alt = "", title } = node.attrs || {};
      const destination = /[\s()<>]/.test(src) ? `<${src}>` : src;
      const caption = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
      return `![${alt.replace(/([\\[\]])/g, "\\$1")}](${destination}${caption})`;
    },
  });
}

// The stock paragraph lifts a lone image out of its paragraph, expecting a
// block image; this image is inline, so it stays inside.
const ImageParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens || [];
    if (tokens.length === 1 && tokens[0].type === "image")
      return helpers.createNode("paragraph", undefined, helpers.parseInline(tokens));
    if (!this.parent) throw new Error("Missing paragraph Markdown parser");
    return this.parent(token, helpers);
  },
});

export function supportsRich(body: string) {
  // YAML (---) or TOML (+++) front matter, possibly after a byte order mark.
  if (/^\uFEFF?(---|\+\+\+)\r?\n/.test(body))
    return "Showing Markdown: Write would change this note's front matter.";
  let reason = "";
  marked.walkTokens(marked.lexer(body, { gfm: true }), (token) => {
    if (token.type === "html")
      reason = "Showing Markdown: Write would change the HTML in this note.";
    if (token.type === "def")
      reason =
        "Showing Markdown: Write would drop this note's reference-style link definitions.";
    if (token.type === "text" && !token.tokens && /!\[\[[^\]\n]+\]\]/.test(token.raw))
      reason = "Showing Markdown: Write would change this note's ![[…]] file embeds.";
    if (token.type === "text" && /\[\^[^\]]+\]|\^\[[^\]]+\]/.test(token.raw))
      reason = "Showing Markdown: Write would change this note's footnotes.";
    // Write keeps &amp;, &lt;, &gt; and &quot; but would show other named
    // references such as &copy; as literal text and save them escaped.
    if (
      token.type === "text" &&
      !token.tokens &&
      /&(?!(?:amp|lt|gt|quot);)[A-Za-z][A-Za-z0-9]*;/.test(token.raw)
    )
      reason =
        "Showing Markdown: Write would show codes such as &copy; as text instead of the symbol (©) and save them that way.";
  });
  if (/^\s*\[\^[^\]]+\]:/m.test(body))
    reason = "Showing Markdown: Write would change this note's footnotes.";
  if (/^ {0,3}>[ \t]*\[![^\]\s]+\]/m.test(body))
    reason = "Showing Markdown: Write would change this note's callouts.";
  // Write closes bold, italic, strikethrough and highlights before a wiki
  // link or image and reopens them after it, which would rewrite the text.
  const split = "Showing Markdown: Write would split formatting around a link or image in this note.";
  marked.walkTokens(marked.lexer(body, { gfm: true }), (token) => {
    if (["strong", "em", "del"].includes(token.type) && /\[\[|!\[/.test(token.raw)) reason = split;
    if (token.type === "text" || token.type === "paragraph")
      for (const match of token.raw.matchAll(highlightPattern))
        if (/\[\[|!\[/.test(match[2])) reason = split;
  });
  return reason;
}

export function createRich(
  element: HTMLElement,
  { onChange, onSelection, onWarning, onWiki, onFiles, fileUrl, imageFiles }: RichOptions,
): RichEditor {
  let editor: Editor | null = null,
    loading = false,
    last = "",
    currentId = "";
  function make(body: string) {
    editor?.destroy();
    element.replaceChildren();
    loading = true;
    last = body;
    editor = new Editor({
      element,
      injectCSS: false,
      content: body,
      contentType: "markdown",
      extensions: [
        StarterKit.configure({
          paragraph: false,
          link: {
            openOnClick: false,
            autolink: false,
            HTMLAttributes: { rel: "noopener noreferrer" },
          },
        }),
        Markdown.configure({
          markedOptions: { gfm: true },
          indentation: { style: "space", size: 2 },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false } }),
        Placeholder.configure({
          placeholder: "A thought, a list, the beginning of something…",
        }),
        ImageParagraph,
        WikiLink,
        Highlight,
        imageNode(fileUrl),
      ],
      editorProps: {
        attributes: { "aria-label": "WYSIWYG editor", spellcheck: String(writingSettings.spellcheck) },
        handlePaste(view, event) {
          const files = imageFiles(event.clipboardData);
          if (files.length) {
            onFiles(files);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain") || "";
          if (
            new TextEncoder().encode(text).length > 1048576 ||
            text.split("\n").length + last.split("\n").length - 1 > 10000
          ) {
            onWarning(
              "Paste rejected: up to 1 MiB per paste and 10,000 lines per note.",
            );
            return true;
          }
          return false;
        },
        handleDrop(view, event, slice, moved) {
          const files = moved ? [] : imageFiles(event.dataTransfer);
          if (!files.length) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (at) editor?.commands.setTextSelection(at.pos);
          onFiles(files);
          return true;
        },
        handleClick(view, pos, event) {
          const target = event.target instanceof Element ? event.target : null;
          const link = target?.closest<HTMLElement>("[data-wiki]");
          if (link) {
            onWiki(link.dataset.wiki || "");
            return true;
          }
          const anchor = target?.closest<HTMLAnchorElement>("a[href]");
          if (anchor) {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
              const url = new URL(anchor.href, location.href);
              if (["http:", "https:", "mailto:"].includes(url.protocol))
                window.open(url.href, "_blank", "noopener,noreferrer");
            }
            return true;
          }
          return false;
        },
      },
      onUpdate({ editor }) {
        if (loading) return;
        const body = editor.getMarkdown();
        if (
          new TextEncoder().encode(body).length > 4 * 1048576 ||
          body.split("\n").length > 10000
        ) {
          loading = true;
          editor.commands.setContent(last, {
            contentType: "markdown",
            emitUpdate: false,
          });
          loading = false;
          onWarning(
            "Edit rejected: notes support up to 10,000 lines and 4 MiB.",
          );
          return;
        }
        last = body;
        onChange(body);
      },
      onSelectionUpdate() {
        onSelection?.();
      },
      onTransaction() {
        onSelection?.();
      },
    });
    loading = false;
  }
  // Tiptap's task checkbox builds its transaction and then focuses the
  // editor, which in WebKit moves the selection first and leaves that
  // transaction stale. Toggling here, before its listener, avoids that.
  element.addEventListener(
    "change",
    (event) => {
      const box = event.target;
      const item = box instanceof HTMLInputElement && box.type === "checkbox" && box.closest("li[data-checked]");
      if (!item || !editor) return;
      event.stopImmediatePropagation();
      if (!editor.isEditable) {
        box.checked = !box.checked;
        return;
      }
      const pos = editor.view.posAtDOM(item, 0) - 1;
      const node = editor.state.doc.nodeAt(pos);
      if (node?.type.name !== "taskItem") return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: box.checked }),
      );
    },
    true,
  );
  return {
    set(body, id) {
      if (!editor || currentId !== id) {
        currentId = id;
        make(body);
      } else if (last !== body) {
        loading = true;
        editor.commands.setContent(body, {
          contentType: "markdown",
          emitUpdate: false,
        });
        last = body;
        loading = false;
      }
    },
    focus() {
      // Focus now: Tiptap's focus command waits for the next frame, and a
      // late frame could take focus back after the user moved on, sending
      // what they type in the search box into the note.
      if (editor && !editor.isDestroyed) editor.view.focus();
    },
    get editor() {
      return editor;
    },
    spellcheck(value) {
      if (!editor) return;
      editor.setOptions({editorProps: {
        ...editor.options.editorProps,
        attributes: {...editor.options.editorProps.attributes, spellcheck: String(value)},
      }});
    },
    insertImage(src, alt) {
      editor
        ?.chain()
        .focus()
        .insertContent({ type: "image", attrs: { src, alt } })
        .run();
    },
    insertWiki(raw) {
      editor
        ?.chain()
        .focus()
        .insertContent({ type: "wikiLink", attrs: { raw } })
        .run();
    },
    command(name, value) {
      if (!editor) return;
      const chain = editor.chain().focus();
      switch (name) {
        case "bold":
          chain.toggleBold().run();
          break;
        case "italic":
          chain.toggleItalic().run();
          break;
        case "strike":
          chain.toggleStrike().run();
          break;
        // Choosing the colour already applied removes the highlight.
        case "highlight":
          if (editor.isActive("highlight", { colour: value || "" })) chain.unsetMark("highlight").run();
          else chain.setMark("highlight", { colour: value || "" }).run();
          break;
        case "code":
          chain.toggleCode().run();
          break;
        case "bulletList":
          chain.toggleBulletList().run();
          break;
        case "orderedList":
          chain.toggleOrderedList().run();
          break;
        case "taskList":
          chain.toggleTaskList().run();
          break;
        case "blockquote":
          chain.toggleBlockquote().run();
          break;
        case "table":
          chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case "block":
          if (value === "p") chain.setParagraph().run();
          else if (value && /^h[1-6]$/.test(value))
            chain.setHeading({ level: Number(value[1]) as HeadingLevel }).run();
          break;
        case "link":
          if (value)
            chain.extendMarkRange("link").setLink({ href: value }).run();
          else chain.unsetLink().run();
          break;
        case "undo":
          chain.undo().run();
          break;
        case "redo":
          chain.redo().run();
          break;
      }
    },
    destroy() {
      editor?.destroy();
      editor = null;
    },
  };
}
