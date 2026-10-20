import { InputRule, parseIndentedBlocks, renderNestedMarkdownContent } from "@tiptap/core";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";

const statuses = [[" ", "Open"], ["x", "Done"], ["?", "Question"], ["/", "In progress"], ["-", "Cancelled"], [">", "Deferred"], ["!", "Important"]];
const itemPattern = /^( *)([-+*])([ \t]+)\[([^\s[\]\\]| )\]([ \t]+)(.*)$/;

export const StatusTaskList = TaskList.extend({
  addAttributes() { return { after: { default: null, parseHTML: el => el.getAttribute("data-task-after"), renderHTML: attrs => ({ "data-task-after": attrs.after }) } }; },
  parseMarkdown(token, helpers) { return helpers.createNode("taskList", { after: token.after }, helpers.parseChildren(token.items || [])); },
  markdownTokenizer: {
    name: "taskList", level: "block",
    start: source => /^ *[-+*][ \t]+\[[^\n[\]\\]\][ \t]+/m.exec(source)?.index ?? -1,
    tokenize(source, _tokens, lexer) {
      const parse = (text: string): ReturnType<typeof parseIndentedBlocks> => parseIndentedBlocks(text, {
        itemPattern,
        extractItemData: match => ({ indentLevel: match[1].length, mainContent: match[6], marker: match[4], before: match[1] + match[2] + match[3] + "[", after: "]" + match[5] }),
        createToken: (data, nestedTokens) => ({ type: "taskItem", raw: "", ...data, text: data.mainContent, tokens: lexer.inlineTokens(data.mainContent), nestedTokens }),
        customNestedParser: nested => {
          const result = parse(nested);
          return result ? [{ type: "taskList", raw: result.raw, items: result.items }, ...lexer.blockTokens(nested.slice(result.raw.length))] : lexer.blockTokens(nested);
        },
      }, lexer);
      const result = parse(source);
      if (result) {
        const raw = result.raw.slice(0, source.length).replace(/\n$/, "");
        const after = /^\n(?:[ \t]*\n)*/.exec(source.slice(raw.length))?.[0] || "";
        return { type: "taskList", raw: raw + after, items: result.items, after };
      }
    },
  },
});

export const StatusTaskItem = TaskItem.extend({
  addAttributes() {
    return { ...this.parent?.(),
      marker: { default: null, keepOnSplit: false, parseHTML: el => el.getAttribute("data-marker"), renderHTML: attrs => ({ "data-marker": attrs.marker }) },
      before: { default: "- [", parseHTML: el => el.getAttribute("data-before") || "- [", renderHTML: attrs => ({ "data-before": attrs.before }) },
      after: { default: "] ", parseHTML: el => el.getAttribute("data-after") || "] ", renderHTML: attrs => ({ "data-after": attrs.after }) },
    };
  },
  parseMarkdown(token, helpers) {
    const content = [helpers.createNode("paragraph", {}, helpers.parseInline(token.tokens || [])), ...helpers.parseChildren(token.nestedTokens || [])];
    // Tasks read from a list that also holds plain bullets arrive with only
    // a checked state, not their marker.
    const marker = token.marker ?? (token.checked ? "x" : " ");
    return helpers.createNode("taskItem", { checked: /[xX]/.test(marker), marker, before: token.before, after: token.after }, content);
  },
  renderMarkdown(node, helpers) {
    return renderNestedMarkdownContent(node, helpers, `${node.attrs?.before || "- ["}${node.attrs?.marker ?? (node.attrs?.checked ? "x" : " ")}${node.attrs?.after || "] "}`);
  },
  addInputRules() {
    return [new InputRule({ find: /^\s*\[([^\s[\]\\]| )\]\s$/,
      handler: ({ range, match, chain }) => {
        const transaction = chain().deleteRange(range);
        if (!this.editor.isActive("taskList")) transaction.toggleTaskList();
        transaction.updateAttributes(this.name, { marker: match[1], checked: /[xX]/.test(match[1]) }).run();
      },
    })];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("li"); dom.dataset.type = "taskItem";
      const label = document.createElement("label"); label.contentEditable = "false";
      const box = document.createElement("input"); box.type = "checkbox";
      box.onmousedown = event => event.preventDefault();
      const select = document.createElement("select"); select.className = "write-task-status";
      for (const [mark, name] of statuses) {
        const option = document.createElement("option"); option.value = mark; option.textContent = `[${mark}] ${name}`; select.append(option);
      }
      const content = document.createElement("div");
      const sync = () => {
        const mark = current.attrs.marker ?? (current.attrs.checked ? "x" : " ");
        select.querySelectorAll("option[data-original]").forEach(option => option.remove());
        if (mark !== "X" && !statuses.some(([value]) => value === mark)) {
          const option = document.createElement("option"); option.value = mark; option.textContent = `[${mark}] Custom`; option.dataset.original = "true"; select.append(option);
        }
        dom.dataset.marker = mark; dom.dataset.checked = String(current.attrs.checked);
        dom.dataset.before = current.attrs.before; dom.dataset.after = current.attrs.after;
        box.checked = current.attrs.checked; box.hidden = !/[ xX]/.test(mark);
        const title = current.firstChild?.textContent || "empty task item";
        box.setAttribute("aria-label", `Task item checkbox for ${title}`);
        select.value = mark === "X" ? "x" : mark;
        select.disabled = !editor.isEditable;
        select.setAttribute("aria-label", `Task status for ${title}`);
        select.title = select.selectedOptions[0]?.textContent || "Task status";
      };
      select.onchange = () => {
        if (!editor.isEditable) { sync(); return; }
        const pos = getPos(); if (pos === undefined) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, marker: select.value, checked: select.value === "x" }));
      };
      label.append(box, select); dom.append(label, content); sync();
      return { dom, contentDOM: content,
        stopEvent: event => event.target === select,
        update(next) { if (next.type !== current.type) return false; current = next; sync(); return true; },
      };
    };
  },
});
