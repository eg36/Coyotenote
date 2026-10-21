// One settings window: the appearance, the writing preferences and the
// plugins. Every change applies and is kept at once, so the window only needs
// Done.
import { showToast, storage } from "./core.js";
import { enablePlugin, plugins, setShowPluginFolders, showPluginFolders } from "./plugins.js";
import { renderList } from "./list.js";
import { appearanceChooser, closeModal, openModal } from "./dialogs.js";
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

// pluginFields offers a switch for each built-in plugin. The server keeps the
// choice for the vault.
function pluginFields() {
  const container = document.createElement("div");
  container.className = "settings-plugins";
  for (const plugin of plugins({ all: true })) {
    const toggle = document.createElement("label");
    toggle.className = "setting-toggle";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.role = "switch";
    check.dataset.plugin = plugin.id;
    check.checked = plugins().includes(plugin);
    // The switch keeps focus while the server saves; it then shows what was
    // kept, so a failed save flips it back.
    check.onchange = () => {
      check.setAttribute("aria-busy", "true");
      enablePlugin(plugin.id, check.checked).finally(() => {
        check.removeAttribute("aria-busy");
        check.checked = plugins().includes(plugin);
      });
    };
    const text = document.createElement("span");
    text.textContent = plugin.name;
    const hint = document.createElement("small");
    hint.textContent = plugin.description;
    text.append(hint);
    toggle.append(check);
    if (plugin.image) {
      const picture = document.createElement("img");
      picture.className = "setting-plugin-image";
      picture.src = plugin.image;
      picture.alt = "";
      picture.width = picture.height = 32;
      toggle.append(picture);
    }
    toggle.append(text);
    container.append(toggle);
  }
  const folders = document.createElement("label");
  folders.className = "setting-toggle";
  const show = document.createElement("input");
  show.type = "checkbox";
  show.id = "show-plugin-folders";
  show.checked = showPluginFolders();
  show.onchange = () => {
    setShowPluginFolders(show.checked);
    renderList();
  };
  const label = document.createElement("span");
  label.textContent = "Show plugin folders in Notes";
  const hint = document.createElement("small");
  hint.textContent = "Lists files such as issues/ among your notes.";
  label.append(hint);
  folders.append(show, label);
  const note = document.createElement("p");
  note.className = "dialog-description";
  note.textContent = "Every plugin is optional. Turning one off keeps its files in the vault, where Notes lists them.";
  container.append(folders, note);
  return container;
}

// settingsDialog opens the window; appearance focuses its chosen card, and
// plugins the first plugin switch.
function settingsDialog({ appearance = false, plugins: showPlugins = false } = {}) {
  const container = document.createElement("div");
  container.className = "settings-layout";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary-button settings-done";
  done.textContent = "Done";
  done.onclick = () => closeModal();
  const look = appearanceChooser();
  container.append(
    section("Appearance", look.element),
    section("Writing", writingFields()),
    section("Plugins", pluginFields()),
    done,
  );
  openModal("Settings", container, null, {className:"settings", hideFooter:true});
  if (appearance) setTimeout(look.focus, 40);
  else if (showPlugins) setTimeout(() => {
    const first = container.querySelector<HTMLInputElement>(".settings-plugins input");
    first?.scrollIntoView({ block: "nearest" });
    first?.focus();
  }, 40);
}

export { settingsDialog };
