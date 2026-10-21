// Labradorite Space: the shell hosts plugins. A plugin is one tool with its own
// interface (Notes first); the shell owns the rail, the plugin switcher,
// settings and the command palette. Every plugin is optional.
import { api } from "./api.js";
import { showError, state, storage } from "./core.js";

interface PluginCommand { label: string; keys?: string; run: () => unknown; when?: () => unknown }
// SpaceContext is what the shell offers a plugin while it is mounted.
interface SpaceContext { open(plugin: string, target?: string): void }
// The contract every plugin implements. contract says which version of it,
// so the shell can refuse a plugin written against another one.
interface LabradoritePlugin {
  contract: 1;
  id: string;
  name: string;
  description: string; // one line, for the switcher and settings
  icon: string; // a key in icons.ts
  colour: string; // a theme variable, such as "--plugin-notes"
  folder?: string; // the vault folder it keeps its files in, if not the root
  fileTypes?: string[]; // file name endings it opens, such as ".md"
  railItems(): HTMLElement[]; // rail buttons shown while it is active
  commands(): PluginCommand[]; // palette commands while it is active
  mount(ctx: SpaceContext): void; // show it; it keeps its state between mounts
  unmount(): void; // hide it and finish pending work
  focus(): void; // move focus to its main area
  openLink?(target: string): boolean; // open a link into this plugin
  settings?(): HTMLElement; // its own section in Settings
}

const registered: LabradoritePlugin[] = [];
let enabled: Record<string, boolean> = {};
let active: LabradoritePlugin | null = null;
const activeKey = () => "labradorite-plugin:" + state.vaultId;
const context: SpaceContext = {
  open(id, target) {
    switchPlugin(id);
    if (target && active?.id === id) active.openLink?.(target);
  },
};

function registerPlugin(plugin: LabradoritePlugin) {
  if (plugin.contract !== 1) throw new Error(`Plugin ${plugin.id} needs a newer Labradorite.`);
  if (!registered.some((p) => p.id === plugin.id)) registered.push(plugin);
}
// plugins lists the registered plugins, or only the enabled ones.
function plugins({ all = false } = {}) {
  return registered.filter((p) => all || enabled[p.id] !== false);
}
function activePlugin() {
  return active;
}
function isActive(id: string) {
  return active?.id === id;
}

// show marks the active plugin on the app and shows only its rail items.
function show() {
  const app = document.getElementById("app")!;
  app.dataset.plugin = active?.id || "";
  document.getElementById("space-empty")!.hidden = Boolean(active);
  for (const plugin of registered)
    for (const item of plugin.railItems()) item.hidden = plugin !== active;
  document.dispatchEvent(new Event("plugin-change"));
}

// switchPlugin unmounts the active plugin, which keeps its state, and mounts
// the chosen one. An unknown or disabled ID leaves things as they are.
function switchPlugin(id: string, { focus = true } = {}) {
  const next = plugins().find((p) => p.id === id);
  if (!next) return false;
  if (next !== active) {
    active?.unmount();
    active = next;
    show();
    next.mount(context);
    storage.set(activeKey(), id);
  }
  if (focus) next.focus();
  return true;
}

// startPlugins adopts the server's plugin choice and opens the preferred
// plugin (an address can point into one), else the one used last in this
// vault, else the first enabled one, else none.
function startPlugins(choice: Record<string, boolean>, prefer = "") {
  enabled = { ...choice };
  const last = storage.get(activeKey()) || "";
  if (!switchPlugin(prefer, { focus: false }) && !switchPlugin(last, { focus: false })) {
    const first = plugins()[0];
    if (first) switchPlugin(first.id, { focus: false });
    else show();
  }
}

// setPluginEnabled keeps the choice on the server and leaves a plugin that
// was just turned off.
async function setPluginEnabled(id: string, on: boolean) {
  const saved = await api<{ plugins: Record<string, boolean> }>("/api/settings", "POST", { plugins: { [id]: on } });
  enabled = saved.plugins;
  if (!on && active?.id === id) {
    active.unmount();
    active = null;
    const first = plugins()[0];
    if (first) switchPlugin(first.id, { focus: false });
    else show();
  } else if (on && !active) switchPlugin(id, { focus: false });
  else show();
}
function enablePlugin(id: string, on: boolean) {
  return setPluginEnabled(id, on).catch(showError);
}

export type { LabradoritePlugin, PluginCommand, SpaceContext };
export { activePlugin, enablePlugin, isActive, plugins, registerPlugin, startPlugins, switchPlugin };
