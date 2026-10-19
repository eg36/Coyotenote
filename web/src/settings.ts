import { showToast, storage } from "./core.js";
import { openModal } from "./dialogs.js";
import { applyWritingSettings, lineWidths, textSizes, writingSettings } from "./preferences.js";

function settingsDialog() {
  const container = document.createElement("div");
  const description = document.createElement("p");
  description.className = "dialog-description";
  description.textContent = "These preferences stay in this browser.";
  const fields = document.createElement("div");
  fields.className = "settings-fields";
  function choice(id: string, label: string, options: [number, string][], value: number) {
    const field = document.createElement("div");
    const title = document.createElement("label");
    title.className = "field-label";
    title.htmlFor = id;
    title.textContent = label;
    const select = document.createElement("select");
    select.id = id;
    for (const [key, name] of options) select.add(new Option(name, String(key)));
    select.value = String(value);
    field.append(title, select);
    fields.append(field);
    return select;
  }
  const size = choice("writing-size", "Text size", textSizes.map((n) => [n, n + " px"]), writingSettings.textSize);
  const width = choice("writing-width", "Line width", lineWidths, writingSettings.lineWidth);
  const toggle = document.createElement("label");
  toggle.className = "setting-toggle";
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = writingSettings.spellcheck;
  const text = document.createElement("span");
  text.textContent = "Check spelling in Write";
  const hint = document.createElement("small");
  hint.textContent = "Uses your browser’s language and dictionary.";
  text.append(hint);
  toggle.append(check, text);
  container.append(description, fields, toggle);
  openModal("Writing settings", container, () => {
    applyWritingSettings({textSize: Number(size.value), lineWidth: Number(width.value), spellcheck: check.checked});
    if (!storage.set("labradorite-writing", JSON.stringify(writingSettings)))
      showToast("Settings apply in this tab, but this browser could not remember them.", {persistent:true});
  }, {submit:"Save settings", className:"writing-settings"});
}

export { settingsDialog };
