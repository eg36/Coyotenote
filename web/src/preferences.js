// Browser-local writing preferences. Invalid or old values keep safe defaults.
import { state, storage } from "./core.js";

const defaults = { textSize: 18, lineWidth: 760, spellcheck: true };
const textSizes = [14, 16, 18, 20, 22, 24];
const lineWidths = [[600, "Narrow"], [760, "Standard"], [960, "Wide"]];
function normalize(value) {
  return {
    textSize: textSizes.includes(value?.textSize) ? value.textSize : defaults.textSize,
    lineWidth: lineWidths.some(([width]) => width === value?.lineWidth) ? value.lineWidth : defaults.lineWidth,
    spellcheck: typeof value?.spellcheck === "boolean" ? value.spellcheck : defaults.spellcheck,
  };
}
let stored;
try { stored = JSON.parse(storage.get("labradorite-writing")); } catch {}
const writingSettings = normalize(stored);

function applyWritingSettings(value = writingSettings) {
  Object.assign(writingSettings, normalize(value));
  const root = document.documentElement;
  root.style.setProperty("--writing-size", writingSettings.textSize + "px");
  root.style.setProperty("--source-font-size", (writingSettings.textSize - 2) + "px");
  root.style.setProperty("--writing-width", writingSettings.lineWidth + "px");
  state.rich?.spellcheck(writingSettings.spellcheck);
  state.source?.refresh();
}

export { applyWritingSettings, lineWidths, textSizes, writingSettings };
