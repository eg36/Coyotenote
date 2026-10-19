import { marked } from "marked";
import { Editor, Node, InputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";

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
    return `[[${node.attrs.raw}]]`;
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
    return `[[${node.attrs.raw}]]`;
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\]\n]+)\]\]$/,
        handler: ({ range, match, commands }) =>
          commands.insertContentAt(range, {
            type: this.name,
            attrs: { raw: match[1] },
          }),
      }),
    ];
  },
});

export function supportsRich(body) {
  if (/^---\r?\n/.test(body))
    return "This note has front matter. Use Markdown to keep it intact.";
  let reason = "";
  marked.walkTokens(marked.lexer(body, { gfm: true }), (token) => {
    if (token.type === "html")
      reason = "This note has raw HTML. Use Markdown to keep it intact.";
    if (token.type === "image")
      reason =
        "This note references an image. Use Markdown to keep its reference intact; images are not fetched.";
    if (token.type === "text" && /\[\^[^\]]+\]/.test(token.raw))
      reason = "This note has footnotes. Use Markdown to keep them intact.";
  });
  if (/^\s*\[\^[^\]]+\]:/m.test(body))
    reason = "This note has footnotes. Use Markdown to keep them intact.";
  return reason;
}

export function createRich(
  element,
  { onChange, onSelection, onWarning, onWiki },
) {
  let editor = null,
    loading = false,
    last = "",
    currentId = "";
  function make(body) {
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
        WikiLink,
      ],
      editorProps: {
        attributes: { "aria-label": "WYSIWYG editor", spellcheck: "true" },
        handlePaste(view, event) {
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
        handleClick(view, pos, event) {
          const link = event.target.closest("[data-wiki]");
          if (link) {
            onWiki(link.dataset.wiki);
            return true;
          }
          const anchor = event.target.closest("a[href]");
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
          value === "p"
            ? chain.setParagraph().run()
            : chain.setHeading({ level: Number(value[1]) }).run();
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
