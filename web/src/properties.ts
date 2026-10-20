// A deliberately small YAML subset. Anything ambiguous stays in the raw editor.
// Ranges refer to the original text, so editing one value leaves other bytes alone.
export interface Property {
  key: string;
  kind: "text" | "list" | "number" | "checkbox" | "date" | "tags";
  value: string;
  start: number;
  end: number;
}
function scalar(raw: string): string | null {
  if (/^"(?:[^"\\]|\\["\\/bfnrt]|\\u[\da-fA-F]{4})*"$/.test(raw)) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  if (/^'(?:[^']|'')*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
  if (!raw || /^[\p{L}\p{N}_][\p{L}\p{N}_ .\/@-]*$/u.test(raw)) {
    if (/^(?:null|~|yes|no|on|off)$/i.test(raw)) return null;
    return raw;
  }
  return null;
}
export function parseProperties(inner: string): Property[] | null {
  const rows: Property[] = [], keys = new Set<string>();
  const linePattern = /[^\n]*(?:\n|$)/g;
  for (const match of inner.matchAll(linePattern)) {
    const line = match[0].replace(/\n$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const field = /^([A-Za-z_][\w-]*):([ \t]*)(.*)$/.exec(line);
    if (!field || keys.has(field[1])) return null;
    keys.add(field[1]);
    // Comments only begin outside a quoted scalar or flow list.
    const token = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|\[[^\]]*\]|[^#]*?)([ \t]+#.*|[ \t]*)$/.exec(field[3]);
    if (!token) return null;
    const raw = token[1].trimEnd();
    let value = scalar(raw), kind: Property["kind"] = "text";
    if (raw.startsWith("[")) {
      const items = raw.slice(1, -1).trim();
      // Commas in quoted values are valid YAML but use the raw editor here.
      const parts = items ? items.split(",").map(part => scalar(part.trim())) : [];
      if (parts.some(part => part === null)) return null;
      value = parts.join(", "); kind = "list";
    } else if (/^(true|false)$/i.test(raw)) { kind = "checkbox"; value = raw.toLowerCase(); }
    else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) kind = "number";
    else if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw))) kind = "date";
    if (value === null) return null;
    if (field[1].toLowerCase() === "tags" && (kind === "text" || kind === "list")) kind = "tags";
    const start = match.index! + field[1].length + 1 + field[2].length;
    rows.push({ key: field[1], kind, value, start, end: start + raw.length });
  }
  return rows;
}
export function replaceProperty(inner: string, row: Property, value: string): string {
  let encoded: string;
  if (row.kind === "checkbox") encoded = value === "true" ? "true" : "false";
  else if (row.kind === "number" || row.kind === "date") encoded = value;
  else if (row.kind === "list" || row.kind === "tags")
    encoded = "[" + value.split(",").map(item => item.trim()).filter(Boolean).map(item => JSON.stringify(item)).join(", ") + "]";
  else encoded = JSON.stringify(value);
  return inner.slice(0, row.start) + encoded + inner.slice(row.end);
}

let rawMode = false, noteId = "";
export function renderProperties(container: HTMLElement, inner: string, fence: string, id: string, editable: boolean, change: (text: string) => void) {
  if (noteId !== id) { rawMode = false; noteId = id; }
  const rows = fence === "---" ? parseProperties(inner) : null;
  let host = container.querySelector<HTMLElement>(".properties-rows");
  if (!host) { host = document.createElement("div"); host.className = "properties-rows"; container.append(host); }
  const raw = container.querySelector<HTMLTextAreaElement>("textarea")!;
  let toggle = container.querySelector<HTMLButtonElement>(".properties-toggle");
  if (!toggle) { toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "properties-toggle text-button"; container.insertBefore(toggle, raw); }
  toggle.hidden = rows === null;
  toggle.textContent = rawMode ? "Use fields" : "Edit YAML";
  toggle.onclick = () => { rawMode = !rawMode; renderProperties(container, raw.value, fence, id, editable, change); };
  raw.hidden = rows !== null && !rawMode;
  host.hidden = rows === null || rawMode;
  host.replaceChildren();
  for (const row of rows || []) {
    const label = document.createElement("label"); label.className = "property-row";
    const key = document.createElement("span"); key.textContent = row.key;
    const type = document.createElement("span"); type.className = "property-type"; type.textContent = row.kind;
    const input = document.createElement("input");
    input.type = row.kind === "checkbox" ? "checkbox" : row.kind === "number" ? "number" : row.kind === "date" ? "date" : "text";
    if (row.kind === "number") input.step = "any";
    input.value = row.value; input.checked = row.value === "true"; input.disabled = !editable;
    input.setAttribute("aria-label", row.key);
    if (row.kind === "tags" || row.kind === "list") input.title = "Separate values with commas";
    input.onchange = () => {
      if (!input.checkValidity() || ((row.kind === "number" || row.kind === "date") && !input.value)) { input.reportValidity(); return; }
      change(replaceProperty(inner, row, row.kind === "checkbox" ? String(input.checked) : input.value));
    };
    label.append(key, type, input); host.append(label);
  }
}
