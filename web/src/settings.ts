// One settings window: the theme and the writing preferences. Every change
// applies and is kept at once, so the window only needs Done.
import { showToast, storage } from "./core.js";
import { closeModal, openModal, themeChooser } from "./dialogs.js";
import { applyWritingSettings, lineWidths, textSizes, writingSettings } from "./preferences.js";

function section(title: string, ...content: Node[]) {
  const box = document.createElement("section");
  box.className = "settings-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  box.append(heading, ...content);
  return box;
}

function writingFields() {
  const container = document.createElement("div");
  const fields = document.createElement("div");
  fields.className = "settings-fields";
  const keep = () => {
    applyWritingSettings({textSize: Number(size.value), lineWidth: Number(width.value), spellcheck: check.checked});
    if (!storage.set("labradorite-writing", JSON.stringify(writingSettings)))
      showToast("Settings apply in this tab, but this browser could not remember them.", {persistent:true});
  };
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
    select.onchange = keep;
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
  check.onchange = keep;
  const text = document.createElement("span");
  text.textContent = "Check spelling in Write";
  const hint = document.createElement("small");
  hint.textContent = "Uses your browser’s language and dictionary.";
  text.append(hint);
  toggle.append(check, text);
  const note = document.createElement("p");
  note.className = "dialog-description";
  note.textContent = "Writing preferences stay in this browser.";
  container.append(fields, toggle, note);
  return container;
}

function settingsDialog() {
  const container = document.createElement("div");
  container.className = "settings-layout";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary-button settings-done";
  done.textContent = "Done";
  done.onclick = () => closeModal();
  container.append(
    section("Appearance", themeChooser()),
    section("Writing", writingFields()),
    done,
  );
  openModal("Settings", container, null, {className:"settings", hideFooter:true});
  // The list could only scroll to the current theme once it is shown.
  container.querySelector(".theme-option.chosen")?.scrollIntoView({block:"nearest"});
}

export { settingsDialog };
