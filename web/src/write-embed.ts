import type { NodeViewRendererProps } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { api } from "./api.js";
import { hydrateWebEmbeds } from "./web-embeds.js";

// Content stays read-only; editing its source is one explicit undoable change.
export function embedView({ node, editor, getPos }: NodeViewRendererProps, render: (raw: string) => Promise<string>): NodeView {
  let current = node, generation = 0, destroyed = false, applying = false;
  const dom = document.createElement("span");
  dom.className = "note-embed";
  dom.contentEditable = "false";
  const head = document.createElement("span");
  head.className = "note-embed-head";
  const title = document.createElement("span");
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "write-embed-edit";
  edit.textContent = "Edit embed";
  edit.setAttribute("aria-expanded", "false");
  const body = document.createElement("span");
  body.className = "note-embed-body preview-content";
  const panel = document.createElement("span");
  panel.className = "write-embed-panel";
  panel.hidden = true;
  const field = (name: string) => {
    const label = document.createElement("label");
    label.textContent = name;
    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    label.append(input);
    panel.append(label);
    return input;
  };
  const target = field("Embed target or URL");
  const label = field("Embed label (optional)");
  const hint = document.createElement("small");
  hint.textContent = "A note or file path, a Note#Heading, or an HTTP/HTTPS URL. Changing a web embed waits for Load again.";
  const error = document.createElement("span");
  error.className = "write-footnote-error";
  error.setAttribute("role", "alert");
  const actions = document.createElement("span");
  actions.className = "write-footnote-actions";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "primary-button";
  apply.textContent = "Apply";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.textContent = "Cancel";
  actions.append(apply, cancel);
  panel.append(hint, error, actions);
  head.append(title, edit);
  dom.append(head, body, panel);

  function parts() {
    const raw = current.attrs.raw as string;
    const pipe = raw.indexOf("|");
    const before = pipe < 0 ? raw : raw.slice(0, pipe);
    const escapedPipe = pipe >= 0 && before.endsWith("\\");
    return { before, escapedPipe, target: (escapedPipe ? before.slice(0, -1) : before).trim(), label: pipe < 0 ? "" : raw.slice(pipe + 1) };
  }
  function close() {
    panel.hidden = true;
    edit.setAttribute("aria-expanded", "false");
    edit.focus();
  }
  function open() {
    if (!editor.isEditable || applying) return;
    const source = parts();
    target.value = source.target;
    label.value = source.label;
    error.textContent = "";
    target.removeAttribute("aria-invalid");
    label.removeAttribute("aria-invalid");
    panel.hidden = false;
    edit.setAttribute("aria-expanded", "true");
    target.focus();
    target.select();
    panel.scrollIntoView({ block: "nearest" });
  }
  async function commit() {
    if (!editor.isEditable || applying) return;
    const source = parts();
    if (target.value === source.target && label.value === source.label) { close(); return; }
    if (/[\[\]\r\n]/.test(label.value)) {
      error.textContent = "Labels cannot contain brackets or line breaks.";
      label.setAttribute("aria-invalid", "true");
      label.focus();
      return;
    }
    const nextTarget = target.value.trim();
    const rawTarget = nextTarget === source.target
      ? source.before.slice(0, source.escapedPipe && !label.value ? -1 : undefined)
      : nextTarget + (source.escapedPipe && label.value ? "\\" : "");
    const raw = rawTarget + (label.value ? "|" + label.value : "");
    const version = generation;
    applying = true;
    apply.disabled = true;
    target.readOnly = label.readOnly = true;
    error.textContent = "";
    target.removeAttribute("aria-invalid");
    label.removeAttribute("aria-invalid");
    try {
      // Validation is local, works with remote loading off, and shares the
      // server's URL checks. It never fetches the destination.
      await api("/api/embed-target", "POST", { body: nextTarget });
      if (destroyed || version !== generation || panel.hidden || !editor.isEditable) return;
      const pos = getPos();
      if (pos === undefined) return;
      editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, raw }));
      editor.view.dispatch(closeHistory(editor.state.tr));
      close();
    } catch (reason) {
      if (!destroyed && version === generation && !panel.hidden) {
        error.textContent = reason instanceof Error ? reason.message : "Could not validate this embed. Try again.";
        target.setAttribute("aria-invalid", "true");
        target.focus();
      }
    } finally {
      applying = false;
      editable();
    }
  }
  edit.onclick = () => panel.hidden ? open() : close();
  edit.onkeydown = event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey || event.key.toLowerCase() === "y") editor.commands.redo();
      else editor.commands.undo();
    }
  };
  apply.onclick = commit;
  cancel.onclick = close;
  panel.onkeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Enter" && (event.target === target || event.target === label || event.ctrlKey || event.metaKey)) {
      event.preventDefault(); void commit();
    }
  };
  function sync() {
    const raw = current.attrs.raw as string;
    dom.dataset.embed = raw;
    const web = /^https?:\/\//i.test(raw.trim());
    dom.classList.toggle("note-embed-web", web);
    title.replaceChildren();
    if (!web) {
      const link = document.createElement("span");
      link.dataset.wiki = raw;
      link.className = "wiki-link";
      link.setAttribute("role", "link");
      link.tabIndex = 0;
      link.title = "Open " + raw.split("|")[0];
      link.textContent = raw.split("|")[0];
      title.append("Embedded · ", link);
    }
    const version = ++generation;
    // Replacing the content also detaches old frames. Render only creates
    // placeholders; changing the target and Undo never replay Load consent.
    body.textContent = "…";
    render(raw).then(html => {
      if (destroyed || version !== generation) return;
      body.innerHTML = html;
      hydrateWebEmbeds(body);
    }).catch(() => { if (!destroyed && version === generation) body.textContent = `![[${raw}]]`; });
  }
  function editable() {
    edit.disabled = !editor.isEditable;
    target.readOnly = label.readOnly = applying || !editor.isEditable;
    apply.disabled = applying || !editor.isEditable;
  }
  sync();
  editable();
  return {
    dom,
    stopEvent: event => panel.contains(event.target as globalThis.Node) || edit.contains(event.target as globalThis.Node),
    ignoreMutation: () => true,
    update(next) {
      if (next.type !== current.type) return false;
      const changed = next.attrs.raw !== current.attrs.raw;
      current = next;
      if (changed) { panel.hidden = true; edit.setAttribute("aria-expanded", "false"); sync(); }
      editable();
      return true;
    },
    destroy() { destroyed = true; generation++; },
  };
}
