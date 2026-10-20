import { test, expect } from "./fixtures.js";

let counter = 0;
async function seed(page, name, body = "") {
  const bootstrap = await (await page.request.get("/api/state")).json();
  const response = await page.request.post("/api/note", {
    headers: { "X-Labradorite-Token": bootstrap.token },
    data: { id: name, body },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function openSeed(page, body, name) {
  const id = name || `Note ${Date.now()} ${++counter}`;
  await seed(page, id, body);
  await page.goto("/?note=" + encodeURIComponent(id));
  await expect(page.locator("#document-title")).toHaveText(id.split("/").pop());
  // The title is set before the lazy editor is ready. Initial sidebar
  // restoration follows openNote, after the editor has finished loading.
  await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", /true|false/);
  return id;
}
// searchBox opens the header search, which is a button until used.
async function searchBox(page) {
  const box = page.locator("#search");
  if (await box.isHidden() || await page.locator("#sidebar-toggle").getAttribute("aria-expanded") !== "true") {
    const icon = page.locator("#sidebar-search");
    if (await icon.isVisible()) await icon.click();
    else await page.keyboard.press("Control+Shift+e");
  }
  await expect(box).toBeVisible();
  return box;
}
// openThemes shows the theme list in Settings, opening the window first.
async function openThemes(page) {
  if (!(await page.locator("#modal").evaluate((d) => d.open))) await page.locator("#settings-button").click();
  if (await page.locator("#theme-panel").isHidden()) await page.getByRole("button", { name: /^Theme:/ }).click();
  await expect(page.getByRole("combobox", { name: "Find a theme" })).toBeFocused();
}
// mode picks a view from the header's selector, or from the View menu when
// the header is hidden.
async function mode(page, name) {
  // A reload resolves before startup has opened the note and restored the
  // sidebar. Do not mistake its temporarily hidden selector for phone UI.
  await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", /true|false/);
  if (await page.locator("#view-type").isVisible()) {
    await page.locator("#view-type").click();
    await page.getByRole("option", { name, exact: true }).click();
    await expect(page.locator("#view-menu")).toBeHidden();
  } else {
    await menu(page, "view");
    await page.getByRole("menuitem", { name, exact: true }).click();
    await expect(page.locator("#menu-popup")).toBeHidden();
  }
  // The menu closes before the new view is loaded and focused.
  await expect(page.locator("#editor-area")).not.toHaveAttribute("aria-busy", "true");
}
// Native Home/End update the DOM selection before selectionchange reaches
// ProseMirror. Observe both before typing or running an editor command.
async function caretAt(page, text, offset) {
  await expect.poll(() => page.locator(".tiptap").evaluate((dom, { text, offset }) => {
    const native = window.getSelection();
    const model = dom.editor.state.selection;
    return native?.isCollapsed && native.anchorNode?.textContent === text && native.anchorOffset === offset &&
      model.empty && model.$head.parent.textContent === text && model.$head.parentOffset === offset;
  }, { text, offset })).toBe(true);
}
async function menu(page, section) {
  await page.locator(`[data-menu="${section}"]`).click();
}
async function diskBody(page, id) {
  return (
    (
      await (
        await page.request.get("/api/note?id=" + encodeURIComponent(id))
      ).json()
    ).body || ""
  );
}

// failSaves makes note saves fail in every document of the context until
// allowSaves, with an HTTP error or, without one, a network failure. Network
// routes can miss the save a document sends while it unloads, which then
// reaches the server; this fails it inside the page instead.
async function failSaves(page, failure = {}) {
  const install = () => {
    if (window.__failSaves) return;
    window.__failSaves = true;
    const fetch = window.fetch;
    window.fetch = (url, options) => {
      const failure = localStorage.getItem("test-fail-saves");
      if (!failure || options?.method !== "PUT" || new URL(url, location.href).pathname !== "/api/note")
        return fetch(url, options);
      const { status, error } = JSON.parse(failure);
      return status
        ? Promise.resolve(new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } }))
        : Promise.reject(new TypeError("Failed to fetch"));
    };
  };
  await page.context().addInitScript(install);
  await page.evaluate(install);
  await page.evaluate((failure) => localStorage.setItem("test-fail-saves", JSON.stringify(failure)), failure);
}
async function allowSaves(page) {
  await page.evaluate(() => localStorage.removeItem("test-fail-saves"));
}

// Fail on browser errors rather than accepting an attractive but broken screen.
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("empty notebook, create a note, WYSIWYG writing and autosave", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A little room to think." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create your first note" }).click();
  await page.getByLabel("Name your note").fill("Morning thoughts");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });
  await expect(editor).toBeVisible();
  await editor.fill("A thought worth keeping.");
  await expect
    .poll(() => diskBody(page, "Morning thoughts"))
    .toContain("A thought worth keeping.");
  await expect(page.locator("#save-label")).toHaveText("All changes saved");
  await page.reload();
  await expect(editor).toContainText("A thought worth keeping.");
});

test("document menus and note actions stay above the left formatting panel", async ({ page }) => {
  await page.goto("/");
  const popup = page.locator("#menu-popup");
  await expect(page.locator("#menu-bar [data-menu]")).toHaveCount(4);
  await menu(page, "file");
  await expect(page.getByRole("menuitem", { name: "Rename or move…" })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(popup).toHaveAttribute("aria-label", "Edit");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitem", { name: "Split", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-menu="view"]')).toBeFocused();
  const homeMenus = await page.locator("#menu-bar").boundingBox();
  const homeWorkspace = await page.locator(".workspace").boundingBox();
  await openSeed(page, "A document with menus.");
  const menus = await page.locator("#menu-bar").boundingBox();
  // At home and in a note, the menus centre over the content beside the open panels.
  const homeContent = homeWorkspace;
  expect(Math.abs(homeMenus.x + homeMenus.width / 2 - homeContent.x - homeContent.width / 2)).toBeLessThan(1);
  const noteContent = await page.locator(".workspace").boundingBox();
  expect(Math.abs(menus.x + menus.width / 2 - noteContent.x - noteContent.width / 2)).toBeLessThan(1);
  const writing = await page.locator(".editor-bar").boundingBox();
  await expect(page.locator("#format-panel")).toBeVisible();
  const panel = await page.locator("#format-panel").boundingBox();
  const workspace = await page.locator(".workspace").boundingBox();
  expect(menus.y + menus.height).toBeLessThanOrEqual(panel.y);
  expect(writing.y + writing.height).toBeLessThanOrEqual(panel.y);
  expect(panel.x + panel.width).toBeLessThanOrEqual(workspace.x);
  await menu(page, "view");
  await page.getByRole("menuitem", { name: "Split", exact: true }).click();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "split");
  await expect(popup).toBeHidden();
});

test("rich formatting and Markdown survive source, split and preview modes", async ({
  page,
}) => {
  const id = await openSeed(
    page,
    '# A quiet place\n\nA thought with **bold** words.\n\n- [ ] A task\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```go\nfmt.Println("hello")\n```',
  );
  await expect(page.locator(".tiptap h1")).toHaveText("A quiet place");
  await expect(page.locator(".tiptap strong")).toHaveText("bold");
  await page.getByRole("checkbox").check();
  await expect.poll(() => diskBody(page, id)).toContain("[x]");
  await page.locator(".tiptap").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A new paragraph.");
  await expect.poll(() => diskBody(page, id)).toContain("A new paragraph.");
  await mode(page, "Markdown");
  await expect(page.locator(".cm-content")).toContainText("**bold**");
  await mode(page, "Split");
  await expect(page.locator("#preview table")).toBeVisible();
  await expect(page.locator("#preview strong")).toHaveText("bold");
  await expect(page.locator("#source-pane")).toBeVisible();
  await mode(page, "Preview");
  await expect(page.locator("#source-pane")).toBeHidden();
  await expect(page.locator("#preview")).toContainText("fmt.Println");
});

test("the text style menu previews each style and applies it by mouse or keyboard", async ({
  page,
}) => {
  const id = await openSeed(page, "A plain line.");
  const trigger = page.getByRole("button", { name: "Normal text" });
  const menu = page.getByRole("listbox", { name: "Text style" });
  await page.locator(".tiptap p").click();
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option")).toHaveCount(7);
  await expect(
    menu.getByRole("option", { name: /Normal text/, selected: true }),
  ).toBeVisible();
  const sizes = await menu
    .locator(".block-sample")
    .evaluateAll((samples) =>
      samples.map((s) => parseFloat(getComputedStyle(s).fontSize)),
    );
  expect(sizes[1]).toBeGreaterThan(sizes[2]);
  expect(sizes[2]).toBeGreaterThan(sizes[3]);
  await menu.getByRole("option", { name: /Heading 2/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".tiptap h2")).toHaveText("A plain line.");
  await expect(page.locator("#block-type-label")).toHaveText("Heading 2");
  await expect.poll(() => diskBody(page, id)).toMatch(/^## A plain line\.\s*$/);
  await page.locator("#block-type").focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tiptap h3")).toHaveText("A plain line.");
  await expect(page.locator(".tiptap")).toBeFocused();
  await page.locator("#block-type").click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator(".tiptap")).toBeFocused();
  await page.locator("#block-type").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tiptap p").first()).toHaveText("A plain line.");
  await expect.poll(() => diskBody(page, id)).toMatch(/^A plain line\.\s*$/);
});

test("opening theme search immediately keeps focus after the dialog settles", async ({ page }) => {
  await openSeed(page, "Settings focus stays where I put it.");
  await expect(page.locator("#rich-editor")).toBeVisible();
  await page.clock.install();
  // A moment ahead: the page's clock may already be past Node's "now".
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.locator("#settings-button").click();
  await page.getByRole("button", { name: /^Theme:/ }).click();
  const search = page.getByRole("combobox", { name: "Find a theme" });
  await expect(search).toBeFocused();
  await page.clock.runFor(100);
  await expect(search).toBeFocused();
  await search.fill("Tokyo");
  await expect(page.locator(".theme-option")).toHaveCount(1);
});

test("all fourteen themes, preview cancel and persistence", async ({
  page,
}) => {
  await openSeed(page, "# Theme test\n\nHello.");
  await openThemes(page);
  await page.getByRole("group", { name: "Show themes" }).getByRole("button", { name: "Dark", exact: true }).click();
  await page.locator('[data-theme-id="catppuccin-mocha"]').click();
  await expect(page.locator("#toast-text")).toHaveText("Theme: Catppuccin Mocha");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "catppuccin-mocha",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "catppuccin-mocha",
  );
  await openThemes(page);
  await page.getByRole("group", { name: "Show themes" }).getByRole("button", { name: "Light", exact: true }).click();
  await page.locator('[data-theme-id="light"]').hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "catppuccin-mocha",
  );
  await openThemes(page);
  await page.getByRole("group", { name: "Show themes" }).getByRole("button", { name: "Light", exact: true }).click();
  await page.locator('[data-theme-id="light"]').click();
  await expect(page.locator("#rich-pane")).toHaveCSS(
    "background-color",
    "rgb(251, 252, 253)",
  );
});

test("every theme draws text, accents, pills and focus rings at AA contrast", async ({ page }) => {
  await openSeed(page, "Contrast.");
  await openThemes(page);
  // The list shows light or dark themes; walk both.
  const kinds = page.getByRole("group", { name: "Show themes" });
  const ids = [];
  for (const kind of ["Light", "Dark"]) {
    await kinds.getByRole("button", { name: kind, exact: true }).click();
    ids.push(...(await page.locator(".theme-option").evaluateAll((options) => options.map((o) => [o.dataset.themeId, o.querySelector("small").textContent]))));
  }
  expect(ids).toHaveLength(14);
  for (const [id, kind] of ids) {
    if (!(await page.locator(`[data-theme-id="${id}"]`).count())) await kinds.getByRole("button", { name: kind, exact: true }).click();
    await page.locator(`[data-theme-id="${id}"]`).hover();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    const worst = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (name) => {
        const hex = css.getPropertyValue("--" + name).trim();
        return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      };
      const mix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));
      const lum = (c) => c.map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const plain = [rgb("surface"), rgb("chrome")];
      const tinted = plain.map((b) => mix(rgb("accent"), b, 0.24));
      return {
        text: Math.min(...[...plain, ...tinted].map((b) => ratio(rgb("text"), b))),
        muted: Math.min(...plain.map((b) => ratio(rgb("muted"), b))),
        accentText: Math.min(...plain.map((b) => ratio(rgb("accent-text"), b))),
        onPill: ratio(rgb("onPill"), rgb("accent")),
        focus: Math.min(...[...plain, ...tinted].map((b) => ratio(rgb("focus"), b))),
        // ==Highlights== in every colour, on 30% tints like the stylesheet's.
        highlight: Math.min(...plain.flatMap((b) =>
          [rgb("warn"), rgb("danger"), mix(rgb("danger"), rgb("warn"), 0.5), rgb("good"), rgb("blue"), rgb("pink")]
            .map((c) => ratio(rgb("mark-text"), mix(c, b, 0.3))))),
      };
    });
    // Text needs 4.5:1; focus rings, like other non-text cues, 3:1.
    for (const [role, value] of Object.entries(worst))
      expect(value, `${id} ${role}`).toBeGreaterThanOrEqual(role === "focus" ? 3 : 4.5);
  }
  await page.keyboard.press("Escape");
});

test("settings hold the themes and writing preferences over a lightly tinted page", async ({ page }) => {
  await openSeed(page, "# Themes");
  await page.locator("#settings-button").click();
  const picker = page.getByRole("dialog", { name: "Settings" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(picker.getByLabel("Text size", { exact: true })).toBeVisible();
  // The theme list stays closed until the theme field is clicked.
  await expect(picker.locator(".theme-list")).toBeHidden();
  await expect(picker.getByRole("button", { name: /^Theme: / })).toBeVisible();
  await openThemes(page);
  expect((await picker.boundingBox()).width).toBeLessThanOrEqual(720);
  // The same light tint as other dialogs, so theme previews stay visible.
  expect(await picker.evaluate((el) => getComputedStyle(el, "::backdrop").backgroundColor)).toBe("rgba(16, 18, 24, 0.5)");
  const shown = await picker.locator(".theme-option").count();
  expect(shown).toBeGreaterThan(1);
  await expect(picker.locator(".theme-list .theme-swatch i")).toHaveCount(4 * shown);
  const rows = await picker.locator(".theme-option").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
  expect(new Set(rows).size).toBe(1);
  await page.getByLabel("Find a theme").fill("catppuccin");
  await expect(picker.locator(".theme-option").first()).toBeVisible();
  expect(await picker.locator(".theme-option").count()).toBeLessThan(shown);
  // Escape closes the list first, then the window.
  await page.keyboard.press("Escape");
  await expect(picker.locator(".theme-list")).toBeHidden();
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.locator("#sidebar-toggle").click();
  await page.locator("#settings-button").click();
  const box = await picker.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.height).toBeLessThanOrEqual(635);
  await expect(picker.getByRole("button", { name: "Done" })).toBeVisible();
});

test("the theme list shows light or dark themes, starting with the current theme's kind", async ({ page }) => {
  await openSeed(page, "# Light and dark");
  const kept = (await (await page.request.get("/api/state")).json()).theme;
  await openThemes(page);
  const list = page.getByRole("listbox", { name: "Themes" });
  const filter = page.getByRole("group", { name: "Show themes" });
  await expect(filter.getByRole("button")).toHaveCount(2);
  // It opens on the current theme's kind, and shows only that kind.
  const keptKind = await list.locator(`[data-theme-id="${kept}"] small`).textContent();
  await expect(filter.getByRole("button", { name: keptKind, exact: true })).toHaveAttribute("aria-pressed", "true");
  const kindsShown = async () => list.getByRole("option").evaluateAll((options) => [...new Set(options.map((o) => o.querySelector("small").textContent))]);
  expect(await kindsShown()).toEqual([keptKind]);
  await filter.getByRole("button", { name: "Light", exact: true }).click();
  expect(await kindsShown()).toEqual(["Light"]);
  const light = await list.getByRole("option").count();
  await filter.getByRole("button", { name: "Dark", exact: true }).click();
  expect(await kindsShown()).toEqual(["Dark"]);
  expect(light + (await list.getByRole("option").count())).toBe(14);
  // Search narrows within the kind; arrows preview; Escape restores.
  const search = page.getByRole("combobox", { name: "Find a theme" });
  await search.fill("light");
  await expect(list.getByRole("option")).toHaveCount(0);
  await search.fill("catppuccin");
  await expect(list.getByRole("option")).toHaveCount(3);
  await search.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /catppuccin/);
  await search.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", kept);
  // Enter on the switch changes the kind rather than choosing a theme.
  await openThemes(page);
  await filter.getByRole("button", { name: "Light", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(filter.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#theme-panel")).toBeVisible();
  expect((await (await page.request.get("/api/state")).json()).theme).toBe(kept);
  // The choice is remembered; a remembered "all" from before opens on the theme's kind.
  await page.reload();
  await openThemes(page);
  await expect(filter.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => localStorage.setItem("labradorite-theme-filter", "all"));
  await page.reload();
  await openThemes(page);
  await expect(filter.getByRole("button", { name: keptKind, exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("theme keyboard preview wraps, cancels and commits a filtered selection", async ({ page }) => {
  await openSeed(page, "# Keyboard themes");
  await openThemes(page);
  await page.getByRole("group", { name: "Show themes" }).getByRole("button", { name: "Dark", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Find a theme" });
  await search.fill("Labradorite Dark");
  await search.press("Enter");
  // Choosing closes the list and keeps the settings window open.
  await expect(page.locator("#theme-panel")).toBeHidden();
  await expect(page.locator("#modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).not.toBeVisible();
  await openThemes(page);
  // Neighbours in the list as shown: light themes first, then dark ones.
  const ids = await page.getByRole("listbox", { name: "Themes" }).getByRole("option").evaluateAll((options) => options.map((o) => o.dataset.themeId));
  const at = ids.indexOf("dark");
  const before = ids[(at - 1 + ids.length) % ids.length], after = ids[(at + 1) % ids.length];
  await search.press("ArrowUp");
  await expect(page.locator("html")).toHaveAttribute("data-theme", before);
  await expect(page.getByRole("listbox", { name: "Themes" }).getByRole("option", { selected: true })).toHaveAttribute("data-theme-id", before);
  await expect(search).toHaveAttribute("aria-activedescendant", "theme-option-" + before);
  // Preview changes the page, but never persists until Enter/click.
  expect((await (await page.request.get("/api/state")).json()).theme).toBe("dark");
  await search.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await search.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", after);
  await search.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openThemes(page);
  await search.fill("catppuccin");
  await expect(page.getByRole("listbox", { name: "Themes" }).getByRole("option")).toHaveCount(3);
  const second = await page.getByRole("listbox", { name: "Themes" }).getByRole("option").nth(1).getAttribute("data-theme-id");
  await search.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", second);
  await search.press("Enter");
  // Choosing keeps the theme and leaves the window open for other settings.
  await expect(page.locator("#modal")).toBeVisible();
  await expect.poll(async () => (await (await page.request.get("/api/state")).json()).theme).toBe(second);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#modal")).not.toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", second);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", second);
});

test("empty theme search and failed selection preserve the previous theme", async ({ page }) => {
  await openSeed(page, "# Theme recovery");
  const original = await page.locator("html").getAttribute("data-theme");
  await openThemes(page);
  const search = page.getByRole("combobox", { name: "Find a theme" });
  await search.fill("no such palette");
  await expect(page.getByRole("listbox", { name: "Themes" }).getByRole("option")).toHaveCount(0);
  await expect(page.getByText("No matching themes")).toBeVisible();
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.locator("#modal")).toBeVisible();
  await page.getByRole("group", { name: "Show themes" }).getByRole("button", { name: "Dark", exact: true }).click();
  await search.fill("Nord");
  await page.route("**/api/settings", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Settings unavailable" }) }));
  await search.press("Enter");
  await expect(page.locator("#modal-error")).toContainText("Settings unavailable");
  await expect(page.locator("#modal")).toBeVisible();
  await search.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", original);
  expect((await (await page.request.get("/api/state")).json()).theme).toBe(original);
});

test("note sorting remembers titles, uses edit times and follows search navigation", async ({ page }) => {
  const folder = `Sorting ${Date.now()}`;
  const ids = [folder + "/Beta", folder + "/alpha10", folder + "/Alpha2"];
  for (const id of ids) await seed(page, id, "sorting needle");
  const dates = ["2022-01-01T00:00:00Z", "2020-01-01T00:00:00Z", "2021-01-01T00:00:00Z"];
  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const note of data.notes) {
      const index = ids.indexOf(note.id);
      if (index >= 0) note.modified = dates[index];
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto("/?note=" + encodeURIComponent(ids[0]));
  const sort = page.getByRole("combobox", { name: "Sort notes" });
  const rows = page.locator(`.note-row[data-note^="${folder}/"]`);
  const order = () => rows.evaluateAll((els) => els.map((el) => el.dataset.note));
  await expect(sort).toHaveValue("modified");
  await expect.poll(order).toEqual([ids[0], ids[2], ids[1]]);
  await sort.selectOption("title-asc");
  await expect.poll(order).toEqual([ids[2], ids[1], ids[0]]);
  await sort.selectOption("title-desc");
  await expect.poll(order).toEqual([ids[0], ids[1], ids[2]]);
  await page.reload();
  await expect(sort).toHaveValue("title-desc");
  await (await searchBox(page)).fill(folder);
  await expect(page.locator("#note-count")).toHaveText("3");
  await menu(page, "view");
  await page.getByRole("menuitem", { name: "Next note" }).click();
  await expect(page.locator("#document-title")).toHaveText("alpha10");
  await sort.selectOption("modified");
  await mode(page, "Markdown");
  await page.locator(".cm-content").fill("sorting needle edited");
  await expect.poll(() => diskBody(page, ids[1])).toBe("sorting needle edited");
  await expect.poll(order).toEqual([ids[1], ids[0], ids[2]]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#sidebar-toggle").click();
  await expect(sort).toBeVisible();
  await expect(page.locator("#sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const box = await sort.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test("create in folders, body search, rename, trash and undo", async ({
  page,
}) => {
  const id = await openSeed(
    page,
    "An elusive searchable phrase.",
    "Projects/Search " + Date.now(),
  );
  await (await searchBox(page)).fill("elusive searchable");
  await expect(page.locator(".note-row")).toHaveCount(1);
  await (await searchBox(page)).fill("");
  await expect(page.locator(".note-row").first()).toBeVisible();
  await page.locator("#document-title").click();
  const renamed = id + " revised";
  await page.getByLabel("Note name").fill(renamed.split("/").pop());
  await page.keyboard.press("Enter");
  await expect(page.locator("#document-title")).toHaveText(
    renamed.split("/").pop(),
  );
  await page
    .getByRole("button", { name: "Move note to trash", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(page.locator("#toast")).toContainText("Note moved to trash.");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#document-title")).toHaveText(
    renamed.split("/").pop(),
  );
});

test("trashing a repeated name keeps both copies and undo restores the original name", async ({
  page,
}) => {
  const id = `Repeated ${Date.now()}`;
  for (const body of ["older copy", "newer copy"]) {
    await openSeed(page, body, id);
    await page
      .getByRole("button", { name: "Move note to trash", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move to trash", exact: true })
      .click();
    await expect(page.locator("#toast")).toContainText("Note moved to trash.");
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#document-title")).toHaveText(id);
  expect(await diskBody(page, id)).toBe("newer copy");
});

test("wiki links, backlinks, rename rewriting and rich serialization", async ({
  page,
}) => {
  const suffix = Date.now();
  const target = "Linked " + suffix;
  await seed(page, target, "# Linked thought");
  const id = await openSeed(
    page,
    `Read [[${target}|this thought]].\n\n\`[[not a link]]\``,
    "Source " + suffix,
  );
  await expect(page.locator(".wiki-link")).toHaveText("this thought");
  await page.locator(".tiptap").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Added text.");
  await expect
    .poll(() => diskBody(page, id))
    .toContain(`[[${target}|this thought]]`);
  await page.locator(".wiki-link").click();
  await expect(page.locator("#document-title")).toHaveText(target);
  await page.locator("#backlinks-button").click();
  await expect(page.locator("#modal-content")).toContainText(id);
  await page.keyboard.press("Escape");
});

test("conflicting tabs keep both versions and offer recovery", async ({
  page,
  context,
}) => {
  const id = await openSeed(page, "Original text.");
  await mode(page, "Markdown");
  const second = await context.newPage();
  await second.goto("/?note=" + encodeURIComponent(id));
  await mode(second, "Markdown");
  await page.locator(".cm-content").fill("First tab wins.");
  await expect.poll(() => diskBody(page, id)).toBe("First tab wins.");
  await second.locator(".cm-content").fill("Second tab draft.");
  await expect(second.locator("#error-banner")).toBeVisible();
  await expect(second.locator("#error-text")).toContainText(
    "changed in another tab",
  );
  expect(await diskBody(page, id)).toBe("First tab wins.");
  await second.locator("#recovery-copy").click();
  await expect(second.locator("#toast")).toContainText("Recovery copy saved:");
  await second.close();
});

test("browser draft recovers after a reload while server writes fail", async ({
  page,
}) => {
  const original = "Before disconnect.";
  const draft = "Keep this unsaved draft.";
  const id = await openSeed(page, original);
  await mode(page, "Markdown");
  // Keep the simulated server outage in force across document teardown/reload,
  // including saves attempted by the old document's visibilitychange handler.
  await failSaves(page, { status: 503, error: "Simulated save outage" });
  await page.locator(".cm-content").fill(draft);
  await expect(page.locator("#error-banner")).toContainText("Simulated save outage");
  const storedDraft = () => page.evaluate((id) => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("coyote-draft:")) continue;
      const value = JSON.parse(localStorage.getItem(key));
      if (value.id === id) return value.body;
    }
    return null;
  }, id);
  await expect.poll(storedDraft).toBe(draft);
  expect(await diskBody(page, id)).toBe(original);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  expect(await diskBody(page, id)).toBe(original);
  await expect.poll(storedDraft).toBe(draft);
  await expect(page.locator("#draft-banner")).toBeVisible();
  await allowSaves(page);
  await page.locator("#restore-draft").click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe(draft);
});

test("malformed browser drafts stay stored while a valid draft remains recoverable", async ({ page }) => {
  const id = await openSeed(page, "Saved base.");
  const state = await (await page.request.get("/api/state")).json();
  const note = await (await page.request.get("/api/note?id=" + encodeURIComponent(id))).json();
  const badKey = `coyote-draft:${state.vaultId}:fixture-invalid:${id}`;
  const goodKey = `coyote-draft:${state.vaultId}:fixture-valid:${id}`;
  const malformed = JSON.stringify({ id, body: 42, base: note.revision, time: Date.now() + 60_000 });
  await page.evaluate(({ badKey, goodKey, malformed, id, revision }) => {
    localStorage.setItem(badKey, malformed);
    localStorage.setItem(goodKey, JSON.stringify({ id, body: "Recover valid text.", base: revision, time: Date.now() }));
  }, { badKey, goodKey, malformed, id, revision: note.revision });
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  await page.locator("#restore-draft").click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("Recover valid text.");
  expect(await page.evaluate((key) => localStorage.getItem(key), badKey)).toBe(malformed);
});

test("undoing back to the saved text during a save keeps the undo recoverable", async ({
  page,
}) => {
  const id = await openSeed(page, "Original text.");
  await mode(page, "Markdown");
  // The save reaches the file, but its answer is held back.
  let release;
  await page.route("**/api/note", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const response = await route.fetch();
    await new Promise((resolve) => (release = resolve));
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator(".cm-content").fill("Earlier edit already saved on disk.");
  await expect.poll(() => typeof release).toBe("function");
  await expect.poll(() => diskBody(page, id)).toBe("Earlier edit already saved on disk.");
  await page.locator(".cm-content").fill("Original text.");
  await expect(page.locator("#save-label")).not.toHaveText("All changes saved");
  const storedDraft = () =>
    page.evaluate((id) => {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("coyote-draft:")) continue;
        const value = JSON.parse(localStorage.getItem(key));
        if (value.id === id) return value.body;
      }
      return null;
    }, id);
  expect(await storedDraft()).toBe("Original text.");
  page.on("dialog", (dialog) => dialog.accept());
  await page.unroute("**/api/note");
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  await page.locator("#restore-draft").click();
  // The draft predates the held save, so keeping it is a deliberate choice.
  await page.keyboard.press("Control+s");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await page.getByRole("button", { name: "Keep my edits" }).click();
  await expect.poll(() => diskBody(page, id)).toBe("Original text.");
});

test("a window opened from a tab cannot discard that tab's only draft", async ({
  page,
}) => {
  const id = await openSeed(page, "Saved base.");
  await mode(page, "Markdown");
  await failSaves(page);
  await page.locator(".cm-content").fill("Parent unique unsaved text.");
  await expect(page.locator("#error-banner")).toBeVisible();
  const drafts = (target) =>
    target.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("coyote-draft:"))
        .map((key) => JSON.parse(localStorage.getItem(key)).body),
    );
  await expect.poll(() => drafts(page)).toEqual(["Parent unique unsaved text."]);

  // The opened window starts with a copy of the parent's sessionStorage.
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.evaluate((id) => window.open("/?note=" + encodeURIComponent(id)), id),
  ]);
  await expect(popup.locator("#draft-banner")).toBeVisible();
  const tab = (target) => target.evaluate(() => sessionStorage.getItem("coyote-tab"));
  expect(await tab(popup)).not.toBe(await tab(page));
  await popup.locator("#discard-draft").click();
  await expect(popup.locator("#draft-banner")).toBeHidden();
  await popup.waitForTimeout(200);
  expect(await drafts(page)).toEqual(["Parent unique unsaved text."]);

  // Once the parent is gone, its leftover draft can be discarded.
  await page.close({ runBeforeUnload: false });
  await popup.reload();
  await expect(popup.locator("#draft-banner")).toBeVisible();
  await popup.locator("#discard-draft").click();
  await expect.poll(() => drafts(popup)).toEqual([]);
  await allowSaves(popup);
});

test("drafts of notes renamed or deleted elsewhere can still be recovered", async ({
  page,
}) => {
  const stamp = Date.now();
  const renamed = `Orphan ${stamp}`,
    deleted = `Doomed ${stamp}`;
  const token = (await (await page.request.get("/api/state")).json()).token;
  const headers = { "X-Labradorite-Token": token };
  page.on("dialog", (dialog) => dialog.accept());
  await seed(page, deleted, "Saved doomed base.");
  await openSeed(page, "Saved orphan base.", renamed);
  await mode(page, "Markdown");
  await failSaves(page);
  await page.locator(".cm-content").fill("Only in browser draft.");
  await expect(page.locator("#error-banner")).toBeVisible();
  // Leave the first note with its unsaved draft, then edit the second.
  await page.goto("/?note=" + encodeURIComponent(deleted));
  await expect(page.locator("#document-title")).toHaveText(deleted);
  await page.locator(".cm-content").fill("Doomed draft text.");
  await expect(page.locator("#error-banner")).toBeVisible();

  // Both notes change outside this tab.
  const note = async (id) =>
    (await page.request.get("/api/note?id=" + encodeURIComponent(id))).json();
  const before = await note(renamed);
  expect(
    (
      await page.request.post("/api/rename", {
        headers,
        data: { id: renamed, name: `Renamed ${stamp}`, revision: before.revision },
      })
    ).ok(),
  ).toBeTruthy();
  const doomed = await note(deleted);
  expect(
    (
      await page.request.delete("/api/note", {
        headers,
        data: { id: deleted, revision: doomed.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await allowSaves(page);
  await page.goto("/");
  await expect(page.locator("#orphan-banner")).toBeVisible();
  await expect(page.locator("#orphan-title")).toHaveText(
    "2 unsaved drafts belong to notes that were moved or deleted.",
  );
  await page.getByRole("button", { name: "Review drafts" }).click();
  const dialog = page.getByRole("dialog", { name: "Unsaved drafts" });
  await expect(dialog).toContainText("Only in browser draft.");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: `Download ${deleted}` }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${deleted}.md`);
  await dialog.getByRole("button", { name: `Discard ${deleted}` }).click();
  await dialog.getByRole("button", { name: `Save as note ${renamed}` }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#document-title")).toHaveText(renamed);
  expect(await diskBody(page, renamed)).toBe("Only in browser draft.");
  expect(await diskBody(page, `Renamed ${stamp}`)).toBe("Saved orphan base.");
  await expect(page.locator("#orphan-banner")).toBeHidden();
  const drafts = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("coyote-draft:")),
  );
  expect(drafts).toEqual([]);
});

test("unsupported Markdown is kept in source, without normalization", async ({
  page,
}) => {
  const body =
    "---\ntitle: untouched\n---\n\nText with <u>raw HTML</u>.\n";
  const id = await openSeed(page, body);
  await mode(page, "Write");
  await expect(page.locator("#source-pane")).toBeVisible();
  expect(await diskBody(page, id)).toBe(body);
});

test("unclosed front matter and link definitions stay in source", async ({
  page,
}) => {
  for (const body of [
    "---\ntitle: never closed\n\nText.\n",
    "Text with a [reference][r].\n\n[r]: https://example.com\n[unused]: https://example.org\n",
  ]) {
    const id = await openSeed(page, body);
    await mode(page, "Write");
    await expect(page.locator("#source-pane")).toBeVisible();
    await expect(page.locator("#rich-pane")).toBeHidden();
    expect(await diskBody(page, id)).toBe(body);
  }
});

test("named HTML entities keep their meaning through edits", async ({ page }) => {
  // Write would turn &copy; and &nbsp; into literal text, so the note stays in Markdown.
  const named = "Copyright &copy; 2026, &amp;, &#169;, &nbsp; and &lt;tag&gt;.\n";
  let id = await openSeed(page, named);
  await mode(page, "Write");
  await expect(page.locator("#source-pane")).toBeVisible();
  await expect(page.locator("#rich-pane")).toBeHidden();
  // The message says what happened and why, without asking for anything.
  await expect(page.locator("#toast")).toContainText(
    "Showing Markdown: Write would show codes such as &copy; as text instead of the symbol",
  );
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nAppended.");
  await expect.poll(() => diskBody(page, id)).toBe(named + "\nAppended.");
  await page.reload();
  await expect(page.locator("#source-pane")).toBeVisible();
  expect(await diskBody(page, id)).toBe(named + "\nAppended.");

  // Entities Write keeps, and named ones inside code, still open in Write.
  const kept = "Fish &amp; chips, &lt;tag&gt; and `&copy;` in code.";
  id = await openSeed(page, kept);
  await mode(page, "Write");
  await expect(page.locator("#rich-pane")).toBeVisible();
  await page.locator(".tiptap p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  await expect.poll(() => diskBody(page, id)).toBe(kept + " More.");
});

test("restoring a draft Write cannot keep intact opens it in source", async ({
  page,
}) => {
  const id = await openSeed(page, "Plain saved file.");
  await mode(page, "Markdown");
  await failSaves(page);
  const draft = "Draft text with <u>raw HTML Write cannot keep</u>.";
  await page.locator(".cm-content").fill(draft);
  await expect(page.locator("#error-banner")).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  await mode(page, "Write");
  await expect(page.locator("#rich-pane")).toBeVisible();
  await allowSaves(page);
  await page.locator("#restore-draft").click();
  await expect(page.locator("#source-pane")).toBeVisible();
  await expect(page.locator("#rich-pane")).toBeHidden();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe(draft);
});

test("typing while another note loads keeps those edits", async ({ page }) => {
  const stamp = Date.now();
  const other = `Loading target ${stamp}`;
  await seed(page, other, "The other note.");
  const id = await openSeed(page, "Typed before.", `Loading source ${stamp}`);
  let release;
  const hold = (route) =>
    new Promise((resolve) => (release = resolve)).then(() => route.continue());
  const isOther = (url) =>
    url.pathname === "/api/note" && url.searchParams.get("id") === other;
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });

  await page.route(isOther, hold);
  await page.locator(".note-title", { hasText: other }).click();
  await expect.poll(() => typeof release).toBe("function");
  await editor.fill("Typed while loading.");
  release();
  await expect(page.locator("#document-title")).toHaveText(other);
  await expect.poll(() => diskBody(page, id)).toBe("Typed while loading.");

  // When those edits cannot be saved, the note stays open with them.
  await page.goto("/?note=" + encodeURIComponent(id));
  await expect(editor).toHaveText("Typed while loading.");
  release = undefined;
  await page.route("**/api/note", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback(),
  );
  await page.locator(".note-title", { hasText: other }).click();
  await expect.poll(() => typeof release).toBe("function");
  await editor.fill("Kept although saving fails.");
  release();
  await expect(page.locator("#error-banner")).toBeVisible();
  await expect(page.locator("#document-title")).toHaveText(id);
  await expect(editor).toHaveText("Kept although saving fails.");
});

test("mobile workflow, focus and no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSeed(page, "# Small screen\n\nA responsive thought.");
  await expect(page.locator("#rich-editor")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await mode(page, "Split");
  await expect(page.locator("#source-pane")).toBeVisible();
  await expect(page.locator("#preview-pane")).toBeVisible();
  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("#sidebar-search")).toBeVisible();
  // Tab never reaches the note hidden beneath the open drawer.
  await page.waitForFunction(() => document.querySelector("#sidebar").getAnimations().length === 0);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".workspace, #format-panel"))).toBe(false);
  }
  // Tap the backdrop where it shows beside the drawer, not under it.
  const drawer = await page.locator("#sidebar").boundingBox();
  await page.locator("#sidebar-scrim").click({ position: { x: (drawer.x + drawer.width + 390) / 2, y: 400 } });
  await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("start-page navigation stays centered and its save indicator is hidden", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveClass(/at-home/);
  await expect(page.getByRole("navigation", { name: "Workspace", exact: true })).toBeVisible();
  for (const width of [1999, 1840, 1839, 1500, 1440, 1280, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (let toggle = 0; toggle < 2; toggle++) {
      await expect(page.locator("#save-state")).toBeHidden();
      await expect(page.locator("#app-title")).toBeEmpty();
      const headerBox = await page.locator(".topbar").boundingBox();
      const menuBox = await page.locator("#menu-bar").boundingBox();
      // Centred over the page content beside the notes panel, and in the header's height.
      const content = await page.locator(".workspace").boundingBox();
      expect(Math.abs(menuBox.x + menuBox.width / 2 - content.x - content.width / 2)).toBeLessThan(2);
      expect(Math.abs(menuBox.y + menuBox.height / 2 - headerBox.y - headerBox.height / 2)).toBeLessThan(2);
      for (const name of ["file", "edit", "view", "insert"])
        await expect(page.locator(`[data-menu="${name}"]`)).toBeInViewport();
      const sidebarToggle = await page.locator("#sidebar-toggle").boundingBox();
      const logo = await page.locator("#brand").boundingBox();
      expect(sidebarToggle.y).toBeGreaterThanOrEqual(logo.y + logo.height);
      expect(sidebarToggle.x).toBeLessThan(60);
      await expect(page.locator("#sidebar-toggle")).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      if (width < 800 && await page.locator("#sidebar-toggle").getAttribute("aria-expanded") === "true")
        await page.locator("#collapse-sidebar").click();
      else await page.locator("#sidebar-toggle").click();
    }
  }
});

test("sidebar remembers open and closed choices across reloads at home and in a note", async ({ page }) => {
  const id = await openSeed(page, "Remember the notes sidebar.");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ["/", "/?note=" + encodeURIComponent(id)]) {
      await page.goto(url);
      await expect(page.locator("#app")).toHaveClass(url === "/" ? /at-home/ : /^(?!.*at-home)/);
      // Read the choice only after initialization has restored it.
      await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", /true|false/);
      for (const open of [true, false]) {
        if ((await page.locator("#sidebar-toggle").getAttribute("aria-expanded")) !== String(open))
          await page.locator("#sidebar-toggle").click();
        await page.reload();
        await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", String(open));
        if (open) await expect(page.locator("#sidebar")).toBeInViewport();
        else await expect(page.locator("#sidebar")).not.toBeInViewport();
      }
    }
  }
  // Mobile and desktop choices remain independent across breakpoint changes.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#sidebar-toggle").click();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", "true");
});

test("collapsed sidebar and focus mode keep the workspace full width", async ({ page }) => {
  await openSeed(page, "# Room to write\n\nThe editor should use the available space.");
  await mode(page, "Markdown");
  const workspace = page.locator(".workspace");
  const frame = page.locator("#editor-frame");
  for (const width of [1440, 900, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator("#sidebar-toggle").click();
    await expect(page.locator("#sidebar")).toBeHidden();
    expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(width - 57);
    expect((await frame.boundingBox()).width).toBeCloseTo(width - 56, 0);
    await expect(page.locator("#source-pane")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.locator("#sidebar-toggle").click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await menu(page, "view");
    await page.getByRole("menuitem", { name: "Focus mode" }).click();
    await expect(page.locator("#sidebar")).toBeHidden();
    expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(width - 57);
    expect((await frame.boundingBox()).width).toBeCloseTo(width - 56, 0);
    await page.keyboard.press("Control+Shift+f");
  }
  // Keep the correct column after switching from a collapsed desktop to mobile.
  await page.locator("#sidebar-toggle").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(341);
  expect((await frame.boundingBox()).width).toBeCloseTo(342, 0);
  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("#sidebar-search")).toBeVisible();
  await page.locator("#sidebar-scrim").click({ position: { x: 378, y: 300 } });
  expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(341);
  expect((await frame.boundingBox()).width).toBeCloseTo(342, 0);
});

test("search opens at the top of the notes list, in the drawer on small screens", async ({ page }) => {
  const stamp = Date.now();
  const id = await openSeed(page, `Find headerquery${stamp} in this note.`, `Header search ${stamp}`);
  const search = page.locator("#search");
  // The header holds find and replace for the note, not a notes search.
  await expect(page.locator(".topbar #search")).toHaveCount(0);
  await expect(page.locator(".topbar #find-replace")).toHaveCount(0);
  await expect(search).toBeHidden();
  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("#sidebar")).toBeHidden();
  await page.keyboard.press("Control+Shift+e");
  await expect(search).toBeFocused();
  await expect(page.locator("#sidebar")).toBeVisible();
  for (const width of [1440, 900, 720, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await searchBox(page);
    await box.fill(`headerquery${stamp}`);
    await expect(page.locator("#note-list .note-row")).toHaveCount(1);
    await expect(page.locator("#note-list")).toContainText(id);
    await expect(search).toBeInViewport();
    // The field sits in the sidebar, just above the results.
    const field = await page.locator(".search").boundingBox();
    const list = await page.locator("#note-list").boundingBox();
    expect(field.y).toBeLessThan(list.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    if (width < 800) {
      const header = await page.locator(".topbar").boundingBox();
      const drawer = await page.locator("#sidebar").boundingBox();
      expect(drawer.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      // Wait for the drawer to finish sliding in: it can be wholly on screen
      // before it stops moving. At 320px it fills the
      // width beside the rail, leaving no backdrop to tap, so the rail's
      // Notes button closes it instead.
      await page.waitForFunction(() => document.querySelector("#sidebar").getAnimations().length === 0);
      const open = await page.locator("#sidebar").boundingBox();
      if (open.x + open.width <= width - 24) await page.locator("#sidebar-scrim").click({ position: { x: width - 12, y: 300 } });
      else await page.locator("#sidebar-toggle").click();
      await expect(page.locator("#sidebar")).not.toBeInViewport();
    }
  }
});


test("writing starts right below the header, which holds the editor controls on wide screens", async ({ page }) => {
  await openSeed(page, "# Close to the top\n\nThe first paragraph should be in view.");
  for (const [width, height] of [[1440, 900], [1280, 800], [1100, 800], [720, 450], [390, 844]]) {
    await page.setViewportSize({ width, height });
    // Menus sit above the writing controls, with compact wrapping on phones.
    const top = (await page.locator(".topbar").boundingBox()).height;
    if (width >= 1280) expect(top).toBeLessThanOrEqual(100);
    await expect(page.locator("#save-state")).toHaveAttribute("title", "All changes saved");
    expect((await page.locator("#rich-editor").boundingBox()).y).toBeLessThanOrEqual(width < 700 ? 220 : width < 800 ? 170 : width < 1280 ? 150 : 100);
    await expect(page.locator(".tiptap p")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});

test("readable footer shortcuts stay available across screen sizes and focus mode", async ({ page }) => {
  await openSeed(page, "# Readable writing\n\nA little room to think.");
  for (const width of [1440, 1100, 900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const help = page.locator("#hint-help");
    await expect(help).toBeVisible();
    await expect(help).toHaveCSS("font-size", "12px");
    await expect(help.locator("kbd")).toHaveCSS("font-size", "12px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const box = await help.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await help.click();
    await expect(page.locator("#modal")).toContainText("Browser shortcuts");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Control+Shift+f");
  await expect(page.locator("#hint-help")).toBeVisible();
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "18px");
});

test("keyboard hints, source editing, selection undo and no runtime remote requests", async ({
  page,
  baseURL,
}) => {
  const external = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL))
      external.push(request.url());
  });
  const id = await openSeed(page, "# Browser shortcuts\n\nText.");
  await mode(page, "Markdown");
  await page.locator(".cm-content").fill("First edit");
  await page.locator(".cm-content").press("Control+End");
  await page.keyboard.type(" and second");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).not.toContainText(" and second");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("First edit");
  await page
    .locator("#hint-help")
    .click();
  await expect(page.locator("#modal")).toContainText("Browser shortcuts");
  await page.keyboard.press("Escape");
  expect(external).toEqual([]);
});

test("a pending draft is read-only until acknowledged and survives another reload", async ({
  page,
}) => {
  const id = await openSeed(page, "Saved file.");
  await mode(page, "Markdown");
  await failSaves(page);
  await page.locator(".cm-content").fill("Recover this draft.");
  await expect(page.locator("#error-banner")).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  await expect(page.locator("#save-label")).toHaveText("Unsaved draft found");
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "aria-readonly",
    "true",
  );
  await page.locator(".cm-content").click();
  await page.keyboard.type("must not overwrite a pending draft");
  await expect(page.locator(".cm-content")).toHaveText("Saved file.");
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  await allowSaves(page);
  await page.locator("#restore-draft").click();
  await expect(page.locator(".cm-content")).not.toHaveAttribute(
    "aria-readonly",
    "true",
  );
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("Recover this draft.");
});

test("restoring an old draft cannot overwrite a newer disk revision", async ({
  page,
}) => {
  const id = await openSeed(page, "Original version.");
  await mode(page, "Markdown");
  await failSaves(page);
  await page.locator(".cm-content").fill("An older unsaved draft.");
  await expect(page.locator("#error-banner")).toBeVisible();
  const bootstrap = await (await page.request.get("/api/state")).json();
  const note = await (
    await page.request.get("/api/note?id=" + encodeURIComponent(id))
  ).json();
  const response = await page.request.put("/api/note", {
    headers: { "X-Labradorite-Token": bootstrap.token },
    data: { id, body: "Newer disk version.", revision: note.revision },
  });
  expect(response.ok()).toBeTruthy();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  await allowSaves(page);
  await page.locator("#restore-draft").click();
  await page.keyboard.press("Control+s");
  await expect(page.locator("#error-banner")).toBeVisible();
  expect(await diskBody(page, id)).toBe("Newer disk version.");
});

test("linked-note navigation has a back button and source history stays per note", async ({
  page,
}) => {
  const suffix = Date.now(),
    target = "Destination " + suffix;
  await seed(page, target, "A destination.");
  const origin = await openSeed(page, `[[${target}]]`, "Origin " + suffix);
  await mode(page, "Write");
  await page.locator(".wiki-link").click();
  await expect(page.locator("#document-title")).toHaveText(target);
  await page.getByRole("button", { name: "Previous note", exact: true }).click();
  await expect(page.locator("#document-title")).toHaveText(origin);
  await page.getByRole("button", { name: "Next note", exact: true }).click();
  await expect(page.locator("#document-title")).toHaveText(target);
  await page.getByRole("button", { name: "Previous note", exact: true }).click();
  await expect(page.locator("#document-title")).toHaveText(origin);
  await mode(page, "Markdown");
  await page.locator(".cm-content").fill("Edit in origin.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, origin)).toBe("Edit in origin.");
  await page.locator(`#note-list [data-note="${target}"]`).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("A destination.");
});

test("newly edited wiki links immediately produce backlinks when followed", async ({
  page,
}) => {
  const suffix = Date.now(),
    target = "Fresh target " + suffix;
  await seed(page, target, "# Target");
  const origin = await openSeed(page, "# Origin", "Fresh source " + suffix);
  await mode(page, "Markdown");
  await page.locator(".cm-content").fill(`Read [[${target}]].`);
  await expect.poll(() => diskBody(page, origin)).toBe(`Read [[${target}]].`);
  await mode(page, "Preview");
  await page.locator("#preview a").click();
  await expect(page.locator("#document-title")).toHaveText(target);
  await expect(page.locator("#backlinks-count")).toHaveText("1");
});

test("view changes never replace source edits or normalize untouched Markdown", async ({
  page,
}) => {
  const body =
    "# Exact source\n\n\n* first item\n* second item\n\nA __bold__ thought.\n";
  const id = await openSeed(page, body);
  await expect(
    page.getByRole("textbox", { name: "WYSIWYG editor" }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  expect(await diskBody(page, id)).toBe(body);
  for (const view of ["Markdown", "Preview", "Split", "Write"]) {
    await mode(page, view);
  }
  await page.waitForTimeout(600);
  expect(await diskBody(page, id)).toBe(body);
  await mode(page, "Markdown");
  await page.locator(".cm-content").fill("Source change must survive.");
  await expect
    .poll(() => diskBody(page, id))
    .toBe("Source change must survive.");
  await mode(page, "Preview");
  await expect(page.locator("#preview")).toHaveText(
    "Source change must survive.",
  );
  await page.waitForTimeout(600);
  expect(await diskBody(page, id)).toBe("Source change must survive.");
});

test("preview headings named like app controls leave the app working", async ({
  page,
}) => {
  await openSeed(page, "# Modal\n\n## Word count\n\nThree small words.");
  await mode(page, "Preview");
  await expect(page.locator("#preview h2#h-word-count")).toHaveText(
    "Word count",
  );
  await expect(page.locator("#word-count")).toHaveText(/^\d+ words$/);
  await page.locator("#settings-button").click();
  await expect(page.locator("dialog#modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog#modal")).toBeHidden();
  await mode(page, "Write");
});

test("trashing the only search match opens another note without errors", async ({
  page,
}) => {
  const stamp = Date.now();
  const keep = `Keeper ${stamp}`,
    lonely = `Lonely ${stamp}`;
  await seed(page, keep, "Still here.");
  await openSeed(page, `Unique word zephyr${stamp}.`, lonely);
  await (await searchBox(page)).fill(`zephyr${stamp}`);
  await expect(page.locator("#note-list .note-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Move note to trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("Note moved to trash.");
  await expect(page.locator("#modal")).toBeHidden();
  await expect(page.locator("#document-title")).not.toHaveText(lonely);
  await expect(page.locator("#note-list")).toContainText("No matching notes");
  await (await searchBox(page)).fill("");
  await (await searchBox(page)).fill(stamp.toString());
  await expect(page.locator("#note-list .note-row")).toHaveCount(1);
  await expect(page.locator("#note-list")).toContainText(keep);
});

test("a trash in progress cannot be dismissed and undo keeps edits made meanwhile", async ({
  page,
}) => {
  const stamp = Date.now();
  const id = `Deleting ${stamp}`;
  await seed(page, `Surviving ${stamp}`, "The surviving note.");
  await openSeed(page, "Original before trash.", id);
  await mode(page, "Markdown");
  // Let each request finish on the server but hold its answer.
  let release;
  const holdAnswer = async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => (release = resolve));
    await route.fulfill({ response });
  };
  await page.route("**/api/note", (route) =>
    route.request().method() === "DELETE" ? holdAnswer(route) : route.fallback(),
  );
  await page
    .getByRole("button", { name: "Move note to trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect.poll(() => typeof release).toBe("function");
  await expect(page.locator("#modal-cancel")).toBeDisabled();
  await expect(page.locator("#modal-close")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await expect(page.locator("#modal")).toBeVisible();
  await page.keyboard.type("Typed while the trash was pending.");
  release();
  await expect(page.locator("#modal")).toBeHidden();
  await expect(page.locator("#document-title")).not.toHaveText(id);
  const trash = await (await page.request.get("/api/trash")).json();
  expect(trash.notes.find((note) => note.id === id)?.excerpt).toContain(
    "Original before trash.",
  );
  const drafts = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("coyote-draft:")),
  );
  expect(drafts).toEqual([]);

  // Undo restores the note only after saving what was typed in the meantime.
  const current = new URL(page.url()).searchParams.get("note");
  release = undefined;
  await page.route("**/api/restore", holdAnswer);
  await page.locator("#undo-trash").click();
  await expect.poll(() => typeof release).toBe("function");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Typed during undo.");
  release();
  await expect(page.locator("#document-title")).toHaveText(id);
  await expect.poll(() => diskBody(page, current)).toContain("Typed during undo.");
  expect(await diskBody(page, id)).toBe("Original before trash.");
});

test("autosave renews a stale token after a restart but never across vaults", async ({
  page,
}) => {
  const id = await openSeed(page, "Before restart.");
  let stale = 1;
  await page.route("**/api/note", (route) => {
    const request = route.request();
    if (request.method() !== "PUT" || stale-- <= 0) return route.continue();
    return route.continue({
      headers: { ...request.headers(), "x-labradorite-token": "stale-token" },
    });
  });
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });
  await editor.fill("After restart.");
  await expect.poll(() => diskBody(page, id)).toContain("After restart.");
  await expect(page.locator("#error-banner")).toBeHidden();

  stale = 1;
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { token: "another-vault-token", vaultId: "another-vault" },
    }),
  );
  await editor.fill("Wrong vault.");
  await expect(page.locator("#error-banner")).toBeVisible();
  expect(await diskBody(page, id)).toContain("After restart.");
});

test("a server restarted on another vault cannot take over an open tab", async ({
  page,
}) => {
  const id = await openSeed(page, "Same text in both vaults.");
  // Model a restart on another vault: the old token is refused, and the new
  // server would accept only its own token for the same note name.
  let switched = false,
    leaked = false;
  await page.route("**/api/state*", async (route) => {
    if (!switched) return route.continue();
    const json = await (await route.fetch()).json();
    return route.fulfill({
      json: { ...json, token: "new-vault-token", vaultId: "another-vault" },
    });
  });
  await page.route("**/api/session", (route) =>
    switched
      ? route.fulfill({
          json: { token: "new-vault-token", vaultId: "another-vault" },
        })
      : route.continue(),
  );
  await page.route("**/api/note", (route) => {
    const request = route.request();
    if (!switched || request.method() === "GET") return route.continue();
    if (request.headers()["x-labradorite-token"] === "new-vault-token") leaked = true;
    return route.fulfill({ status: 403, json: { error: "Invalid token" } });
  });
  switched = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await (await searchBox(page)).fill("Same");
  await expect(page.locator("#error-text")).toContainText("different vault");
  await page.getByRole("textbox", { name: "WYSIWYG editor" }).fill("Edited here.");
  await expect(page.locator("#retry-save")).toHaveText("Retry save");
  await page.locator("#retry-save").click();
  await expect(page.locator("#error-text")).toContainText("different vault");
  await expect(page.locator("#download-draft")).toBeVisible();
  expect(leaked).toBe(false);
  expect(await diskBody(page, id)).toContain("Same text in both vaults.");
});

test("choosing Markdown while Write is still loading keeps Markdown and stays editable", async ({ page }) => {
  const id = `Slow write ${Date.now()}`;
  await seed(page, id, "Loaded slowly.");
  // The Write editor's code arrives late, as on a slow machine.
  await page.route("**/assets/chunk-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.goto("/?note=" + encodeURIComponent(id));
  await expect(page.locator("#document-title")).toHaveText(id);
  await mode(page, "Markdown");
  await page.waitForTimeout(2000);
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "source");
  await page.locator(".cm-content").fill("Typed in Markdown.");
  await expect.poll(() => diskBody(page, id)).toBe("Typed in Markdown.");
});

test("opening a note updates the list in place, and saves still refresh its row", async ({ page }) => {
  const stamp = Date.now();
  const first = `Inplace A ${stamp}`, second = `Inplace B ${stamp}`;
  await seed(page, second, "Second body.");
  await openSeed(page, "First body.", first);
  await page.locator("#note-sort").selectOption("title-asc");
  const row = (id) => page.locator(`.note-row[data-note="${id}"]`);
  await row(second).evaluate((el) => { el.kept = true; });
  await row(second).click();
  await expect(page.locator("#document-title")).toHaveText(second);
  await expect(row(second)).toHaveClass(/selected/);
  await expect(row(second)).toHaveAttribute("aria-current", "page");
  await expect(row(first)).not.toHaveClass(/selected/);
  expect(await row(second).evaluate((el) => el.kept)).toBe(true);
  await mode(page, "Markdown");
  await page.locator(".cm-content").fill("Edited in place.");
  await expect.poll(() => diskBody(page, second)).toBe("Edited in place.");
  // The saved row's date refreshes in place.
  await expect(row(second).locator(".note-date")).not.toBeEmpty();
  expect(await row(second).evaluate((el) => el.kept)).toBe(true);
});

test("sidebar icons start notes, open today's note, search and fold every folder", async ({ page }) => {
  const stamp = Date.now();
  await seed(page, `Fold A ${stamp}/One`, "First.");
  await openSeed(page, "Second.", `Fold B ${stamp}/Two`);
  const fold = page.locator("#fold-folders");
  await expect(fold).toHaveAttribute("aria-label", "Collapse all folders");
  await fold.click();
  await expect(page.locator(`.note-row[data-note^="Fold "]`)).toHaveCount(0);
  await expect(fold).toHaveAttribute("aria-label", "Expand all folders");
  await fold.click();
  await expect(page.locator(`.note-row[data-note^="Fold "]`)).toHaveCount(2);
  await page.getByRole("button", { name: "Search all notes" }).click();
  await expect(page.locator("#search")).toBeFocused();
  await page.locator("#search").fill("Fold");
  // The field stays open when focus moves on, and the icon closes it again.
  await page.locator("#note-sort").focus();
  await expect(page.locator("#search")).toBeVisible();
  await page.getByRole("button", { name: "Search all notes" }).click();
  await expect(page.locator("#search")).toBeHidden();
  await expect(page.locator("#search")).toHaveValue("");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New note" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Today's note" }).click();
  await expect(page.getByRole("button", { name: "Browse Journal", exact: true })).toBeVisible();
});

test("the logo goes to the start page and back returns to the note that was open", async ({ page }) => {
  const id = await openSeed(page, "Come back to me.");
  await page.evaluate(() => { window.stayed = true; });
  await page.locator("#brand").click();
  await expect(page.locator("#empty-state")).toBeVisible();
  // No reload: the page and its back history are the same.
  expect(await page.evaluate(() => window.stayed)).toBe(true);
  await expect(page.locator("#history-back")).toBeEnabled();
  await page.locator("#history-back").click();
  await expect(page.locator("#document-title")).toHaveText(id);
  await expect(page.locator("#history-back")).toBeDisabled();
});

test("search scope switches to this note while keeping the same query", async ({ page }) => {
  await openSeed(page, "Replace the old word, then the old word again.");
  const box = await searchBox(page);
  await box.fill("old word");
  await page.getByRole("button", { name: "Find and replace in this note" }).click();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "source");
  await expect(page.locator("#search")).toHaveValue("old word");
  await expect(page.locator("#search-replacement")).toBeVisible();
  // Without an open note there is nothing to search in.
  await page.goto("/");
  await (await searchBox(page)).click();
  await expect(page.getByRole("button", { name: "Find and replace in this note" })).toBeHidden();
});

test("controls show themed tooltips with their shortcut instead of the browser's", async ({ page }) => {
  await openSeed(page, "Tooltips.");
  const bold = page.locator('[data-format="bold"]');
  const tip = page.locator(".tooltip");
  await bold.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Bold");
  await expect(tip.locator("kbd")).toHaveText(/^(Ctrl B|⌘B)$/);
  // The title is set aside while ours shows, so the browser's never does.
  await expect(bold).not.toHaveAttribute("title");
  await page.mouse.move(700, 500);
  await expect(tip).toBeHidden();
  await expect(bold).toHaveAttribute("title", "Bold · Ctrl/⌘ B");
  // Keyboard focus shows it at once, and Escape hides it.
  await page.locator("#history-button").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#export-note")).toBeFocused();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText("Download Markdown");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
});

test("an open tab picks up outside changes on its own, but not its own saves", async ({
  page,
}) => {
  const id = await openSeed(page, "Original text.");
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });
  let lists = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/state") lists++;
  });
  await editor.fill("Saved here.");
  await expect.poll(() => diskBody(page, id)).toBe("Saved here.");
  // Several polls pass without fetching the list for this tab's own save.
  await page.waitForTimeout(3500);
  await page.waitForResponse((r) => r.url().endsWith("/api/stamp"));
  expect(lists).toBe(0);

  const bootstrap = await (await page.request.get("/api/state")).json();
  const note = await (
    await page.request.get("/api/note?id=" + encodeURIComponent(id))
  ).json();
  await page.request.put("/api/note", {
    headers: { "X-Labradorite-Token": bootstrap.token },
    data: { id, body: "Edited elsewhere.", revision: note.revision },
  });
  const outside = `Outside live ${Date.now()}`;
  await seed(page, outside, "Made by another program.");
  // No focus event: the tab notices by itself.
  await expect(editor).toContainText("Edited elsewhere.", { timeout: 8000 });
  await expect(page.locator("#toast")).toContainText("Reloaded changes");
  await expect(page.locator("#note-list")).toContainText(outside);
});

test("returning to the tab picks up notes changed outside the app", async ({
  page,
}) => {
  const id = await openSeed(page, "Original text.");
  const bootstrap = await (await page.request.get("/api/state")).json();
  const note = await (
    await page.request.get("/api/note?id=" + encodeURIComponent(id))
  ).json();
  await page.request.put("/api/note", {
    headers: { "X-Labradorite-Token": bootstrap.token },
    data: { id, body: "Edited elsewhere.", revision: note.revision },
  });
  const outside = `Outside ${Date.now()}`;
  await seed(page, outside, "Made by another program.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });
  await expect(editor).toContainText("Edited elsewhere.");
  await expect(page.locator("#toast")).toContainText("Reloaded changes");
  await expect(page.locator("#note-list")).toContainText(outside);

  await editor.fill("Local edit in progress.");
  await expect.poll(() => diskBody(page, id)).toBe("Local edit in progress.");
  await page.route("**/api/note", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "offline" } })
      : route.continue(),
  );
  await editor.fill("Unsaved local words.");
  await expect(page.locator("#error-banner")).toBeVisible();
  const latest = await (
    await page.request.get("/api/note?id=" + encodeURIComponent(id))
  ).json();
  await page.request.put("/api/note", {
    headers: { "X-Labradorite-Token": bootstrap.token },
    data: { id, body: "Second outside edit.", revision: latest.revision },
  });
  const later = `Outside later ${Date.now()}`;
  await seed(page, later, "Also made elsewhere.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#note-list")).toContainText(later);
  await expect(editor).toContainText("Unsaved local words.");
});

test("keyboard shortcuts run their actions and match the help list", async ({
  page,
}) => {
  await openSeed(page, "Shortcut practice.");
  await page.keyboard.press("F1");
  await expect(page.locator("#modal-title")).toHaveText(
    "Keyboard shortcuts",
  );
  await expect(page.locator(".help-grid kbd")).toHaveCount(18);
  await expect(page.locator(".help-grid")).toContainText("Cycle writing views");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+Shift+M");
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "source");
  await page.keyboard.press("Alt+m");
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "preview");
  await page.keyboard.press("Alt+m");
  await page.keyboard.press("Alt+m");
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "write");
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator("#app")).toHaveClass(/focus-mode/);
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator("#app")).not.toHaveClass(/focus-mode/);
  await page.keyboard.press("Alt+t");
  await expect(page.locator("#modal-title")).toHaveText("Settings");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox", { name: "Search notes, headings and commands" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+Shift+E");
  await expect(page.locator("#search")).toBeFocused();
});

test("the trash lists trashed notes and restores any of them", async ({
  page,
}) => {
  const stamp = Date.now();
  const first = `Trashed first ${stamp}`,
    second = `Trashed second ${stamp}`;
  for (const id of [first, second]) {
    await openSeed(page, `Body of ${id}.`, id);
    await page
      .getByRole("button", { name: "Move note to trash", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move to trash", exact: true })
      .click();
    await expect(page.locator("#toast")).toContainText("Note moved to trash.");
  }
  await page.locator("#trash-button").click();
  await expect(page.locator("#modal-title")).toHaveText("Trash");
  await expect(page.locator(".trash-list")).toContainText(first);
  await expect(page.locator(".trash-list")).toContainText(`Body of ${second}.`);
  await page.getByRole("button", { name: "Restore " + first }).click();
  await expect(page.locator("#modal")).toBeHidden();
  await expect(page.locator("#document-title")).toHaveText(first);
  expect(await diskBody(page, first)).toBe(`Body of ${first}.`);
  await page.locator("#trash-button").click();
  await expect(page.locator(".trash-list")).not.toContainText(first);
  await expect(page.locator(".trash-list")).toContainText(second);
});

test("a conflict compares both versions and keeps whichever is chosen", async ({
  page,
  context,
}) => {
  const id = await openSeed(page, "Shared line.\nOriginal ending.");
  await mode(page, "Markdown");
  const second = await context.newPage();
  await second.goto("/?note=" + encodeURIComponent(id));
  await mode(second, "Markdown");
  // Hold a dirty tab's save while its peer writes. A clean tab may correctly
  // reload external changes on focus or on the three-second vault check.
  async function holdSave(tab) {
    let arrive, release;
    const pending = new Promise((resolve) => { arrive = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    await tab.route("**/api/note", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      arrive();
      await gate;
      await route.continue();
    }, { times: 1 });
    return { pending, release };
  }
  const secondSave = await holdSave(second);
  await second.locator(".cm-content").fill("Shared line.\nSecond tab ending.");
  await secondSave.pending;
  await page.locator(".cm-content").fill("Shared line.\nFirst tab ending.");
  await expect.poll(() => diskBody(page, id)).toContain("First tab ending.");
  secondSave.release();
  await expect(second.locator("#compare-versions")).toBeVisible();
  await expect(second.locator("#compare-versions")).toHaveClass(/primary/);
  await expect(second.locator("#retry-save")).not.toHaveClass(/primary/);
  await expect(second.locator("#save-label")).toHaveText("Not saved");
  await second.locator("#compare-versions").click();
  const disk = second.getByLabel("On disk", { exact: true });
  const mine = second.getByLabel("Your edits", { exact: true });
  await expect(disk).toContainText("First tab ending.");
  await expect(mine).toContainText("Second tab ending.");
  await expect(disk.locator(".changed")).toHaveText(["First tab ending."]);
  await expect(mine.locator(".changed")).toHaveText(["Second tab ending."]);
  const firstSave = await holdSave(page);
  await page.locator(".cm-content").fill("Shared line.\nFirst tab again.");
  await firstSave.pending;
  await second.getByRole("button", { name: "Keep my edits" }).click();
  await expect(second.locator("#error-banner")).toBeHidden();
  await expect.poll(() => diskBody(page, id)).toContain("Second tab ending.");

  firstSave.release();
  await expect(page.locator("#compare-versions")).toBeVisible();
  await page.locator("#compare-versions").click();
  await page.getByRole("button", { name: "Use disk version" }).click();
  await expect(page.locator(".cm-content")).toContainText("Second tab ending.");
  await expect(page.locator("#error-banner")).toBeHidden();
  expect(await diskBody(page, id)).toContain("Second tab ending.");
  await second.close();
});

test("note rows show only the title and edit date", async ({
  page,
}) => {
  const id = `Seed list ${Date.now()}`;
  await openSeed(page, `# ${id}\n\nStart the beans in May.`, id);
  const row = page.locator(`#note-list .note-row[data-note="${id}"]`);
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(row.locator(".note-title")).toHaveText(id);
  await expect(row.locator(".note-date")).not.toBeEmpty();
  await expect(row.locator(".note-excerpt")).toHaveCount(0);
  await expect(row).not.toContainText("Start the beans");
});

test("search results show the matching passage with the match marked", async ({
  page,
}) => {
  const word = `marigold${Date.now()}`;
  const id = await openSeed(
    page,
    `# Garden\n\n${"Opening words. ".repeat(12)}Plant the ${word} <b>beds</b> early.`,
  );
  await (await searchBox(page)).fill(word.toUpperCase());
  const row = page.locator(`#note-list .note-row[data-note="${id}"]`);
  await expect(row.locator("mark")).toHaveText(word);
  await expect(row.locator(".note-excerpt")).toContainText(
    `Plant the ${word} <b>beds</b> early.`,
  );
  await expect(row.locator(".note-excerpt b")).toHaveCount(0);
  await (await searchBox(page)).fill("");
  await expect(row.locator("mark")).toHaveCount(0);
});

test("typing in search after closing a dialog never lands in the note", async ({
  page,
}) => {
  const stamp = Date.now();
  const kept = `Kept ${stamp}`;
  await seed(page, kept, "Kept body.");
  await openSeed(page, "Leaving.", `Leaving ${stamp}`);
  await page
    .getByRole("button", { name: "Move note to trash", exact: true })
    .click();
  // Hold frames only during the dialog-close/note-open transition. Install
  // inside the click so Playwright's confirmation action remains actionable.
  await page.evaluate(() => {
    const frame = window.requestAnimationFrame.bind(window);
    const pending = [];
    window.__restoreAnimationFrame = () => { window.requestAnimationFrame = frame; };
    window.__releaseAnimationFrames = () => new Promise(resolve => {
      for (const callback of pending.splice(0)) frame(callback);
      frame(() => frame(resolve));
    });
    document.getElementById("modal-submit").addEventListener("click", () => {
      window.requestAnimationFrame = callback => {
        pending.push(callback);
        return -pending.length;
      };
    }, { once: true, capture: true });
  });
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("Note moved to trash.");
  // New search actions use normal frames. App callbacks queued during the
  // transition remain held until typing has moved to the search input.
  await page.evaluate(() => window.__restoreAnimationFrame());
  const opened = await page
    .locator("#note-list .note-row.selected")
    .getAttribute("data-note");
  await (await searchBox(page)).click();
  await page.keyboard.type(`k${stamp}`, { delay: 40 });
  await expect(page.locator("#search")).toHaveValue(`k${stamp}`);
  await page.evaluate(() => window.__releaseAnimationFrames());
  await expect(page.locator("#search")).toBeFocused();
  expect(await diskBody(page, opened)).not.toContain(String(stamp));
});

test("quick open finds notes by a few letters, jumps to headings and runs commands", async ({
  page,
}) => {
  const stamp = Date.now();
  const target = `Projects/Quarterly zebra plan ${stamp}`;
  await seed(page, target, "# Goals\n\nText.\n\n## Risks\n\nMore text.\n\n## Budget\n\nNumbers.");
  await openSeed(page, "Start here.", `Palette start ${stamp}`);
  const input = page.getByRole("combobox", { name: "Search notes, headings and commands" });
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  // Letters from the start of each word are enough.
  await input.fill(`qzp ${stamp}`);
  await expect(page.locator(".palette-option").first()).toContainText(`Quarterly zebra plan ${stamp}`);
  await expect(page.locator(".palette-option").first().locator("mark")).not.toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.locator("#document-title")).toHaveText(`Quarterly zebra plan ${stamp}`);

  // # lists the open note's headings and brings one into view.
  await mode(page, "Markdown");
  await page.keyboard.press("Control+k");
  await input.fill("#bud");
  await expect(page.locator(".palette-option")).toHaveCount(1);
  await expect(page.locator(".palette-option")).toContainText("Budget");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-lineNumbers .cm-activeLineGutter")).toHaveText("9");

  // > runs commands; what was typed can become a new note.
  await page.keyboard.press("Control+k");
  await input.fill(">split");
  await page.keyboard.press("Enter");
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "split");
  await page.locator("#hint-open").click();
  await input.fill(`Fresh idea ${stamp}`);
  await page.getByRole("option", { name: `Create note “Fresh idea ${stamp}”` }).click();
  await expect(page.locator("#document-title")).toHaveText(`Fresh idea ${stamp}`);
  await page.keyboard.press("Control+k");
  await input.fill(`nothingmatcheszz${stamp}`);
  await expect(page.locator(".palette-option").first()).toContainText("Search note contents for");
});

test("the outline lists headings, jumps to them, follows scrolling and stays open", async ({
  page,
}) => {
  const filler = (word) => Array.from({ length: 40 }, (_, i) => `${word} line ${i}.`).join("\n\n");
  const body = `# Top\n\n${filler("Intro")}\n\n## Middle [[Target|section]]\n\n${filler("More")}\n\n### Deep end\n\n${filler("Last")}`;
  const id = await openSeed(page, body);
  const outline = page.getByRole("complementary", { name: "Outline" });
  await expect(outline).toBeHidden();
  await page.getByRole("button", { name: "Show outline" }).click();
  await expect(outline.getByRole("button")).toHaveText(["Top", "Middle section", "Deep end"]);
  const depth = (name) =>
    outline.getByRole("button", { name }).evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(parseFloat(await depth("Deep end"))).toBeGreaterThan(parseFloat(await depth("Top")));

  // Clicking a heading brings it to the top, and the outline marks it.
  await outline.getByRole("button", { name: "Deep end" }).click();
  await expect
    .poll(() =>
      page.locator(".tiptap h3").evaluate((el) => {
        const pane = document.getElementById("rich-pane").getBoundingClientRect();
        return Math.abs(el.getBoundingClientRect().top - pane.top) < 60;
      }),
    )
    .toBe(true);
  await expect(outline.locator("[aria-current]")).toHaveText("Deep end");
  await page.locator("#rich-pane").evaluate((el) => el.scrollTo(0, 0));
  await expect(outline.locator("[aria-current]")).toHaveText("Top");

  // Markdown view: typing a heading adds it; jumping moves the cursor there.
  await mode(page, "Markdown");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  // Keys sent with no gap can land out of order while CodeMirror scrolls a
  // long note; a short gap is still far faster than anyone types.
  await page.keyboard.type("\n\n## Added later", { delay: 20 });
  await expect(outline.getByRole("button")).toHaveText(["Top", "Middle section", "Deep end", "Added later"]);
  await outline.getByRole("button", { name: "Middle section" }).click();
  await expect(page.locator(".cm-lineNumbers .cm-activeLineGutter")).toHaveText("83");
  await expect(outline.locator("[aria-current]")).toHaveText("Middle section");
  await expect.poll(() => diskBody(page, id)).toContain("## Added later");

  // The panel stays open across reloads, and Alt+O closes it.
  await page.reload();
  await expect(outline).toBeVisible();
  await page.keyboard.press("Alt+o");
  await expect(outline).toBeHidden();
  await page.reload();
  await expect(outline).toBeHidden();
  await openSeed(page, "No headings here.");
  await page.keyboard.press("Alt+o");
  await expect(outline).toContainText("No headings yet");
  await page.keyboard.press("Alt+o");
});

test("folders collapse, stay collapsed, and take notes dragged onto them", async ({
  page,
}) => {
  const stamp = Date.now();
  const draft = `Draft ${stamp}`;
  const inbox = `Inbox ${stamp}`,
    archive = `Archive ${stamp}`;
  await seed(page, `${archive}/Old plan`, "Archived.");
  const idea = `Loose idea ${stamp}`;
  await seed(page, `${inbox}/${idea}`, "An idea.");
  // Outside its own folder, a short link prefers this namesake by name order.
  await seed(page, `Aardvark ${stamp}/${idea}`, "A namesake elsewhere.");
  await seed(page, `${inbox}/Linker`, `See [[${idea}]].`);
  await openSeed(page, "Open while moving.", `${inbox}/${draft}`);
  const folder = (name) => page.locator(`.folder-group[data-folder="${name}"]`);
  const row = (id) => page.locator(`.note-row[data-note="${id}"]`);

  // Collapsing hides a folder's notes but keeps its count, across reloads.
  await folder(archive).click();
  await expect(folder(archive)).toHaveAttribute("aria-expanded", "false");
  await expect(folder(archive)).toContainText("1");
  await expect(row(`${archive}/Old plan`)).toHaveCount(0);
  await page.reload();
  await expect(row(`${archive}/Old plan`)).toHaveCount(0);
  // Searching still lists matches inside collapsed folders.
  await (await searchBox(page)).fill(`Archived`);
  await expect(row(`${archive}/Old plan`)).toBeVisible();
  await (await searchBox(page)).fill("");
  await expect(row(`${archive}/Old plan`)).toHaveCount(0);

  // Dragging a note onto a folder moves it, and links follow it rather
  // than falling to the namesake.
  await row(`${inbox}/${idea}`).dragTo(folder(archive));
  await expect(page.locator("#toast")).toContainText(`Moved “${idea}” to ${archive}.`);
  expect(await diskBody(page, `${archive}/${idea}`)).toBe("An idea.");
  await expect.poll(() => diskBody(page, `${inbox}/Linker`)).toBe(`See [[${archive}/${idea}]].`);

  // The open note can be moved too, onto a note's folder or the top level.
  await row(`${inbox}/${draft}`).dragTo(row(`${inbox}/Linker`));
  await expect(page.locator("#document-title")).toHaveText(draft);
  // Without top-level notes, the top level appears as a drop zone once
  // dragging starts. Searching keeps the source and target both in view.
  await (await searchBox(page)).fill(String(stamp));
  await expect(page.locator("#note-list")).toHaveClass(/searching/);
  await expect(row(`${inbox}/${draft}`)).toBeVisible();
  await row(`${inbox}/${draft}`).hover();
  await page.mouse.down();
  await page.mouse.move(40, 400, { steps: 4 });
  await folder("").last().hover();
  await page.mouse.up();
  await expect(page.locator("#note-folder")).toHaveText("");
  await expect(page.locator("#document-title")).toHaveText(draft);
  expect(await diskBody(page, draft)).toBe("Open while moving.");

  // Opening a note inside a collapsed folder expands it.
  await page.goto("/?note=" + encodeURIComponent(`${archive}/Old plan`));
  await expect(folder(archive)).toHaveAttribute("aria-expanded", "true");
  await expect(row(`${archive}/Old plan`)).toBeVisible();
});

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("images show in Write and Preview, keep their Markdown, and can be pasted, dropped or picked", async ({
  page,
}) => {
  const bootstrap = await (await page.request.get("/api/state")).json();
  const upload = await page.request.post("/api/attachment?name=diagram.png", {
    headers: { "X-Labradorite-Token": bootstrap.token, "Content-Type": "image/png" },
    data: pixel,
  });
  const { path } = await upload.json();
  const body = `Before.\n\n![A diagram](${path})\n\n![tracker](https://example.com/t.png)`;
  const id = await openSeed(page, body, `Images/Pictures ${Date.now()}`);
  await expect(page.locator("#rich-pane")).toBeVisible();
  const picture = page.locator(".tiptap img[data-image-src]").first();
  await expect(picture).toHaveAttribute("alt", "A diagram");
  await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBe(1);
  await expect(page.locator(".tiptap .image-placeholder")).toHaveText("[image: tracker]");
  await page.locator(".tiptap p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Edited.");
  await expect.poll(() => diskBody(page, id)).toContain("Before. Edited.");
  expect(await diskBody(page, id)).toContain(`![A diagram](${path})`);
  expect(await diskBody(page, id)).toContain("![tracker](https://example.com/t.png)");
  await mode(page, "Preview");
  await expect.poll(() => page.locator("#preview img").evaluate((img) => img.naturalWidth)).toBe(1);

  // A pasted screenshot is saved in the vault and linked where the cursor is.
  await mode(page, "Write");
  await page.locator(".tiptap p").first().click();
  await page.evaluate((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
    document.querySelector(".tiptap").dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, [...pixel]);
  await expect.poll(() => diskBody(page, id)).toMatch(/!\[pasted \d+\]\(attachments\/pasted-\d+\.png\)/);
  await expect(page.locator(".tiptap img[data-image-src]")).toHaveCount(2);

  // Dropping a file into the Markdown source inserts its link there.
  await mode(page, "Markdown");
  await page.evaluate((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "Holiday photo.png", { type: "image/png" }));
    const target = document.querySelector(".cm-content");
    const box = target.getBoundingClientRect();
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.left + 5, clientY: box.top + 5 }),
    );
  }, [...pixel]);
  await expect.poll(() => diskBody(page, id)).toContain("![Holiday photo](attachments/Holiday-photo.png)");

  // The toolbar button picks files.
  await mode(page, "Write");
  await page.locator(".tiptap p").first().click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Insert image" }).click(),
  ]);
  await chooser.setFiles({ name: "chart.png", mimeType: "image/png", buffer: pixel });
  await expect.poll(() => diskBody(page, id)).toContain("![chart](attachments/chart.png)");
  const notes = (await (await page.request.get("/api/state")).json()).notes.map((n) => n.id);
  expect(notes.some((note) => note.startsWith("attachments/"))).toBe(false);
});

for (const gap of ["\n", "\n\n"]) {
  test(`highlighting text in a ${gap.length === 1 ? "tight" : "loose"} numbered list keeps wiki links`, async ({ page }) => {
    const text = ["3) Why small tools last longer", "4) A year of [[Habits|habit tracking]] in plain text", "5) What [[Reading/Design]] taught me"].join(gap) + "\n";
    const id = await openSeed(page, text);
    await mode(page, "Write");
    await expect(page.locator(".tiptap ol .wiki-link")).toHaveCount(2);
    await expect(page.locator(".tiptap ol")).toHaveAttribute("start", "3");
    const item = page.locator(".tiptap ol li").nth(1);
    await item.click();
    await page.keyboard.press("Home");
    for (let i = 0; i < "A year of".length; i++) await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("A year of");
    await page.locator('[data-format="highlight"][data-colour="🟠"]').click();
    const edited = text.replace("A year of", "==🟠A year of==");
    await expect.poll(() => diskBody(page, id)).toBe(edited);
    await mode(page, "Markdown"); await mode(page, "Write");
    await expect(page.locator(".tiptap ol .wiki-link")).toHaveCount(2);
    expect(await diskBody(page, id)).toBe(edited);
  });
}

test("a slow rename is not mistaken for a change made outside the app", async ({ page }) => {
  const id = await openSeed(page, "Slow rename body.", "Slow original");
  await openSeed(page, "Links to [[Slow original]].", "Slow linker");
  await page.goto("/?note=" + encodeURIComponent(id));
  await expect(page.locator("#document-title")).toHaveText(id);
  // The vault changes at once, but the answer arrives after the 3-second
  // change watcher has looked again.
  await page.route("**/api/rename", async (route) => {
    const response = await route.fetch();
    await new Promise((done) => setTimeout(done, 4000));
    await route.fulfill({ response });
  });
  await page.locator("#document-title").click();
  await page.getByLabel("Note name").fill("Slow renamed");
  await page.keyboard.press("Enter");
  await expect(page.locator("#document-title")).toHaveText("Slow renamed");
  await expect.poll(() => diskBody(page, "Slow linker")).toBe("Links to [[Slow renamed]].");
  await page.waitForTimeout(3500);
  await expect(page.locator("#document-title")).toHaveText("Slow renamed");
  await expect(page.getByText("moved or deleted outside Labradorite")).toHaveCount(0);
});

test("clicking the note title renames its name while the dialog can move it", async ({ page }) => {
  const stamp = Date.now();
  const id = await openSeed(page, "Title rename body.", `Inline rename ${stamp}`);
  await openSeed(page, "Links to [[Inline rename " + stamp + "]].", `Inline linker ${stamp}`);
  await openSeed(page, "Already here.", `Taken ${stamp}`);
  await page.goto("/?note=" + encodeURIComponent(id));
  const title = page.locator("#document-title");
  const field = page.getByLabel("Note name");
  // The field holds only the name, selected; Escape cancels.
  await title.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(id);
  expect(await field.evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd))).toBe(id);
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(title).toBeFocused();
  await expect(title).toHaveText(id);
  // Enter with the same path, or leaving the field, changes nothing.
  await title.click(); await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0);
  await title.click(); await page.locator(".tiptap").click();
  await expect(field).toHaveCount(0);
  // An existing name is refused at the field, and nothing is renamed.
  await title.click();
  await field.fill(`Taken ${stamp}`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(await diskBody(page, id)).toBe("Title rename body.");
  // Inline paths are refused; moving remains in the File menu.
  await field.fill(`Moved ${stamp}/Inline rename ${stamp}`);
  await page.keyboard.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText("To move this note");
  await page.keyboard.press("Escape");
  await menu(page, "file");
  await page.getByRole("menuitem", { name: /^Rename or move…/ }).click();
  await page.getByLabel("Note path", { exact: true }).fill(`Moved ${stamp}/Inline rename ${stamp}`);
  await page.getByRole("button", { name: "Rename note", exact: true }).click();
  await expect(field).toHaveCount(0);
  await expect(title).toHaveText(`Inline rename ${stamp}`);
  await expect(page.locator("#note-folder")).toContainText(`Moved ${stamp}`);
  await expect.poll(() => new URL(page.url()).searchParams.get("note")).toBe(`Moved ${stamp}/Inline rename ${stamp}`);
  expect(await diskBody(page, `Inline linker ${stamp}`)).toBe(`Links to [[Inline rename ${stamp}]].`);
  // Renaming it does rewrite that link.
  await title.click();
  await expect(field).toHaveValue(`Inline rename ${stamp}`);
  await field.fill(`Renamed ${stamp}`);
  await page.keyboard.press("Enter");
  await expect(title).toHaveText(`Renamed ${stamp}`);
  await expect.poll(() => diskBody(page, `Inline linker ${stamp}`)).toBe(`Links to [[Renamed ${stamp}]].`);
  // On a phone the field fits the narrower title row.
  await page.setViewportSize({ width: 390, height: 844 });
  await title.click();
  await expect(field).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
});

test("inline title editing preserves a nested folder, links, pins and recent notes", async ({ page }) => {
  const stamp = Date.now();
  const folder = `Work/Nested ${stamp}/`;
  const name = `Original ${stamp}`;
  const id = folder + name;
  const taken = `Taken ${stamp}`;
  const renamed = "Renamed café 🐾";
  const target = folder + renamed;
  const linker = await openSeed(page, `Links to [[${id}]] and [[${name}]].`, `Linker ${stamp}`);
  await seed(page, folder + taken, "Already here.");
  await openSeed(page, "Keep this body.", id);
  await page.getByRole("button", { name: "Pin note", exact: true }).click();
  const title = page.locator("#document-title");
  const field = page.getByRole("textbox", { name: "Note name", exact: true });
  await title.focus(); await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(name);
  await expect(page.locator("#note-folder")).toBeVisible();
  const breadcrumbBox = await page.locator("#note-folder").boundingBox();
  const nameBox = await field.boundingBox();
  expect(nameBox.x).toBeGreaterThanOrEqual(breadcrumbBox.x + breadcrumbBox.width);
  expect(await field.evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd))).toBe(name);
  await field.fill("Cancelled"); await page.keyboard.press("Escape");
  await expect(title).toHaveText(name);
  await expect(title).toBeFocused();
  await title.click(); await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0);
  await title.click(); await field.fill(""); await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0);
  await title.click();
  for (const invalid of ["Elsewhere/Name", "Elsewhere\\Name", ".", ".."]) {
    await field.fill(invalid); await page.keyboard.press("Enter");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toContainText("To move this note");
    expect(new URL(page.url()).searchParams.get("note")).toBe(id);
  }
  await field.fill(taken); await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("already exists");
  await expect(field).toHaveValue(taken);
  await field.fill(renamed); await page.keyboard.press("Enter");
  await expect(title).toHaveText(renamed);
  await expect.poll(() => new URL(page.url()).searchParams.get("note")).toBe(target);
  await expect(page.locator("#note-folder")).toContainText(`Nested ${stamp}`);
  await expect(page.locator("#pinned-list .navigation-note")).toHaveAttribute("data-note", target);
  await expect.poll(() => diskBody(page, linker)).toBe(`Links to [[${target}]] and [[${renamed}]].`);
  expect(await diskBody(page, target)).toBe("Keep this body.");
  await page.locator("#recent-notes").click();
  await expect(page.locator("#recent-list .navigation-note").first()).toHaveAttribute("data-note", target);
  await expect(page.locator(`#recent-list [data-note="${id}"]`)).toHaveCount(0);
});

test("an image that finishes uploading after leaving its note is not added to another", async ({ page }) => {
  const stamp = Date.now();
  const other = await openSeed(page, "The other note.", `Upload target B ${stamp}`);
  const id = await openSeed(page, "Started here.", `Upload source A ${stamp}`);
  await mode(page, "Write");
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/attachment*", async (route) => { await held; await route.continue(); });
  await page.locator(".tiptap p").first().click();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  await page.evaluate((png) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "late.png", { type: "image/png" }));
    document.querySelector(".tiptap").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, png);
  await page.locator("#note-list .note-row").filter({ hasText: `Upload target B ${stamp}` }).click();
  await expect(page.locator("#document-title")).toHaveText(`Upload target B ${stamp}`);
  release();
  await expect(page.locator("#toast-text")).toContainText("finished uploading after you left");
  await expect(page.locator("#toast-text")).toContainText("attachments/late.png");
  expect(await diskBody(page, other)).toBe("The other note.");
  expect(await diskBody(page, id)).toBe("Started here.");
});

test("note history shows earlier versions with changes marked and restores one", async ({
  page,
}) => {
  const id = await openSeed(page, "First line.\nKept line.");
  await mode(page, "Markdown");
  await page.locator(".cm-content").fill("Rewritten line.\nKept line.");
  await expect.poll(() => diskBody(page, id)).toBe("Rewritten line.\nKept line.");
  await page.getByRole("button", { name: "Note history" }).click();
  const dialog = page.getByRole("dialog", { name: "Note history" });
  await expect(dialog.getByRole("option")).toHaveCount(1);
  const preview = dialog.getByLabel("Version text");
  await expect(preview).toContainText("First line.");
  await expect(preview.locator(".changed")).toHaveText("First line.");
  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toHaveText("First line.Kept line.");
  expect(await diskBody(page, id)).toBe("First line.\nKept line.");
  await expect(page.locator("#toast")).toContainText("Restored the version from");

  // The replaced text became a version too, so the restore can be undone.
  await page.keyboard.press("Control+k");
  await page.keyboard.type(">history");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await expect(dialog.getByLabel("Version text")).toContainText("Rewritten line.");
  await page.keyboard.press("Escape");

  await openSeed(page, "");
  await page.getByRole("button", { name: "Note history" }).click();
  await expect(page.getByRole("dialog", { name: "Note history" })).toContainText("No earlier versions yet");
});

test("front matter shows as properties in Write and keeps its exact form", async ({
  page,
}) => {
  for (const front of [
    "---\ntitle: Keep this metadata\n# a YAML comment\n---\n\n",
    "\uFEFF---\ntitle: With a byte order mark\n---\n\n",
    '+++\ntitle = "TOML"\n+++\n\n',
  ]) {
    const id = await openSeed(page, front + "# Heading\n\nBody text.");
    await mode(page, "Write");
    await expect(page.locator("#rich-pane")).toBeVisible();
    if (await page.getByRole("button", { name: "Edit YAML", exact: true }).isVisible())
      await page.getByRole("button", { name: "Edit YAML", exact: true }).click();
    const box = page.getByLabel("Properties", { exact: true });
    await expect(box).toHaveValue(front.replace(/^\uFEFF/, "").split("\n").slice(1, -3).join("\n"));
    await page.locator(".tiptap p").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" More.");
    await expect.poll(() => diskBody(page, id)).toBe(front + "# Heading\n\nBody text. More.");
  }
  // The outline skips YAML comments, and properties can be edited.
  const id = await openSeed(page, "---\ntitle: Old\n# not a heading\n---\n\n# Real heading\n\nText.");
  await page.keyboard.press("Alt+o");
  await expect(page.locator("#outline-list button")).toHaveText(["Real heading"]);
  await page.keyboard.press("Alt+o");
  await page.getByRole("button", { name: "Edit YAML", exact: true }).click();
  await page.getByLabel("Properties").fill("title: New\ntags: [travel, plans]");
  await expect.poll(() => diskBody(page, id)).toBe("---\ntitle: New\ntags: [travel, plans]\n---\n\n# Real heading\n\nText.");
  const bodyParagraph = page.locator(".tiptap p");
  await bodyParagraph.click();
  await page.keyboard.press("Home");
  await caretAt(page, "Text.", 0);
  await page.keyboard.type("Typed ");
  await expect.poll(() => diskBody(page, id)).toBe("---\ntitle: New\ntags: [travel, plans]\n---\n\n# Real heading\n\nTyped Text.");

  // A note without front matter can start some.
  const plain = await openSeed(page, "Plain text.");
  await expect(page.getByLabel("Properties")).toBeHidden();
  await page.keyboard.press("Control+k");
  await page.keyboard.type(">add properties");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("tags", { exact: true })).toBeFocused();
  await page.keyboard.type("journal");
  await page.keyboard.press("Tab");
  await expect.poll(() => diskBody(page, plain)).toBe('---\ntags: ["journal"]\n---\n\nPlain text.');
});

test("tags from properties and text filter the note list", async ({ page }) => {
  const stamp = Date.now();
  const tag = `trip${stamp}`;
  await seed(page, `Tagged A ${stamp}`, `---\ntags: [${tag}]\n---\nFirst.`);
  await seed(page, `Tagged B ${stamp}`, `Second, about #${tag.toUpperCase()} and #other${stamp}.`);
  await seed(page, `Untagged ${stamp}`, "Third, `#${tag}` in code only.");
  await openSeed(page, `Read about #${tag} here.`, `Reader ${stamp}`);
  const disclosure = page.locator("#tag-filter");
  const tagsButton = page.getByRole("button", { name: "All tags", exact: true });
  await expect(tagsButton).toBeVisible();
  await tagsButton.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(tagsButton).toHaveAttribute("aria-expanded", "true");
  const filter = page.getByRole("group", { name: "Show notes with a tag" });
  const choice = filter.locator(`button[data-tag="${tag}"]`);
  await expect(choice).toContainText(`#${tag}`);
  await expect(choice.locator(".tag-count")).toHaveText("3");
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(page.locator("#note-list .note-row")).toHaveCount(3);
  await expect(page.locator("#note-list")).not.toContainText(`Untagged ${stamp}`);
  await filter.locator('button[data-tag=""]').click();
  await expect(page.locator("#note-list")).toContainText(`Untagged ${stamp}`);

  // Tags in Preview are buttons that apply the filter.
  await mode(page, "Preview");
  await page.locator("#preview .tag", { hasText: `#${tag}` }).click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#note-list .note-row")).toHaveCount(3);
  await filter.locator('button[data-tag=""]').click();
});

test("Chromium reads the manifest that makes the app installable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#brand")).toHaveAttribute("title", /^Labradorite · /);
  const client = await page.context().newCDPSession(page);
  const manifest = await client.send("Page.getAppManifest");
  expect(manifest.url).toMatch(/\/assets\/manifest\.webmanifest$/);
  expect(manifest.errors).toEqual([]);
  expect(JSON.parse(manifest.data)).toMatchObject({ name: "Labradorite", display: "standalone" });
});

test("the trash can be emptied for good after a confirmation", async ({ page }) => {
  const stamp = Date.now();
  for (const id of [`Doomed one ${stamp}`, `Doomed two ${stamp}`]) {
    await openSeed(page, "Gone soon.", id);
    await page.getByRole("button", { name: "Move note to trash", exact: true }).click();
    await page.getByRole("button", { name: "Move to trash", exact: true }).click();
    await expect(page.locator("#toast")).toContainText("Note moved to trash.");
  }
  const count = (await (await page.request.get("/api/trash")).json()).notes.length;
  await page.locator("#trash-button").click();
  await page.getByRole("button", { name: "Delete all…" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete all notes in the trash?" });
  await expect(confirm).toContainText("It can't be undone.");
  // Cancelling keeps everything.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect((await (await page.request.get("/api/trash")).json()).notes.length).toBe(count);
  await page.locator("#trash-button").click();
  await page.getByRole("button", { name: "Delete all…" }).click();
  await page.getByRole("button", { name: `Delete ${count} notes` }).click();
  await expect(page.locator("#toast")).toContainText(`Deleted ${count} notes for good.`);
  await expect(page.locator("#undo-trash")).toBeHidden();
  expect((await (await page.request.get("/api/trash")).json()).notes).toEqual([]);
  await page.locator("#trash-button").click();
  await expect(page.locator(".trash-list")).toContainText("The trash is empty.");
  await expect(page.getByRole("button", { name: "Delete all…" })).toHaveCount(0);
});

test("drafts kept under the vault's former ID are found after its folder moves", async ({ page }) => {
  const id = await openSeed(page, "Saved before the move.");
  const vaultId = (await (await page.request.get("/api/state")).json()).vaultId;
  // Pretend the vault used to live at another path, with a draft filed there.
  await page.evaluate(({ id }) => {
    localStorage.setItem(
      `coyote-draft:formerid12345678:oldtab:${id}`,
      JSON.stringify({ id, body: "Unsaved from the old folder.", base: "x", time: Date.now() }),
    );
  }, { id });
  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, formerVaultIds: ["formerid12345678"] } });
  });
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("coyote-draft:")));
  expect(keys).toEqual([`coyote-draft:${vaultId}:oldtab:${id}`]);
});

test("moving former drafts never loses one when storage is full or keys collide", async ({ page }) => {
  const id = await openSeed(page, "Saved before the move.");
  const vaultId = (await (await page.request.get("/api/state")).json()).vaultId;
  const draft = (body) => JSON.stringify({ id, body, base: "x", time: Date.now() });
  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), formerVaultIds: ["formerid12345678"] } });
  });
  // A full browser storage refuses the copy: the old draft stays, with a warning.
  await page.evaluate(({ id, body }) => localStorage.setItem(`coyote-draft:formerid12345678:oldtab:${id}`, body), { id, body: draft("Only copy.") });
  await page.addInitScript((vaultId) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(`coyote-draft:${vaultId}:`) && !globalThis.storageFreed) throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  }, vaultId);
  await page.reload();
  await expect(page.locator("#toast-text")).toContainText("could not be moved");
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("coyote-draft:")))).toEqual([`coyote-draft:formerid12345678:oldtab:${id}`]);
  // A different draft already at the new key: both are kept.
  await page.evaluate(({ key, body }) => { globalThis.storageFreed = true; localStorage.setItem(key, body); }, { key: `coyote-draft:${vaultId}:oldtab:${id}`, body: draft("Newer copy.") });
  await page.addInitScript(() => { globalThis.storageFreed = true; });
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  const bodies = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("coyote-draft:")).map((k) => [k.split(":")[1], JSON.parse(localStorage.getItem(k)).body]).sort());
  expect(bodies).toEqual([[vaultId, "Newer copy."], [vaultId, "Only copy."]].sort());
});

test("the app starts on a page with a New note button, and a reload keeps the open note", async ({ page }) => {
  const id = await openSeed(page, "Already here.");
  await page.goto("/");
  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("#home-text")).toHaveText("Pick a note from the list, or start a new one.");
  await expect(page.locator("#note-list")).toContainText(id);
  await expect(page.locator("#note-stats")).toBeHidden();
  await page.getByRole("button", { name: "New note", exact: true }).last().click();
  await expect(page.getByRole("dialog", { name: "New note" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".note-row", { hasText: id }).click();
  await expect(page.locator("#document-title")).toHaveText(id);
  await expect(page.locator("#note-stats")).toBeVisible();
  await page.reload();
  await expect(page.locator("#document-title")).toHaveText(id);
});

test("the footer shows the running version and links to the latest release on every screen", async ({ page }) => {
  const id = await openSeed(page, "Version stays visible while writing.");
  const { version } = await (await page.request.get("/api/state")).json();
  const link = page.locator("#app-version");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/", "/?note=" + encodeURIComponent(id)]) {
      await page.goto(path);
      await expect(link).toHaveText(version);
      await expect(link).toBeInViewport();
      await expect(link).toHaveAttribute("href", "https://github.com/eg36/Labradorite/releases/latest");
      await expect(link).toHaveAttribute("target", "_blank");
      const footer = page.locator(".statusbar");
      expect(await footer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
      const box = await link.boundingBox();
      const bar = await footer.boundingBox();
      expect(box.x + box.width).toBeGreaterThan(bar.x + bar.width - 20);
    }
  }
});

test.describe("daily notes", () => {
  test.use({ timezoneId: "Pacific/Honolulu" });
  test("uses the local date and reopens the same text from every entry point", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#save-label")).toHaveText("Ready when you are");
    // UTC is already November 4; the writer's date is still November 3.
    await page.clock.setFixedTime(new Date("2026-11-04T03:00:00Z"));
    await menu(page, "file");
    await page.getByRole("menuitem", { name: "Today's note" }).click();
    await expect(page.locator("#document-title")).toHaveText("2026-11-03");
    await mode(page, "Markdown");
    await page.locator(".cm-content").fill("Keep today's thoughts.");
    await page.keyboard.press("Alt+j");
    await expect.poll(() => diskBody(page, "Journal/2026-11-03")).toBe("Keep today's thoughts.");
    await page.keyboard.press("Control+k");
    await page.getByLabel("Search notes, headings and commands").fill(">today");
    await page.keyboard.press("Enter");
    await expect(page.locator("#modal")).not.toBeVisible();
    await expect(page.locator(".cm-content")).toHaveText("Keep today's thoughts.");
    const data = await (await page.request.get("/api/state")).json();
    expect(data.notes.filter((n) => n.id === "Journal/2026-11-03")).toHaveLength(1);
  });

  test("a failed save keeps the current note and its recoverable draft", async ({ page }) => {
    const id = await openSeed(page, "Before journal navigation.");
    await mode(page, "Markdown");
    await page.route("**/api/note", (route) => route.request().method() === "PUT"
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({error: "Save unavailable"}) })
      : route.continue());
    await page.locator(".cm-content").fill("Unsaved before journal navigation.");
    await page.keyboard.press("Alt+j");
    await expect(page.locator("#error-banner")).toContainText("Save unavailable");
    await expect(page.locator("#document-title")).toHaveText(id);
    await expect(page.locator(".cm-content")).toContainText("Unsaved before journal navigation.");
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("coyote-draft:") && localStorage[k].includes("Unsaved before journal navigation.")))).toBeTruthy();
  });
});

test("new notes copy a template's current Markdown without changing the original", async ({ page }) => {
  const template = `Templates/Meetings/Weekly ${Date.now()}`;
  const original = '---\ntags: [meeting]\n---\n\n# Agenda\n\n- [ ] A task\n\n[[Next week]]\n';
  await openSeed(page, original, template);
  await mode(page, "Markdown");
  const edited = original + '\nEdited before using this template.\n';
  await page.locator(".cm-content").fill(edited);
  await page.keyboard.press("Alt+n");
  await page.getByLabel("Name your note").fill("Weekly copy " + Date.now());
  const name = await page.getByLabel("Name your note").inputValue();
  await page.getByLabel("Start with", { exact: true }).selectOption(template);
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(page.locator("#document-title")).toHaveText(name);
  expect(await diskBody(page, name)).toBe(edited);
  expect(await diskBody(page, template)).toBe(edited);
  await page.locator(".cm-content").fill("Only the copy changes.");
  await expect.poll(() => diskBody(page, name)).toBe("Only the copy changes.");
  expect(await diskBody(page, template)).toBe(edited);
});

test("an unavailable template keeps the new-note dialog and name for retry", async ({ page }) => {
  const template = `Templates/Missing ${Date.now()}`;
  await seed(page, template, "Template contents.");
  await page.goto("/");
  await page.locator("#new-note").click();
  const name = "Not created " + Date.now();
  await page.getByLabel("Name your note").fill(name);
  await page.getByLabel("Start with", { exact: true }).selectOption(template);
  await page.route((url) => url.pathname === "/api/note" && url.searchParams.get("id") === template,
    (route) => route.fulfill({status:404, contentType:"application/json", body:JSON.stringify({error:"Template was moved or deleted."})}));
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(page.locator("#modal-error")).toContainText("Template was moved or deleted.");
  await expect(page.getByLabel("Name your note")).toHaveValue(name);
  await page.getByLabel("Start with", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(page.locator("#document-title")).toHaveText(name);
  expect(await diskBody(page, name)).toBe("");
});

test("find and replace opens from Write, autosaves replacements and supports undo", async ({ page }) => {
  const id = await openSeed(page, "alpha alpha beta");
  await page.getByRole("textbox", { name: "WYSIWYG editor" }).fill("alpha alpha beta with edits");
  await menu(page, "edit");
  await page.getByRole("menuitem", { name: "Find and replace…" }).click();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "source");
  const find = page.locator("#search");
  const replace = page.locator("#search-replacement");
  await expect(find).toBeFocused();
  await find.fill("alpha");
  await replace.fill("omega");
  await replace.press("Tab");
  await page.locator("#search-replace-all").click();
  await expect.poll(() => diskBody(page, id)).toContain("omega omega beta with edits");
  await find.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator("#note-search-options")).toBeHidden();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "write");
  await mode(page, "Markdown");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(() => diskBody(page, id)).toContain("alpha alpha beta with edits");
});

test("find and replace keeps Split open and fits a narrow screen", async ({ page }) => {
  await openSeed(page, "Look for this word.");
  await mode(page, "Split");
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search notes, headings and commands").fill(">find and replace");
  await page.keyboard.press("Enter");
  await expect(page.locator("#note-search-options")).toBeVisible();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "split");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width,height:844});
    if (width < 800) {
      if (await page.locator("#sidebar-toggle").getAttribute("aria-expanded") !== "true") await page.locator("#sidebar-toggle").click();
      await expect(page.locator("#sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    }
    await expect(page.locator("#search-replace-all")).toBeInViewport();
    expect(await page.locator("#note-search-options").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    const findBox = await page.locator("#search").boundingBox();
    const replaceBox = await page.locator("#search-replacement").boundingBox();
    expect(replaceBox.y).toBeGreaterThan(findBox.y);
    const panel = await page.locator("#sidebar").boundingBox();
    expect(replaceBox.x).toBeGreaterThanOrEqual(panel.x);
    expect(replaceBox.x + replaceBox.width).toBeLessThanOrEqual(panel.x + panel.width);
  }
});

test("writing settings persist across modes, reloads and rich editor recreation", async ({ page }) => {
  const id = await openSeed(page, "Text made comfortable.");
  await menu(page, "view");
  await page.getByRole("menuitem", {name:"Settings…"}).click();
  const dialog = page.getByRole("dialog", {name:"Settings"});
  await dialog.getByLabel("Text size", {exact:true}).selectOption("22");
  await dialog.getByLabel("Line width", {exact:true}).selectOption("960");
  await dialog.getByRole("checkbox", {name:/Check spelling/}).uncheck();
  // Changes apply at once; Done only closes the window.
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "22px");
  await dialog.getByRole("button", {name:"Done"}).click();
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "22px");
  await expect(page.locator("#rich-editor")).toHaveCSS("max-width", "960px");
  await expect(page.locator(".tiptap")).toHaveAttribute("spellcheck", "false");
  await mode(page, "Preview");
  await expect(page.locator("#preview")).toHaveCSS("font-size", "22px");
  await mode(page, "Markdown");
  await expect(page.locator(".cm-scroller")).toHaveCSS("font-size", "20px");
  await page.reload();
  await expect(page.locator(".cm-scroller")).toHaveCSS("font-size", "20px");
  await mode(page, "Write");
  await expect(page.locator(".tiptap")).toHaveAttribute("spellcheck", "false");
  await openSeed(page, "A newly opened note.");
  await expect(page.locator(".tiptap")).toHaveAttribute("spellcheck", "false");
  expect(await diskBody(page, id)).toBe("Text made comfortable.");
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search notes, headings and commands").fill(">settings");
  await page.keyboard.press("Enter");
  await dialog.getByLabel("Text size", {exact:true}).selectOption("14");
  await page.keyboard.press("Escape");
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "14px");
});

test("invalid saved preferences fall back safely and unavailable storage is explained", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("labradorite-writing", '{"textSize":900,"lineWidth":-1,"spellcheck":"no"}'));
  await openSeed(page, "Safe writing defaults.");
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "18px");
  await expect(page.locator("#rich-editor")).toHaveCSS("max-width", "760px");
  await expect(page.locator(".tiptap")).toHaveAttribute("spellcheck", "true");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); }; });
  await menu(page, "view");
  await page.getByRole("menuitem", {name:"Settings…"}).click();
  await page.getByLabel("Text size", {exact:true}).selectOption("20");
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "20px");
  await expect(page.locator("#toast")).toContainText("could not remember them");
});

test("phone menus keep journal commands and settings reachable without a keyboard", async ({ page }) => {
  // Persistent recovery warnings must not intercept clicks on an open menu,
  // including when the menu scrolls over the toast on a short screen.
  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.warnings.push("Recovery copies retained in the vault.");
    await route.fulfill({response, json:data});
  });
  await openSeed(page, "A phone-sized writing space.", `A long document title that must leave room for the menus ${Date.now()}`);
  await expect(page.locator("#toast")).toBeVisible();
  for (const width of [320, 390, 530]) {
    await page.setViewportSize({width,height:720});
    await menu(page, "view");
    const item = page.getByRole("menuitem", {name:"Settings…"});
    await item.scrollIntoViewIfNeeded();
    await expect(item).toBeInViewport();
    await item.click();
    await page.getByLabel("Text size", {exact:true}).scrollIntoViewIfNeeded();
    await expect(page.getByLabel("Text size", {exact:true})).toBeInViewport();
    await page.getByRole("button", {name:"Done",exact:true}).click();
    await menu(page, "file");
    await page.getByRole("menuitem", {name:"Today's note"}).scrollIntoViewIfNeeded();
    await expect(page.getByRole("menuitem", {name:"Today's note"})).toBeInViewport();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({width:390,height:320});
  await menu(page, "view");
  const popup = page.locator("#menu-popup");
  expect(await popup.evaluate((el) => el.scrollHeight > el.clientHeight)).toBeTruthy();
  await page.getByRole("menuitem", {name:"Settings…"}).click();
  await expect(page.getByRole("dialog", {name:"Settings"})).toBeVisible();
});

test("the persistent rail keeps navigation reachable and full titles have themed tooltips", async ({ page }) => {
  const id = await openSeed(page, "Keep this exact Markdown.", "Rail/" + "A long title ".repeat(12).trim());
  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("#sidebar")).toBeHidden();
  const rail = page.getByRole("navigation", { name: "Workspace", exact: true });
  for (const name of ["Labradorite home", "Toggle notes", "Search all notes", "Recently opened notes", "New note", "Commands", "Settings"])
    await expect(rail.getByRole(name === "Labradorite home" ? "link" : "button", { name, exact: true })).toBeVisible();
  await page.locator("#document-title").hover();
  await expect(page.getByRole("tooltip")).toHaveText(id);
  await page.mouse.move(1000, 500);
  await page.locator("#commands-button").click();
  await expect(page.getByRole("combobox", { name: "Search notes, headings and commands" })).toHaveValue(">");
  await page.keyboard.press("Escape");
  await expect.poll(() => diskBody(page, id)).toBe("Keep this exact Markdown.");
});

test("pins and recently opened notes survive reload and follow an app rename", async ({ page }) => {
  const first = await openSeed(page, "Pinned body stays unchanged.", `Navigation/First ${Date.now()}`);
  await page.getByRole("button", { name: "Pin note", exact: true }).click();
  await expect(page.locator("#pinned-list")).toContainText(first.split("/").pop());
  const second = await openSeed(page, "Another note.");
  await page.locator("#recent-notes").click();
  await expect(page.locator("#recent-list .navigation-note").first()).toHaveAttribute("data-note", second);
  await page.locator(`#recent-list [data-note="${first}"]`).click();
  await expect(page.locator("#document-title")).toHaveText(first.split("/").pop());
  await page.locator("#show-all-notes").click();
  const renamed = first + " renamed";
  let release, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/note?**", async route => {
    if (new URL(route.request().url()).searchParams.get("id") !== renamed || held) return route.fallback();
    held = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  // The dialog stays available from the keyboard.
  await page.keyboard.press("Control+Shift+R");
  await page.getByLabel("Note path").fill(renamed);
  await page.getByRole("button", { name: "Rename note", exact: true }).click();
  await expect(page.locator("#pinned-list .navigation-note")).toHaveAttribute("data-note", renamed);
  await expect.poll(() => held).toBe(true);
  await expect.poll(() => new URL(page.url()).searchParams.get("note")).toBe(renamed);
  release();
  await page.reload();
  await expect(page.getByRole("button", { name: "Unpin note", exact: true })).toBeVisible();
  await page.locator("#recent-notes").click();
  await expect(page.locator("#recent-list .navigation-note").first()).toHaveAttribute("data-note", renamed);
  await expect(page.locator(`#recent-list [data-note="${first}"]`)).toHaveCount(0);
  await page.locator("#show-all-notes").click();
  await page.getByRole("button", { name: "Unpin note", exact: true }).click();
  await expect(page.locator("#pinned-notes")).toBeHidden();
  expect(await diskBody(page, renamed)).toBe("Pinned body stays unchanged.");
});

test("folder breadcrumbs browse descendants without moving notes or changing the open document", async ({ page }) => {
  const folder = `Breadcrumb ${Date.now()}`;
  const id = await openSeed(page, "A document in a nested folder.", `${folder}/Ideas/First`);
  await seed(page, `${folder}/Other/Second`, "A sibling folder.");
  await seed(page, `Outside ${Date.now()}`, "Outside this folder.");
  await page.reload();
  await page.getByRole("button", { name: `Browse ${folder}`, exact: true }).click();
  await expect(page.locator("#note-count")).toHaveText("2");
  await expect(page.locator("#list-label")).toHaveText(folder);
  await expect(page.locator("#document-title")).toHaveText("First");
  await page.getByRole("button", { name: `Browse ${folder}/Ideas`, exact: true }).click();
  await expect(page.locator("#note-count")).toHaveText("1");
  await expect(page.locator("#note-list .note-row")).toHaveAttribute("data-note", id);
  await page.locator("#clear-folder").click();
  await expect(page.locator("#clear-folder")).toBeHidden();
  await expect(page.locator("#list-label")).toHaveText("Notes");
  expect(await diskBody(page, id)).toBe("A document in a nested folder.");
});

test("this-note search follows navigation and leaves replacement mode when switching back to Write", async ({ page }) => {
  const first = await openSeed(page, "needle needle", `Search scope ${Date.now()}`);
  await page.keyboard.press("Control+Shift+e");
  await page.locator("#search").fill("needle");
  await page.locator("#find-replace").click();
  await expect(page.locator("#search-matches")).toHaveText("2 matches");
  await page.locator("#search-replacement").fill("replacement");
  await mode(page, "Write");
  await expect(page.locator("#note-search-options")).toBeHidden();
  await expect(page.locator("#search-all")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#rich-editor")).toContainText("needle needle");
  await page.locator("#find-replace").click();
  await page.locator("#brand").click();
  await expect(page.locator("#note-search-options")).toBeHidden();
  await expect(page.locator("#search-all")).toHaveAttribute("aria-pressed", "true");
  expect(await diskBody(page, first)).toBe("needle needle");
});

test("pinned notes sit below tags, match normal rows and remember their collapsed state", async ({ page }) => {
  const id = await openSeed(page, "A small pinned row.", `Pinned layout ${Date.now()}`);
  await page.getByRole("button", { name: "Pin note", exact: true }).click();
  const pinned = page.locator("#pinned-notes");
  const pinnedRow = page.locator("#pinned-list .navigation-note");
  const normalRow = page.locator(`#note-list [data-note="${id}"]`);
  await expect(pinnedRow.locator("time")).toHaveText(await normalRow.locator("time").innerText());
  await expect(pinnedRow.locator("small")).toHaveCount(0);
  await expect(pinnedRow.locator(".note-title")).toHaveCSS("font-size", "13px");
  await expect(normalRow.locator(".note-title")).toHaveCSS("font-size", "13px");
  expect(await page.locator("#tag-filter").evaluate((tags) => Boolean(tags.compareDocumentPosition(document.getElementById("pinned-notes")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBeTruthy();
  const pinBox = await pinned.boundingBox();
  expect(pinBox.y + pinBox.height).toBeLessThanOrEqual((await page.locator(".list-heading").boundingBox()).y);
  await pinned.locator("summary").click();
  await expect(pinnedRow).toBeHidden();
  await page.reload();
  await expect(pinned).toBeVisible();
  await expect(pinnedRow).toBeHidden();
  await pinned.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(pinnedRow).toBeVisible();
});

test("collapse and expand all includes pinned notes and restores both after reload", async ({ page }) => {
  const id = await openSeed(page, "Fold this note and its pinned entry.", `Fold pins ${Date.now()}/Note`);
  await page.getByRole("button", { name: "Pin note", exact: true }).click();
  const pinned = page.locator("#pinned-list .navigation-note");
  const row = page.locator(`#note-list [data-note="${id}"]`);
  const fold = page.locator("#fold-folders");
  await fold.click();
  await expect(pinned).toBeHidden();
  await expect(row).toHaveCount(0);
  await expect(fold).toHaveAttribute("aria-label", "Expand all folders");
  await page.reload();
  await expect(pinned).toBeHidden();
  // Reloading the current note must not override the saved folder choice.
  await expect(row).toHaveCount(0);
  await expect(fold).toHaveAttribute("aria-label", "Expand all folders");
  await fold.click();
  await expect(pinned).toBeVisible();
  await expect(row).toBeVisible();
  await expect(fold).toHaveAttribute("aria-label", "Collapse all folders");
  await page.locator("#pinned-notes summary").click();
  await expect(pinned).toBeHidden();
  await expect(fold).toHaveAttribute("aria-label", "Collapse all folders");
});

test("closing this-note search restores the prior writing mode unless the user selects another", async ({ page }) => {
  await openSeed(page, "A needle in a note.");
  for (const [label, value] of [["Write", "write"], ["Preview", "preview"], ["Markdown", "source"], ["Split", "split"]]) {
    await mode(page, label);
    await page.keyboard.press("Control+Shift+e");
    await page.locator("#search").fill("needle");
    await page.locator("#find-replace").click();
    await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", value === "split" ? "split" : "source");
    await page.locator("#sidebar-search").click();
    await expect(page.locator("#search")).toBeHidden();
    await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", value);
  }
  await mode(page, "Write");
  await page.keyboard.press("Control+Shift+e");
  await page.locator("#find-replace").click();
  await mode(page, "Split");
  await page.locator("#sidebar-search").click();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "split");
  await mode(page, "Write");
  await page.keyboard.press("Control+Shift+e");
  await page.locator("#find-replace").click();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "source");
  await page.reload();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "write");
});

test("the rail marks the notes panel's view with a bar: notes, recent or search", async ({ page }) => {
  await openSeed(page, "One active navigation view.");
  const notes = page.locator("#sidebar-toggle");
  const recent = page.locator("#recent-notes");
  const search = page.locator("#sidebar-search");
  const marked = async () => page.evaluate(() =>
    [...document.querySelectorAll(".activity-rail button")]
      .filter((button) => getComputedStyle(button, "::before").content !== "none")
      .map((button) => button.id));
  await page.mouse.move(800, 500);
  await expect.poll(marked).toEqual(["sidebar-toggle"]);
  await recent.click();
  await expect(recent).toHaveAttribute("aria-pressed", "true");
  await expect.poll(marked).toEqual(["recent-notes"]);
  await notes.click();
  await expect(recent).toHaveAttribute("aria-pressed", "false");
  await search.click();
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await expect.poll(marked).toEqual(["sidebar-search"]);
  // An open panel never fills its icon, and hovering looks the same on every icon.
  await page.addStyleTag({ content: "* { transition: none !important; }" });
  await page.mouse.move(800, 500);
  for (const button of [notes, search]) await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await notes.hover();
  const hovered = await notes.evaluate((el) => getComputedStyle(el).backgroundColor);
  await recent.hover();
  await expect(recent).toHaveCSS("background-color", hovered);
  expect(hovered).not.toBe("rgba(0, 0, 0, 0)");
});


test("notes panel actions keep navigation on the left and dismissal at the right", async ({ page }) => {
  await openSeed(page, "Panel controls.");
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    if (await page.locator("#sidebar-toggle").getAttribute("aria-expanded") !== "true") await page.locator("#sidebar-toggle").click();
    await expect(page.locator("#collapse-sidebar")).toBeVisible();
    const [fold, previous, next, collapse, row] = await page.locator(".sidebar-actions").evaluate(el =>
      [el.querySelector("#fold-folders"), el.querySelector("#history-back"), el.querySelector("#history-forward"), el.querySelector("#collapse-sidebar"), el]
        .map(node => { const r = node.getBoundingClientRect(); return { x: r.x, width: r.width }; }));
    expect(previous.x).toBeGreaterThanOrEqual(fold.x + fold.width);
    expect(next.x).toBeGreaterThanOrEqual(previous.x + previous.width);
    expect(collapse.x).toBeGreaterThanOrEqual(next.x + next.width);
    expect(Math.abs(collapse.x + collapse.width - row.x - row.width)).toBeLessThan(2);
    await page.locator("#collapse-sidebar").click();
    await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#sidebar-toggle")).toBeFocused();
    await page.reload();
    await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    await page.locator("#sidebar-toggle").click();
    await expect(page.locator("#collapse-sidebar")).toBeInViewport();
  }
});

test("editor toolbar stays anchored when note titles change", async ({ page }) => {
  const suffix = Date.now();
  const short = `Hi ${suffix}`;
  const long = `A much longer note title that must not move the writing controls ${suffix}`;
  await seed(page, short, "Short title.");
  await seed(page, long, "Long title.");
  for (const width of [1280, 1440, 1840, 1999]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?note=" + encodeURIComponent(short));
    await expect(page.locator("#document-title")).toHaveText(short);
    await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", /true|false/);
    if (await page.locator("#sidebar-toggle").getAttribute("aria-expanded") !== "true") await page.locator("#sidebar-toggle").click();
    const initial = await page.locator(".header-tools").boundingBox();
    await page.locator(`#note-list [data-note="${long}"]`).click();
    await expect(page.locator("#document-title")).toHaveText(long);
    const changed = await page.locator(".header-tools").boundingBox();
    expect(Math.abs(changed.x - initial.x)).toBeLessThan(1);
    const title = await page.locator("#document-title").boundingBox();
    const menuRow = await page.locator("#menu-bar").boundingBox();
    expect(title.y + title.height).toBeLessThanOrEqual(menuRow.y);
    const titleBlock = await page.locator(".title-block").boundingBox();
    expect(Math.abs(titleBlock.x + titleBlock.width / 2 - menuRow.x - menuRow.width / 2)).toBeLessThan(2);
    await page.locator("#collapse-sidebar").click();
    const collapsed = await page.locator(".header-tools").boundingBox();
    expect(Math.abs(collapsed.x - initial.x)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});

test("this-note search supports case, whole words, regex captures and invalid patterns", async ({ page }) => {
  const id = await openSeed(page, "cat Cat catalog cat-1 cat-2");
  await expect(page.locator("#rich-editor")).toBeVisible();
  const query = await searchBox(page);
  await page.locator("#find-replace").click();
  await query.fill("cat");
  await expect(page.locator("#search-matches")).toHaveText("5 matches");
  await page.locator(".search-flags summary").click();
  await page.getByLabel("Match case", { exact: true }).check();
  await expect(page.locator("#search-matches")).toHaveText("4 matches");
  await page.getByLabel("Whole words", { exact: true }).check();
  await expect(page.locator("#search-matches")).toHaveText("3 matches");
  await page.getByLabel("Whole words", { exact: true }).uncheck();
  await page.getByLabel("Regular expression", { exact: true }).check();
  await query.fill("cat-(\\d)");
  await expect(page.locator("#search-matches")).toHaveText("2 matches");
  await page.locator("#search-replacement").fill("dog-$1");
  await page.locator("#search-replace-all").click();
  await expect.poll(() => diskBody(page, id)).toBe("cat Cat catalog dog-1 dog-2");
  await query.fill("[");
  await expect(page.locator("#search-matches")).toHaveText("Invalid regular expression.");
  await expect(page.locator("#search-replace-all")).toBeDisabled();
  expect(await diskBody(page, id)).toBe("cat Cat catalog dog-1 dog-2");
});


test("note actions stay in the writing toolbar and the save dot precedes the note title", async ({ page }) => {
  await openSeed(page, "Stable status.");
  for (const width of [1999, 1440, 1280, 900, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.locator(".editor-bar #document-actions").count()).toBe(1);
    if (width <= 680) {
      const menus = await page.locator('[data-menu="insert"]').boundingBox();
      const actions = await page.locator("#document-actions").boundingBox();
      expect(menus.y + menus.height).toBeLessThanOrEqual(actions.y);
    }
    const status = await page.locator("#save-state").boundingBox();
    const title = await page.locator("#document-title").boundingBox();
    expect(title.x - status.x - status.width).toBeGreaterThanOrEqual(3);
    expect(Math.abs(status.y + status.height / 2 - title.y - title.height / 2)).toBeLessThan(2);
    await expect(page.locator(".header-divider")).toHaveCount(0);
    // A thin divider sits between Insert and the action icons while they share a row.
    const divider = await page.locator(".editor-bar").evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      return style.content !== "none" && style.display !== "none" ? parseFloat(style.width) : 0;
    });
    expect(divider).toBe(width <= 680 ? 0 : 1);
    expect(await page.locator("#menu-bar #document-actions").count()).toBe(1);
    const label = await page.locator("#save-label").boundingBox();
    expect(label.width).toBeLessThanOrEqual(1);
    expect(await page.locator(".topbar").evaluate(el => getComputedStyle(el).borderBottomWidth)).toBe("1px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});

test("rail icons can be dragged, reordered by keyboard and remembered after reload", async ({ page }) => {
  await page.goto("/");
  const commands = page.locator("#commands-button");
  const notes = page.locator("#sidebar-toggle");
  await expect(commands).toHaveAttribute("draggable", "true");
  await commands.dragTo(notes, { targetPosition: { x: 20, y: 5 } });
  await expect(page.locator(".activity-rail > button").first()).toHaveAttribute("id", "commands-button");
  await page.reload();
  await expect(page.locator(".activity-rail > button").first()).toHaveAttribute("id", "commands-button");
  await commands.focus();
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(page.locator(".activity-rail > button").nth(1)).toHaveAttribute("id", "commands-button");
  await expect(commands).toBeFocused();
  await page.reload();
  await expect(page.locator(".activity-rail > button").nth(1)).toHaveAttribute("id", "commands-button");
  await commands.click();
  await expect(page.getByRole("combobox", { name: "Search notes, headings and commands" })).toBeVisible();
});


test("left text formatting panel edits, remembers visibility and folds away on phones", async ({ page }) => {
  const id = await openSeed(page, "A paragraph to style.");
  const pane = page.locator("#format-panel"), toggle = page.locator("#format-toggle");
  await expect(pane).toBeVisible();
  expect(await page.locator(".activity-rail #format-toggle").count()).toBe(0);
  // It sits in the header, right after the editor view selector.
  const toggleBox = await toggle.boundingBox(), viewBox = await page.locator("#view-type").boundingBox();
  expect(toggleBox.x).toBeGreaterThanOrEqual(viewBox.x + viewBox.width);
  expect(toggleBox.x - viewBox.x - viewBox.width).toBeLessThan(10);
  expect(Math.abs(toggleBox.y + toggleBox.height / 2 - viewBox.y - viewBox.height / 2)).toBeLessThan(2);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // Labelled like the view selector beside it, with the same height and border.
  await expect(toggle).toHaveText("Format");
  await expect(toggle).toHaveAttribute("aria-label", "Text formatting");
  expect(toggleBox.height).toBe(viewBox.height);
  expect(await toggle.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe(
    await page.locator("#view-type").evaluate((el) => getComputedStyle(el).borderTopWidth));
  const sidebar = await page.locator("#sidebar").boundingBox(), panel = await pane.boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  await page.getByRole("textbox", { name: "WYSIWYG editor" }).click();
  await page.keyboard.press("Control+a");
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("A paragraph to style.");
  await pane.getByRole("button", { name: "Bold", exact: true }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toContain("**A paragraph to style.**");
  await page.locator("#close-formatting").click();
  await expect(pane).toBeHidden();
  await expect(toggle).toBeFocused();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(pane).toBeVisible();
  await mode(page, "Preview");
  await expect(pane).toBeHidden();
  await mode(page, "Write");
  await expect(pane).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pane).toBeHidden();
  await toggle.click();
  await expect(pane).toBeInViewport();
  await expect(pane.getByRole("button", { name: "Insert image", exact: true })).toBeInViewport();
  await page.locator("#formatting-scrim").click({position:{x:325,y:250}});
  await expect(pane).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("the editor view selector sits at the header's left end and views stay reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#view-type")).toBeHidden();
  await openSeed(page, "Switch views freely.");
  const view = page.locator("#view-type"), area = page.locator("#editor-area");
  expect(await page.locator(".topbar .view-tools #view-type").count()).toBe(1);
  expect(await page.locator(".sidebar-actions #view-type").count()).toBe(0);
  await expect(view).toHaveAttribute("aria-label", "Editor view: Write");
  await expect(page.locator("#view-type-label")).toHaveText("Write");
  for (const width of [1999, 1440, 900, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await view.boundingBox(), header = await page.locator(".topbar").boundingBox();
    const rail = await page.locator(".activity-rail").boundingBox();
    // Left end of the header, just right of the logo, and inside the bar.
    expect(box.x - rail.x - rail.width).toBeLessThan(16);
    expect(box.y).toBeGreaterThanOrEqual(header.y);
    expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height);
    // The centered title, menus and note actions never overlap it.
    const format = await page.locator("#format-toggle").boundingBox();
    for (const selector of ["#document-head", "#menu-bar [data-menu=file]", "#document-actions"]) {
      const other = await page.locator(selector).boundingBox();
      for (const [name, own] of [["view", box], ["format", format]]) {
        const apart = other.x >= own.x + own.width || other.x + other.width <= own.x || other.y >= own.y + own.height || other.y + other.height <= own.y;
        expect(apart, `${selector} and ${name} at ${width}px`).toBeTruthy();
      }
    }
    expect(format.y + format.height).toBeLessThanOrEqual(header.y + header.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await view.click();
  await page.getByRole("option", { name: "Split", exact: true }).click();
  await expect(area).toHaveAttribute("data-mode", "split");
  await expect(view).toHaveAttribute("aria-label", "Editor view: Split");
  await expect(page.locator("#view-type-label")).toHaveText("Split");
  // It stays in the header with the notes panel collapsed; Alt+M and the View menu work too.
  await page.locator("#collapse-sidebar").click();
  await expect(view).toBeVisible();
  await menu(page, "view");
  await page.getByRole("menuitem", { name: "Preview", exact: true }).click();
  await expect(area).toHaveAttribute("data-mode", "preview");
  await page.locator("#preview").click();
  await page.keyboard.press("Alt+m");
  await expect(area).toHaveAttribute("data-mode", "split");
  await view.press("ArrowDown");
  await expect(page.locator("#view-menu")).toBeFocused();
  // Only the chevron turns while the menu is open; the view icon stays upright.
  expect(await page.locator("#view-type-icon svg").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  expect(await page.locator('#view-type [data-icon="chevronDown"] svg').evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(area).toHaveAttribute("data-mode", "write");
  await expect(page.locator("#format-panel")).toBeVisible();
});

test("pin sits right after the note title and pins the open note", async ({ page }) => {
  const id = await openSeed(page, "Pin me from the title.", `Title pin ${Date.now()}`);
  const pin = page.locator("#pin-note");
  expect(await page.locator("#document-actions #pin-note").count()).toBe(0);
  expect(await page.locator(".note-heading #pin-note").count()).toBe(1);
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(pin).toBeInViewport();
    const title = await page.locator("#document-title").boundingBox(), box = await pin.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(title.x + title.width - 1);
    expect(box.x - title.x - title.width).toBeLessThan(8);
    expect(Math.abs(box.y + box.height / 2 - title.y - title.height / 2)).toBeLessThan(2);
  }
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(pin).toHaveAttribute("aria-label", "Unpin note");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("#pinned-list .navigation-note")).toHaveAttribute("data-note", id);
  await page.goto("/");
  await expect(pin).toBeHidden();
});

test("highlights render in Preview and Write, and Write saves their == markers exactly", async ({ page }) => {
  const text = "Plain ==marked== and ==🟢green== words, ==**bold** inside==.\n\nKeep a == b, ===three=== and `==code==`.\n\nSecond line.";
  const id = await openSeed(page, text);
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });
  await expect(editor.locator("mark")).toHaveCount(3);
  await expect(editor.locator("mark.hl-green")).toHaveText("green");
  await expect(editor.locator("mark").nth(2).locator("strong")).toHaveText("bold");
  await expect(editor).toContainText("Keep a == b, ===three===");
  // Editing elsewhere in Write saves every marker unchanged.
  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Added.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe(text + " Added.");
  await mode(page, "Preview");
  await expect(page.locator("#preview mark")).toHaveCount(3);
  await expect(page.locator("#preview mark.hl-green")).toHaveText("green");
  const tint = await page.locator("#preview mark").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(tint).not.toBe("rgba(0, 0, 0, 0)");
});

test("the formatting panel applies, recolours and removes highlights, and typing ==text== marks it", async ({ page }) => {
  const id = await openSeed(page, "Mark this word please.");
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });
  const panel = page.locator("#format-panel");
  await expect(panel.locator(".hl-swatch")).toHaveCount(6);
  // Each swatch is filled with its own colour.
  const fills = await panel.locator(".hl-swatch").evaluateAll((buttons) => buttons.map((b) => getComputedStyle(b).backgroundColor));
  expect(new Set(fills).size).toBe(6);
  // Select "this" and highlight it in the default colour.
  await editor.locator("p").first().click();
  await expect(editor).toBeFocused();
  // The editor may still settle just after opening; select again until it holds.
  await expect(async () => {
    await page.keyboard.press("Home");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("this");
  }).toPass();
  await panel.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(editor.locator("mark")).toHaveText("this");
  await expect(panel.getByRole("button", { name: "Highlight", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("Mark ==this== word please.");
  // Another colour replaces it; choosing that colour again removes it.
  await panel.getByRole("button", { name: "Green highlight" }).click();
  await expect(editor.locator("mark.hl-green")).toHaveText("this");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("Mark ==🟢this== word please.");
  await panel.getByRole("button", { name: "Green highlight" }).click();
  await expect(editor.locator("mark")).toHaveCount(0);
  // Typing ==text== turns into a highlight as you write.
  await page.keyboard.press("End");
  await page.keyboard.type(" Then ==typed== ok");
  await expect(editor.locator("mark")).toHaveText("typed");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("Mark this word please. Then ==typed== ok");
});

test("spaces typed after bold or highlighted words save as ordinary spaces", async ({ page }) => {
  const id = await openSeed(page, "Start.");
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Then **bold** and ==marked== end");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("Start. Then **bold** and ==marked== end");
});

test("formatting around a wiki link or image keeps the note in Markdown instead of splitting it", async ({ page }) => {
  for (const body of ["Some **bold [[Target]] text** here.", "Some ==marked [[Target]] text== here.", "An *image ![alt](attachments/a.png) inside* emphasis."]) {
    const id = await openSeed(page, body);
    await mode(page, "Write");
    await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "source");
    await expect(page.locator("#toast-text")).toContainText("split formatting around a link or image");
    expect(await diskBody(page, id)).toBe(body);
  }
  // Formatting next to a link, not around it, stays in Write.
  await openSeed(page, "Some **bold** [[Target]] and ==marked== text.");
  await mode(page, "Write");
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "write");
});

test("the start page's create button says what it does", async ({ page }) => {
  await page.goto("/");
  const button = page.locator("#first-note");
  await expect(button).toBeVisible();
  await expect(page.locator("#first-note-label")).toBeVisible();
  await expect(page.locator("#first-note-label")).toHaveText(/^(Create your first note|New note)$/);
  const box = await button.boundingBox(), label = await page.locator("#first-note-label").boundingBox();
  expect(label.width).toBeGreaterThan(40);
  expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width);
  // Centred under the start page text.
  const text = await page.locator("#home-text").boundingBox();
  expect(Math.abs(box.x + box.width / 2 - text.x - text.width / 2)).toBeLessThan(2);
  await button.click();
  await expect(page.getByLabel("Name your note")).toBeVisible();
});

test("%% comments are hidden in Preview and kept exactly by Write", async ({ page }) => {
  const text = "Shown %%a private aside%% text.\n\n%%\nA whole hidden block.\n%%\n\nLast line.";
  const id = await openSeed(page, text);
  const editor = page.getByRole("textbox", { name: "WYSIWYG editor" });
  await expect(editor).toContainText("%%a private aside%%");
  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Edited.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe(text + " Edited.");
  await mode(page, "Preview");
  await expect(page.locator("#preview")).toContainText("Shown text.");
  await expect(page.locator("#preview")).toContainText("Last line. Edited.");
  await expect(page.locator("#preview")).not.toContainText("private aside");
  await expect(page.locator("#preview")).not.toContainText("whole hidden block");
  await expect(page.locator("#preview")).not.toContainText("%%");
});

test("footnotes render in Preview and jump between reference and note", async ({ page }) => {
  const text = "Claim one[^1] and an aside^[said in passing].\n\n" + "Filler paragraph.\n\n".repeat(40) + "[^1]: The source of claim one.";
  await openSeed(page, text);
  await mode(page, "Preview");
  const refs = page.locator("#preview .footnote-ref");
  await expect(refs).toHaveCount(2);
  await expect(page.locator("#preview .footnotes li")).toHaveCount(2);
  await expect(page.locator("#preview .footnotes")).toContainText("said in passing");
  const before = page.url();
  await refs.first().click();
  await expect(page.locator("#preview .footnotes li").first()).toBeInViewport();
  await page.locator("#preview .footnote-backref").first().click();
  await expect(refs.first()).toBeInViewport();
  expect(page.url()).toBe(before);
});

for (const [index, aside] of [
  "with a side note", "  **bold** and [a link](https://example.com)  ",
  "nested [square [brackets]] and \\[escaped\\]", "first line\nsecond line",
  "<u>raw</u> &copy; $\\alpha$ ![[literal]]",
].entries()) {
  test(`Write keeps inline footnote case ${index + 1} exact through body edits and view changes`, async ({ page }) => {
    const text = `A thought^[${aside}] here. Another^[second].\n\nNext line.`;
    const id = await openSeed(page, text); await mode(page, "Write");
    await expect(page.locator("#rich-pane")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit inline footnote", exact: true })).toHaveCount(2);
    await page.locator(".tiptap > p").last().click();
    await page.keyboard.press("End"); await page.keyboard.type(" More.");
    await expect.poll(() => diskBody(page, id)).toBe(text + " More.");
    await mode(page, "Markdown"); await mode(page, "Write");
    await expect(page.locator("#rich-pane")).toBeVisible();
    await page.reload(); await mode(page, "Write");
    await expect(page.locator("#rich-pane")).toBeVisible();
    expect(await diskBody(page, id)).toBe(text + " More.");
  });
}

test("inline footnotes retain final newlines on body edits", async ({ page }) => {
  for (const ending of ["\n", "\n\n"]) {
    const text = "A thought^[Keep this aside.] here." + ending;
    const id = await openSeed(page, text); await mode(page, "Write");
    await page.locator(".tiptap > p").first().click(); await page.keyboard.press("Home");
    await page.keyboard.type("Edited ");
    await expect.poll(() => diskBody(page, id)).toBe("Edited " + text);
  }
});

test("Write edits inline footnotes with validation, cancel, undo and Preview", async ({ page }) => {
  const text = "A claim^[  Original [link](https://example.com).  ] and a reference[^a].\n\n[^a]: Keep this.\n";
  const id = await openSeed(page, text); await mode(page, "Write");
  const trigger = page.getByRole("button", { name: "Edit inline footnote", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  const input = page.getByRole("textbox", { name: "Inline footnote Markdown", exact: true });
  await expect(input).toBeFocused(); await expect(input).toHaveValue("  Original [link](https://example.com).  ");
  for (const invalid of ["", "unbalanced ] bracket", "two\n\nparagraphs", "a trailing \\"]) {
    await input.fill(invalid); await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    expect(await diskBody(page, id)).toBe(text);
  }
  await input.fill("A cancelled edit."); await page.keyboard.press("Escape");
  await expect(input).toBeHidden(); await expect(trigger).toBeFocused();
  await trigger.click(); await expect(input).toHaveValue("  Original [link](https://example.com).  ");
  const revised = "Revised **bold** [nested [brackets]] and \\[literal\\].\nNext line.";
  await input.fill(revised); await page.keyboard.press("Control+Enter");
  const edited = text.replace("  Original [link](https://example.com).  ", revised);
  await expect.poll(() => diskBody(page, id)).toBe(edited);
  await page.locator(".tiptap > p").first().click({ position: { x: 2, y: 8 } });
  await page.keyboard.press("Control+z"); await expect.poll(() => diskBody(page, id)).toBe(text);
  await page.keyboard.press("Control+Shift+z"); await expect.poll(() => diskBody(page, id)).toBe(edited);
  await page.reload(); await mode(page, "Preview");
  await expect(page.locator("#preview .footnotes")).toContainText("Revised bold");
  await expect(page.locator("#preview .footnotes")).toContainText("Keep this.");
  await mode(page, "Write"); await trigger.click(); await expect(input).toHaveValue(revised);
});

test("Write creates inline footnotes by typing and keeps code examples literal", async ({ page }) => {
  const text = "`^[literal]` and code.\n\nBody.";
  const id = await openSeed(page, text); await mode(page, "Write");
  await expect(page.getByRole("button", { name: "Edit inline footnote", exact: true })).toHaveCount(0);
  await page.locator(".tiptap > p").last().click(); await page.keyboard.press("End");
  await page.keyboard.type("^[New **aside**]");
  await expect(page.getByRole("button", { name: "Edit inline footnote", exact: true })).toHaveCount(1);
  await expect.poll(() => diskBody(page, id)).toBe(text + "^[New **aside**]");
});

test("inline footnote fields work on phones and in structured text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const text = "# Heading^[heading aside]\n\n- Item^[list aside]\n\n> Quote^[quote aside]\n\nBody.";
  const id = await openSeed(page, text); await mode(page, "Write");
  const triggers = page.getByRole("button", { name: "Edit inline footnote", exact: true });
  await expect(triggers).toHaveCount(3); await triggers.nth(1).click();
  const input = page.getByRole("textbox", { name: "Inline footnote Markdown", exact: true });
  await expect(input).toHaveValue("list aside"); await input.fill("Phone [edit].");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => diskBody(page, id)).toBe(text.replace("list aside", "Phone [edit]."));
  const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: innerWidth }));
  expect(width.page).toBeLessThanOrEqual(width.view);
});

test("callouts render in Preview with icons and folding, and open in Write", async ({ page }) => {
  const text = "> [!warning] Mind the gap\n> Stand behind the line.\n\n> [!faq]- Why fold?\n> Hidden until opened.";
  const id = await openSeed(page, text);
  await mode(page, "Write");
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "write");
  await expect(page.locator(".tiptap .write-callout")).toHaveCount(2);
  await mode(page, "Preview");
  const warning = page.locator("#preview .callout-warning");
  await expect(warning.locator(".callout-title-text")).toHaveText("Mind the gap");
  await expect(warning.locator(".callout-icon svg")).toHaveCount(1);
  await expect(warning).toContainText("Stand behind the line.");
  const folded = page.locator("#preview details.callout-question");
  await expect(folded.getByText("Hidden until opened.")).toBeHidden();
  await folded.locator("summary").click();
  await expect(folded.getByText("Hidden until opened.")).toBeVisible();
  expect(await diskBody(page, id)).toBe(text);
});

test("Write keeps callouts exact through body edits", async ({ page }) => {
  test.setTimeout(90_000);
  const cases = [
    "> [!note] Title\n> Body. text here\n\nAfter.",
    "> [!Warning]- Mind the gap\n> Body. careful\n>\n> - one\n> - two",
    "> [!tip]+\n> Body. tight\n> - list right after\n\nMore.",
    "> [!info] Only a title\n\nBody. after",
    "> [!question] Nested\n> Body. outer\n>\n> > [!bug] Inner\n> > inner text",
    "> [!example]\n> Body. with $x^2$\n>\n> $$\n> y\n> $$",
    ">[!note] no space\n>Body. tight prefix",
    "> [!custom] Unknown\n> Body. unknown type",
    "Body. top\n\n- item\n  > [!note] In a list\n  > listed text",
  ];
  for (const body of cases) {
    const id = await openSeed(page, body);
    await mode(page, "Write");
    await expect(page.locator("#rich-pane"), body).toBeVisible();
    await page.locator(".tiptap").getByText("Body.", { exact: false }).first().click({ position: { x: 2, y: 8 } });
    await page.keyboard.press("Home"); await page.keyboard.type("Edited ");
    await expect.poll(() => diskBody(page, id), body).toBe(body.replace("Body.", "Edited Body."));
  }
});

test("callout headers edit the type, title and folding, and typing makes a callout", async ({ page }) => {
  const body = "> [!Warning] Mind the gap\n> Stand back.";
  const id = await openSeed(page, body);
  await mode(page, "Write");
  const callout = page.locator(".tiptap .write-callout");
  await expect(callout).toHaveClass(/callout-warning/);
  await expect(callout.getByLabel("Callout type")).toHaveValue("Warning");
  await callout.getByLabel("Callout title (Markdown)").fill("Mind the step");
  await expect.poll(() => diskBody(page, id)).toBe("> [!Warning] Mind the step\n> Stand back.");
  await callout.getByLabel("Callout folding").selectOption("-");
  await expect.poll(() => diskBody(page, id)).toBe("> [!Warning]- Mind the step\n> Stand back.");
  await callout.getByLabel("Callout type").selectOption("tip");
  await expect(callout).toHaveClass(/callout-tip/);
  await expect.poll(() => diskBody(page, id)).toBe("> [!tip]- Mind the step\n> Stand back.");
  await callout.getByLabel("Callout title (Markdown)").fill("");
  await expect.poll(() => diskBody(page, id)).toBe("> [!tip]- \n> Stand back.");
  await page.keyboard.press("Control+z");
  await expect.poll(() => diskBody(page, id)).toBe("> [!tip]- Mind the step\n> Stand back.");
  // Typing [!type] at the start of a quote turns it into a callout.
  const fresh = await openSeed(page, "Start.");
  await mode(page, "Write");
  await page.locator(".tiptap p").click(); await expect(page.locator(".tiptap")).toBeFocused();
  await expect.poll(() => page.evaluate(() => getSelection()?.anchorOffset)).toBeGreaterThan(0);
  await page.keyboard.press("End");
  await caretAt(page, "Start.", "Start.".length);
  await page.keyboard.press("Enter"); await page.keyboard.type("> [!todo] ");
  await expect(page.locator(".tiptap .write-callout.callout-todo")).toHaveCount(1);
  await expect(page.getByLabel("Callout title (Markdown)")).toBeFocused();
  await page.keyboard.type("Shopping"); await page.keyboard.press("Enter"); await page.keyboard.type("Bread");
  await expect.poll(() => diskBody(page, fresh)).toBe("Start.\n\n> [!todo] Shopping\n> Bread");
  // A line that continues a callout lazily keeps the note in Markdown.
  const lazy = "> [!note] Lazy\n> text\ncontinued";
  const other = await openSeed(page, lazy);
  await mode(page, "Write");
  await expect(page.locator("#toast-text")).toContainText("continues this callout");
  expect(await diskBody(page, other)).toBe(lazy);
});

test("folder breadcrumbs match the note title's size", async ({ page }) => {
  await openSeed(page, "Deep note.", `Lab/Nested ${Date.now()}`);
  const size = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontSize);
  const title = await size("#document-title");
  expect(await size(".breadcrumb:not(:has(svg))")).toBe(title);
  expect(await size(".breadcrumb-separator")).toBe(title);
  // The folder glyph covers the folder name's capitals, top to baseline.
  const fit = await page.evaluate(() => {
    const name = [...document.querySelectorAll(".breadcrumb")].find((b) => !b.querySelector("svg"));
    const range = document.createRange(); range.selectNodeContents(name); const box = range.getBoundingClientRect();
    const ctx = document.createElement("canvas").getContext("2d"); ctx.font = getComputedStyle(name).font;
    const m = ctx.measureText("L");
    const baseline = box.y + (box.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const glyph = document.querySelector(".breadcrumb svg path").getBoundingClientRect();
    return { top: glyph.y - (baseline - m.actualBoundingBoxAscent), bottom: glyph.y + glyph.height - baseline };
  });
  expect(Math.abs(fit.top)).toBeLessThan(1);
  expect(Math.abs(fit.bottom)).toBeLessThan(1);
  const colour = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
  expect(await colour(".breadcrumb-separator")).toBe(await colour(".breadcrumb"));
  // A short folder name shows whole beside a short title, with a gap before it.
  await openSeed(page, "Short.", `Projects/Trail ${Date.now() % 1000}`);
  const folder = page.locator(".breadcrumb:not(:has(svg))").first();
  await expect(folder).toHaveText("Projects");
  expect(await folder.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  const folders = await page.locator("#note-folder").boundingBox(), heading = await page.locator("#document-title").boundingBox();
  expect(heading.x - folders.x - folders.width).toBeGreaterThanOrEqual(0);
  const crumbs = await page.locator("#note-folder").boundingBox(), name = await page.locator("#document-title").boundingBox();
  expect(Math.abs(crumbs.y + crumbs.height / 2 - name.y - name.height / 2)).toBeLessThan(2);
});

test("same-note links, block ids and table aliases work in Preview and Write", async ({ page }) => {
  const filler = "Filler paragraph.\n\n".repeat(40);
  const target = await openSeed(page, "# Top\n\nJump to [[#Far heading|the far heading]].\n\n" + filler + "## Far heading\n\nThe key line. ^key\n\n" + filler);
  await mode(page, "Preview");
  await expect(page.locator("#preview")).not.toContainText("^key");
  await page.locator("#preview a", { hasText: "the far heading" }).click();
  await expect(page.locator("#preview h2")).toBeInViewport();
  // Write: clicking the same-note link scrolls instead of offering a new note.
  await mode(page, "Write");
  await page.locator(".wiki-link", { hasText: "the far heading" }).click();
  await expect(page.locator("#rich-editor h2")).toBeInViewport();
  await expect(page.locator("#modal")).not.toHaveAttribute("open", "");
  // Another note links to the block; following it scrolls to the block.
  const table = "| What | Link |\n| --- | --- |\n| Block | [[" + target + "#^key\\|key line]] |";
  const id = await openSeed(page, table);
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "write");
  await expect(page.locator(".wiki-link")).toHaveText("key line");
  await page.locator("td").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("s");
  await page.keyboard.press("Control+s");
  // Write may re-pad table columns, but keeps the link and its escaped pipe.
  await expect.poll(() => diskBody(page, id)).toContain("| Blocks | [[" + target + "#^key\\|key line]] |");
  await mode(page, "Preview");
  await page.locator("#preview a", { hasText: "key line" }).click();
  await expect(page.locator("#document-title")).toHaveText(target);
  await expect(page.locator('#preview [id="b-key"]')).toBeInViewport();
});

test("custom task marks work in Write and render in Preview", async ({ page }) => {
  const text = "- [ ] Open\n- [?] Ask Priya\n- [-] Dropped idea\n- [!] Urgent";
  const id = await openSeed(page, text);
  await mode(page, "Write");
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "write");
  await expect(page.locator(".write-task-status")).toHaveCount(4);
  expect(await diskBody(page, id)).toBe(text);
  await mode(page, "Preview");
  await expect(page.locator("#preview .task-mark")).toHaveCount(3);
  await expect(page.locator('#preview li[data-task="?"] .task-mark')).toHaveText("?");
  await expect(page.locator('#preview li[data-task="-"]')).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.locator("#preview")).not.toContainText("[?]");
  // Ordinary tasks still open in Write.
  await openSeed(page, "- [ ] Plain\n- [x] Done");
  await mode(page, "Write");
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "write");
});

test("image sizes after a | apply in Write and Preview and stay in the Markdown", async ({ page }) => {
  const bootstrap = await (await page.request.get("/api/state")).json();
  const upload = await page.request.post("/api/attachment?name=sized.png", {
    headers: { "X-Labradorite-Token": bootstrap.token, "Content-Type": "image/png" },
    data: pixel,
  });
  const { path } = await upload.json();
  const text = `Intro.\n\n![Sunrise|80](${path})\n\n![Wide|120x40](${path})`;
  const id = await openSeed(page, text);
  const pictures = page.locator(".tiptap img[data-image-src]");
  await expect(pictures.first()).toHaveAttribute("alt", "Sunrise");
  await expect.poll(async () => (await pictures.first().boundingBox())?.width).toBe(80);
  await expect.poll(async () => (await pictures.nth(1).boundingBox())?.height).toBe(40);
  await page.getByRole("textbox", { name: "WYSIWYG editor" }).locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe(text.replace("Intro.", "Intro. More."));
  await mode(page, "Preview");
  await expect(page.locator('#preview img[alt="Sunrise"]')).toHaveAttribute("width", "80");
  await expect(page.locator('#preview img[alt="Wide"]')).toHaveAttribute("height", "40");
});

test("checklist boxes in Write sit on the middle of their text", async ({ page }) => {
  await openSeed(page, "- [ ] First task\n- [x] Second task");
  for (const size of ["14px", "18px", "24px"]) {
    await page.evaluate((value) => document.documentElement.style.setProperty("--writing-size", value), size);
    const offset = await page.locator(".tiptap li").first().evaluate((li) => {
      const box = li.querySelector("input").getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(li.querySelector("p")); const line = range.getClientRects()[0];
      const ctx = document.createElement("canvas").getContext("2d"); ctx.font = getComputedStyle(li.querySelector("p")).font;
      const m = ctx.measureText("x");
      const baseline = line.y + (line.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
      return box.y + box.height / 2 - (baseline - m.actualBoundingBoxAscent / 2);
    });
    expect(Math.abs(offset), `at ${size}`).toBeLessThan(1.5);
  }
});

test("the Markdown editor folds headings and lists and edits with several cursors", async ({ page }) => {
  await seed(page, `Neighbour ${Date.now()}`, "Another note to move to.");
  const id = await openSeed(page, "# One\n\nalpha line\n\n- item\n  - nested\n\n# Two\n\nbeta line\n\nword word word");
  await mode(page, "Markdown");
  // Real markers only: CodeMirror keeps a hidden spacer in the gutter.
  const markers = page.locator(".cm-foldGutter .cm-gutterElement:not([style*='visibility: hidden']) span[title]");
  await expect(markers).toHaveCount(3);
  await markers.first().click();
  await expect(page.locator(".cm-content")).not.toContainText("alpha line");
  await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(1);
  await page.locator(".cm-foldPlaceholder").click();
  await expect(page.locator(".cm-content")).toContainText("alpha line");
  // Alt+click adds a second cursor; typing writes at both.
  const lines = page.locator(".cm-line");
  await lines.nth(2).click();
  await page.keyboard.press("End");
  await lines.nth(9).click({ modifiers: ["Alt"] });
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  // Ctrl+D selects the next match of the word at the cursor.
  await lines.last().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+d");
  await page.keyboard.type("Z");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("# One\n\nalpha line!\n\n- item\n  - nested\n\n# Two\n\nbeta line!\n\nZ Z word");
  // Alt+↓ still moves to the next note rather than moving the line.
  await page.keyboard.press("Escape");
  const title = await page.locator("#document-title").textContent();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator("#document-title")).not.toHaveText(title || "");
  expect(await diskBody(page, id)).toBe("# One\n\nalpha line!\n\n- item\n  - nested\n\n# Two\n\nbeta line!\n\nZ Z word");
});

test("note embeds show the other note's text in Preview and link to it", async ({ page }) => {
  const source = `Embedded ${Date.now()}`;
  await seed(page, source, "# Source\n\nShared paragraph.\n\n## Part\n\nOnly this part. ^bit");
  const text = `Host text.\n\n![[${source}]]\n\n![[${source}#^bit]]`;
  const id = await openSeed(page, text);
  await mode(page, "Preview");
  const embeds = page.locator("#preview .embed");
  await expect(embeds).toHaveCount(2);
  await expect(embeds.first()).toContainText("Shared paragraph.");
  await expect(embeds.nth(1)).toContainText("Only this part.");
  await expect(embeds.nth(1)).not.toContainText("Shared paragraph.");
  await embeds.first().locator(".embed-title").click();
  await expect(page.locator("#document-title")).toHaveText(source);
  expect(await diskBody(page, id)).toBe(text);
});

test("long note titles take one line in the notes list", async ({ page }) => {
  const long = "A remarkably long note title that would otherwise wrap onto several lines " + Date.now();
  await openSeed(page, "Long.", long);
  const row = page.locator(".note-title", { hasText: "A remarkably long" }).first();
  const lineHeight = await row.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  const box = await row.boundingBox();
  expect(box.height).toBeLessThan(lineHeight * 1.5);
  expect(await row.evaluate((el) => el.scrollHeight > el.clientHeight)).toBeTruthy();
});

test("tooltips sit 7px below the control they describe", async ({ page }) => {
  await openSeed(page, "Tooltip spacing.");
  const control = page.locator("#history-button");
  await control.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  const [box, tipBox] = [await control.boundingBox(), await tip.boundingBox()];
  expect(Math.abs(tipBox.y - box.y - box.height - 7)).toBeLessThan(0.6);
});

test("the rail's first icon lines up with the notes toolbar at home and in a note", async ({ page }) => {
  const middle = async (selector) => { const box = await page.locator(selector).boundingBox(); return box.y + box.height / 2; };
  const id = await openSeed(page, "Aligned.");
  for (const url of ["/", "/?note=" + encodeURIComponent(id)]) {
    await page.goto(url);
    await expect(page.locator("#today-note")).toBeVisible();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(Math.abs((await middle("#sidebar-toggle")) - (await middle("#today-note"))), url).toBeLessThan(1);
    const sizes = await page.locator(".sidebar-actions svg, .activity-rail > button svg").evaluateAll((icons) => icons.map((i) => Math.round(i.getBoundingClientRect().width)).filter((w) => w > 0));
    expect(new Set(sizes)).toEqual(new Set([19]));
  }
});

test("safe HTML formatting shows in Preview while scripts and handlers never run", async ({ page }) => {
  let dialogs = 0;
  page.on("dialog", (dialog) => { dialogs++; dialog.dismiss(); });
  await openSeed(page, 'Press <kbd>Ctrl</kbd> for <u>this</u>, H<sub>2</sub>O.\n\n<details><summary>Open me</summary>\nHidden.\n</details>\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>');
  await mode(page, "Preview");
  await expect(page.locator("#preview kbd")).toHaveText("Ctrl");
  await expect(page.locator("#preview u")).toHaveText("this");
  await expect(page.locator("#preview details")).toHaveJSProperty("open", false);
  await page.locator("#preview summary").click();
  await expect(page.locator("#preview details")).toHaveJSProperty("open", true);
  await expect(page.locator("#preview details")).toContainText("Hidden.");
  await expect(page.locator("#preview script, #preview [onerror]")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(dialogs).toBe(0);
});

test("typed properties edit one YAML value while preserving every untouched byte", async ({ page }) => {
  const front = '\uFEFF---\n# Keep this comment\ntitle: \'Original\'  # title comment\ncount: 12\nready: TRUE\nday: 2026-10-20\nitems: [one, \'two\']\ntags: [field, notes]\n\n---  \n\n\n';
  const id = await openSeed(page, front + "Body.");
  await mode(page, "Write");
  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Original");
  await expect(page.getByLabel("count", { exact: true })).toHaveAttribute("type", "number");
  await expect(page.getByLabel("ready", { exact: true })).toBeChecked();
  await expect(page.getByLabel("day", { exact: true })).toHaveAttribute("type", "date");
  let expected = front + "Body.";
  for (const [key, value, before, after] of [
    ["title", 'New: # "quoted"', "'Original'", '"New: # \\"quoted\\""'],
    ["count", "3.5", "count: 12", "count: 3.5"],
    ["day", "2026-11-01", "day: 2026-10-20", "day: 2026-11-01"],
    ["items", "one, three", "items: [one, 'two']", 'items: ["one", "three"]'],
    ["tags", "new, tag", "tags: [field, notes]", 'tags: ["new", "tag"]'],
  ]) {
    await page.getByLabel(key, { exact: true }).fill(value);
    await page.getByLabel(key, { exact: true }).press("Tab");
    expected = expected.replace(before, after);
    await expect.poll(() => diskBody(page, id)).toBe(expected);
  }
  await page.getByLabel("ready", { exact: true }).uncheck();
  expected = expected.replace("ready: TRUE", "ready: false");
  await expect.poll(() => diskBody(page, id)).toBe(expected);
  await page.locator(".tiptap p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  await expect.poll(() => diskBody(page, id)).toBe(expected + " More.");
  await mode(page, "Markdown"); await mode(page, "Write");
  await expect(page.getByLabel("title", { exact: true })).toHaveValue('New: # "quoted"');
  for (const yaml of ["nested:\n  key: value", "items:\n  - one\n  - two", "key: &anchor value", "key: yes", "key: value\nkey: another", "text: |\n  words"]) {
    const rawId = await openSeed(page, "---\n" + yaml + "\n---\n\nBody.");
    await mode(page, "Write");
    await expect(page.getByLabel("Properties", { exact: true })).toHaveValue(yaml);
    await page.locator(".tiptap p").click(); await page.keyboard.press("End"); await page.keyboard.type(" More.");
    await expect.poll(() => diskBody(page, rawId)).toBe("---\n" + yaml + "\n---\n\nBody. More.");
  }
});

test("math and Mermaid load locally only when needed and preserve source", async ({ page, baseURL }) => {
  const remote = [], assets = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== baseURL) remote.push(request.url());
    if (url.pathname.startsWith("/assets/")) assets.push(url.pathname);
  });
  await openSeed(page, "A plain note.");
  await mode(page, "Preview");
  await expect(page.locator("#preview")).toContainText("A plain note.");
  const plainAssets = new Set(assets);
  expect(assets.some(path => /katex/.test(path))).toBe(false);
  const body = 'Inline $x^2 + y^2 = z^2$. Money $5 and $6.\n\n$$\n\\frac{1}{2} + \\sqrt{4}\n$$\n\n```mermaid\nflowchart LR\n  Draft --> Review --> Done\n```';
  const id = await openSeed(page, body);
  await mode(page, "Preview");
  await expect(page.locator("#preview .katex")).toHaveCount(2);
  await expect(page.locator("#preview .mermaid-diagram svg")).toHaveCount(1);
  await expect(page.locator("#preview")).toContainText("Money $5 and $6.");
  expect(assets.some(path => path === "/assets/katex.css")).toBe(true);
  expect(assets.some(path => /\.woff2$/.test(path))).toBe(true);
  expect(assets.filter(path => !plainAssets.has(path)).length).toBeGreaterThan(2);
  expect(remote).toEqual([]);
  expect(await diskBody(page, id)).toBe(body);
  await mode(page, "Write");
  await expect(page.locator("#rich-pane")).toBeVisible();
  await expect(page.locator(".tiptap .katex")).toHaveCount(2);
  await expect(page.locator(".tiptap")).toContainText("Money $5 and $6.");
  expect(remote).toEqual([]);
  expect(await diskBody(page, id)).toBe(body);
  await page.setViewportSize({ width: 390, height: 844 });
  await mode(page, "Preview");
  await expect(page.locator("#preview .mermaid-diagram svg")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const diagramWidth = await page.locator("#preview .mermaid-diagram svg").evaluate(svg => svg.getBoundingClientRect().width);
  expect(diagramWidth).toBeGreaterThan(300);
});

test("invalid math and diagrams remain readable and cannot load images or configuration", async ({ page, baseURL }) => {
  const remote = [], files = [];
  page.on("request", request => {
    if (!request.url().startsWith(baseURL + "/")) remote.push(request.url());
    if (request.url().includes("must-not-load")) files.push(request.url());
  });
  const body = '$\\notACommand{x}$\n\n$\\includegraphics{https://example.com/must-not-load.png}$\n\n```mermaid\nnot a diagram\n```\n\n```mermaid\nflowchart LR\n A@{ img: "./must-not-load.png" }\n```\n\n```mermaid\n%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n A --> B\n```\n\n```mermaid\nsequenceDiagram\n Alice->>Bob: Hello\n```';
  await openSeed(page, body);
  await mode(page, "Preview");
  await expect(page.locator("#preview .math.render-error")).toHaveCount(1);
  await expect(page.locator("#preview p.render-error")).toHaveCount(3);
  await expect(page.locator("#preview .mermaid-diagram svg")).toHaveCount(1);
  await expect(page.locator("#preview .math").first()).toHaveText('\\notACommand{x}');
  expect(remote).toEqual([]); expect(files).toEqual([]);
  await openSeed(page, "A newer note.");
  await mode(page, "Preview");
  await expect(page.locator("#preview")).toHaveText("A newer note.");
  await expect(page.locator("#preview svg")).toHaveCount(0);
});

test("Mermaid code in Write keeps its exact fenced source on body edits", async ({ page }) => {
  const diagram = '```mermaid\nflowchart LR\n  A --> B\n```';
  const id = await openSeed(page, diagram + "\n\nBody.");
  await mode(page, "Write");
  await expect(page.locator("#rich-pane")).toBeVisible();
  await expect(page.locator(".write-diagram-drawing svg")).toHaveCount(1);
  await page.locator(".tiptap > p").filter({ hasText: "Body." }).click();
  await expect(page.locator(".tiptap .ProseMirror-selectednode")).toHaveCount(0);
  await page.keyboard.press("End"); await page.keyboard.type(" More.");
  await expect.poll(() => diskBody(page, id)).toBe(diagram + "\n\nBody. More.");
});

test("Write renders Mermaid lazily and edits source with cancel, validation and undo", async ({ page, baseURL }) => {
  const remote = [], assets = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== baseURL) remote.push(request.url());
    if (url.pathname.startsWith("/assets/")) assets.push(url.pathname);
  });
  await openSeed(page, "Plain."); await mode(page, "Write");
  await expect(page.locator(".tiptap")).toContainText("Plain.");
  expect(assets.some(path => path.includes("preview-diagrams"))).toBe(false);
  const diagram = '  ~~~~mermaid   extra-info  \n  flowchart LR\n    A --> B\n  ~~~~~  ';
  const body = "Before.\n\n" + diagram + "\n \nAfter.\n";
  const id = await openSeed(page, body); await mode(page, "Write");
  const drawing = page.getByRole("button", { name: "Edit Mermaid diagram", exact: true });
  await expect(drawing.locator("svg")).toHaveCount(1);
  await drawing.focus(); await drawing.press("Enter");
  const field = page.getByLabel("Mermaid source", { exact: true });
  await expect(field).toHaveValue("  flowchart LR\n    A --> B");
  await field.fill("flowchart LR\n A --> Cancelled"); await field.press("Escape");
  await expect(field).toBeHidden(); expect(await diskBody(page, id)).toBe(body);
  await drawing.click(); await field.fill("flowchart LR\n A --> Cancelled");
  await page.locator(".write-diagram").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await diskBody(page, id)).toBe(body);
  await drawing.click(); await field.fill("flowchart LR\n~~~~");
  await page.locator(".write-diagram").getByRole("button", { name: "Apply", exact: true }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true"); expect(await diskBody(page, id)).toBe(body);
  await field.fill("  flowchart LR\n    A --> Edited");
  await expect(page.locator(".write-diagram-preview svg")).toContainText("Edited");
  await field.press("Control+Enter");
  const edited = body.replace("A --> B", "A --> Edited");
  await expect.poll(() => diskBody(page, id)).toBe(edited);
  await drawing.click(); await field.fill("  flowchart LR\n    A --> Applied");
  await page.locator(".write-diagram").getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => diskBody(page, id)).toBe(body.replace("A --> B", "A --> Applied"));
  await page.locator(".tiptap > p").last().click(); await page.keyboard.press("Control+z");
  await expect.poll(() => diskBody(page, id)).toBe(edited);
  await page.keyboard.press("Control+z"); await expect.poll(() => diskBody(page, id)).toBe(body);
  await page.keyboard.press("Control+Shift+z"); await expect.poll(() => diskBody(page, id)).toBe(edited);
  await mode(page, "Markdown"); await mode(page, "Write");
  await expect(drawing.locator("svg")).toContainText("Edited");
  expect(remote).toEqual([]);
});

test("Write keeps invalid and blocked Mermaid readable offline on phones", async ({ page, baseURL }) => {
  const requests = [];
  page.on("request", request => { if (request.url().includes("must-not-load") || !request.url().startsWith(baseURL + "/")) requests.push(request.url()); });
  const sources = ["not a diagram", 'flowchart LR\n A@{ img: "./must-not-load.png" }', '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n A --> B', "flowchart LR\n classDef danger fill:red\n A --> B"];
  const body = sources.map(source => "```mermaid\n" + source + "\n```").join("\n\n") + "\n\nBody.";
  const id = await openSeed(page, body); await mode(page, "Write");
  await expect(page.locator(".write-diagram-drawing p.render-error")).toHaveCount(4);
  for (let i = 0; i < sources.length; i++) await expect(page.locator(".write-diagram-drawing pre").nth(i)).toHaveText(sources[i]);
  const first = page.locator(".write-diagram").first();
  await first.getByRole("button", { name: "Edit Mermaid diagram" }).click();
  const field = first.getByLabel("Mermaid source"); await field.fill("still invalid"); await field.press("Control+Enter");
  await expect.poll(() => diskBody(page, id)).toBe(body.replace("not a diagram", "still invalid"));
  await page.setViewportSize({ width: 320, height: 720 });
  await first.getByRole("button", { name: "Edit Mermaid diagram" }).click();
  await field.fill("flowchart LR\n Start --> A_very_long_node_name --> Another_long_node_name --> End");
  await expect(first.locator(".write-diagram-preview svg")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await field.press("Control+Enter");
  await expect(first.locator(".write-diagram-drawing svg")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests).toEqual([]);
});

test("Write keeps Mermaid fences and nested sources exact through edits", async ({ page }) => {
  test.setTimeout(60_000);
  const cases = ['  ```mermaid  \n  flowchart LR\n    A --> B\n  ```` ', '~~~~mermaid\nflowchart LR\n A --> B\n~~~~', '> ```mermaid\n> flowchart LR\n>  A --> B\n> ```', '- Item\n\n  ```mermaid\n  flowchart LR\n    A --> B\n  ```', '- Item\n  ```mermaid\n  flowchart LR\n    A --> B\n  ```', '- Item\n\n    ```mermaid\n    flowchart LR\n      A --> B\n    ```', '1) Item\n\n   ```mermaid\n   flowchart LR\n     A --> B\n   ```'];
  for (const diagram of cases) {
    const body = diagram + "\n\nBody.";
    const id = await openSeed(page, body); await mode(page, "Write");
    await expect(page.locator(".write-diagram-drawing svg")).toHaveCount(1);
    await page.locator(".tiptap > p").filter({ hasText: "Body." }).click();
    await expect(page.locator(".tiptap .ProseMirror-selectednode")).toHaveCount(0);
    await page.keyboard.press("End"); await page.keyboard.type(" More.");
    await expect.poll(() => diskBody(page, id)).toBe(body + " More.");
    await page.getByRole("button", { name: "Edit Mermaid diagram", exact: true }).click();
    const field = page.getByLabel("Mermaid source", { exact: true });
    await field.fill((await field.inputValue()).replace("A --> B", "A --> Changed"));
    await field.press("Control+Enter");
    await expect.poll(() => diskBody(page, id)).toBe(body.replace("A --> B", "A --> Changed") + " More.");
  }
});

test("Write preserves Mermaid at EOF with empty or unclosed fences", async ({ page }) => {
  for (const body of ["```mermaid\n```", "```mermaid\n\n```\n", "```mermaid\nflowchart LR\n A --> B", "```mermaid\nflowchart LR\n A --> B\n"]) {
    const id = await openSeed(page, body); await mode(page, "Write");
    await page.getByRole("button", { name: "Edit Mermaid diagram", exact: true }).click();
    const field = page.getByLabel("Mermaid source", { exact: true });
    const old = await field.inputValue();
    await field.fill(old.includes("A --> B") ? old.replace("A --> B", "A --> Edited") : "flowchart LR\n A --> Edited");
    await field.press("Control+Enter");
    const expected = old.includes("A --> B") ? body.replace("A --> B", "A --> Edited") : body.replace(/\n(?:\n)?```/, "\nflowchart LR\n A --> Edited\n```");
    await expect.poll(() => diskBody(page, id)).toBe(expected);
  }
});

test("Write saves blocks it did not change exactly as they were written", async ({ page }) => {
  test.setTimeout(90_000);
  const blocks = [
    "Setext\n======", "Setext two\n---", "***", "___", "~~~js\ncode\n~~~", "    indented code",
    "<https://example.com> and https://bare.example.com", "# Heading #", "- a\n\n- loose b",
    "* star\n* bullets", "+ plus\n+ bullets", "1) paren\n2) numbers", "- a\n    - four-space nested",
    "> quote\nlazy line", "| a | b |\n|:-|-:|\n| 1 | 2 |", "Use snake_case, [brackets], 2*3 and a ~ tilde.",
    "Some _em_ and __strong__ and ~one~ and ` padded ` code.", "Escapes \\# \\> \\* kept.",
  ];
  const body = blocks.join("\n\n") + "\n\nBody.";
  const id = await openSeed(page, body);
  await mode(page, "Write");
  await expect(page.locator("#rich-pane")).toBeVisible();
  const last = page.locator(".tiptap > p").filter({ hasText: "Body." });
  await last.click(); await page.keyboard.press("End"); await page.keyboard.type(" More.");
  await expect.poll(() => diskBody(page, id)).toBe(body + " More.");
  // Undoing back to the original text restores each block's own Markdown.
  await page.keyboard.press("Control+z");
  await expect.poll(() => diskBody(page, id)).toBe(body);
});

test("editing a paragraph keeps its own escapes, delimiters, links and breaks", async ({ page }) => {
  test.setTimeout(90_000);
  const cases = [
    "Body. Use snake_case, [brackets], 2*3, a ~ tilde, a < b and A & B.",
    "Body. Some _em_ and __strong__ and *em* and **strong** and ~one~ and ~~two~~.",
    "Body. Code ``a`b`` and ` padded ` and `x`.",
    "Body. Escapes \\* \\_ \\[ \\] \\# \\> \\\\ \\` \\~ \\$5 kept.",
    "Body. Entities &amp; &lt; &gt; &quot; &#169; &#x1F600; kept.",
    "Body. A trailing backslash\\\nhard break and two spaces  \nbreak.",
    "Body. <https://example.com> and https://bare.example.com/a_b and [t](https://e.com \"title\").",
    "- Body. star *bullet* with snake_case",
    "> Body. quoted _em_ and [brackets]",
    "# Body. heading with snake_case",
  ];
  for (const body of cases) {
    const id = await openSeed(page, body);
    await mode(page, "Write");
    await expect(page.locator("#rich-pane"), body).toBeVisible();
    const block = page.locator(".tiptap").getByText("Body.", { exact: false }).first();
    await block.click({ position: { x: 2, y: 8 } });
    await page.keyboard.press("Home"); await page.keyboard.type("Edited ");
    await expect.poll(() => diskBody(page, id), body).toBe(body.replace("Body.", "Edited Body."));
  }
});

test("edited lists, code blocks and headings keep their markers, fences and underlines", async ({ page }) => {
  test.setTimeout(90_000);
  const cases = [
    "* Body. star\n* bullets", "+ Body. plus\n+ bullets", "1) Body. paren\n2) numbers",
    "- outer\n  * Body. nested star", "Body. setext\n======", "Body. setext two\n---", "# Body. closed #",
    "~~~js\nBody. tilde fence\n~~~", "````\nBody. long fence\n````", "    Body. indented code",
  ];
  for (const body of cases) {
    const id = await openSeed(page, body + "\n\n***\n\nAfter.");
    await mode(page, "Write");
    await expect(page.locator("#rich-pane"), body).toBeVisible();
    await page.locator(".tiptap").getByText("Body.", { exact: false }).first().click({ position: { x: 2, y: 8 } });
    await page.keyboard.press("Home"); await page.keyboard.type("Edited ");
    // The rule below and the paragraph after it stay as written too.
    await expect.poll(() => diskBody(page, id), body).toBe(body.replace("Body.", "Edited Body.") + "\n\n***\n\nAfter.");
  }
});

test("tasks after plain bullets in the same list keep their checked state", async ({ page }) => {
  const body = "Body. intro\n\n- **Flat:** under.\n- **No ear:** score.\n\n- [x] First (see [[Note]])\n- [ ] Try rye";
  const id = await openSeed(page, body);
  await mode(page, "Write");
  await expect(page.locator(".tiptap li[data-checked='true']")).toHaveCount(1);
  await page.locator(".tiptap p").filter({ hasText: "Body." }).click({ position: { x: 2, y: 8 } });
  await page.keyboard.press("Home"); await page.keyboard.type("Edited ");
  await expect.poll(() => diskBody(page, id)).toBe(body.replace("Body.", "Edited Body."));
});

test("edited notes keep soft line breaks, the gaps between blocks and untouched table rows", async ({ page }) => {
  test.setTimeout(90_000);
  const cases = [
    "Body. line one\nline two soft.",
    "Body. para\n# one\n## two\n### three",
    "Body. para\n\n\n| a | b |\n| --- | --- |\n| 1 | 2 |",
    "Body. para\n\n- [ ] task\n- [x] done",
    "x\n\nBody.\n\n\n\n\ny\n\nz\n\n\n\n- [ ] task",
    "Intro.\n\n| a | b |\n| --- | --- |\n| Body. | 2 |\n| keep  |  this |",
    "| Body. head | b |\n|:-|-:|\n| `x \\| y` | [[Note\\|label]] |",
    "Body.\n\n- [x] First\n- [ ] Try\n",
  ];
  for (const body of cases) {
    const id = await openSeed(page, body);
    await mode(page, "Write");
    await expect(page.locator("#rich-pane"), body).toBeVisible();
    await page.locator(".tiptap").getByText("Body.", { exact: false }).first().click({ position: { x: 2, y: 8 } });
    await page.keyboard.press("Home"); await page.keyboard.type("Edited ");
    await expect.poll(() => diskBody(page, id), body).toBe(body.replace("Body.", "Edited Body."));
  }
});

test("characters typed in Write are escaped only where they would become formatting", async ({ page }) => {
  const id = await openSeed(page, "Start.");
  await mode(page, "Write");
  await page.locator(".tiptap p").click(); await page.keyboard.press("End");
  await page.keyboard.type(" snake_case, 2*3 and [x] but a literal [a](b) here.");
  await expect.poll(() => diskBody(page, id)).toBe("Start. snake_case, 2*3 and [x] but a literal \\[a](b) here.");
});

test("Write keeps inline and display formulas exact through body edits", async ({ page }) => {
  test.setTimeout(90_000);
  const cases = [
    'Distance $d=vt$. A square $a^2 + b^2 = c^2$.\n\nBody.',
    'Inline $\\frac{a}{b}_{i}*x*$ and $\\$ 5$ and `$code$`. Money $5 and $6, $x $y$ and $$not$$.\n\nBody.',
    'Before.\n\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n\nBody.',
    'Before.\n\n  $$ E = mc^2 $$  \nBody.',
    'Before.\n\n$$  \na\n\nb\n  $$\n\n\nBody.',
    '# Heading $h_1$\n\n- item $x$\n- other $z$\n\n> quote $q$\n\nBody.',
    'Body.\n\n$$\n$$\n',
    'Price \\$5 and \\$6 or \\$x$ here.\n\nBody.',
    '**bold $x^2$ text** and *it $\\alpha$* and ~~st $y$~~ and ==hl $z$==.\n\nBody.',
    '**$x$** and [see $\\frac{a}{b}$](https://example.com) and **\\$5** and *$a*b$ c*.\n\nBody.',
    '[link](http://x.org/$y$) text $q$\n\nBody.',
    'Text\n$$\nx = 1\n$$\nBody.',
    '- item\n\n  $$\n  x\n  $$\n  more\n\n  after\n- next\n\nBody.',
    '- outer $o$\n  - inner\n\n    $$\n    x\n\n    y\n    $$\n\nBody.',
    '> quote\n> $$\n> x\n> $$\n>\n> tail\n\nBody.',
    '> - item\n>\n>   $$\n>   x\n>   $$\n\nBody.',
    'Body.\n\n$$\n\\sqrt{2}\n$$',
  ];
  for (const body of cases) {
    const id = await openSeed(page, body);
    await mode(page, "Write");
    await expect(page.locator("#rich-pane"), body).toBeVisible();
    const paragraph = page.locator(".tiptap > p").filter({ hasText: "Body." }).first();
    await paragraph.click({ position: { x: 2, y: 8 } });
    await page.keyboard.press("Home"); await page.keyboard.type("Edited ");
    await expect.poll(() => diskBody(page, id), body).toBe(body.replace("Body.", "Edited Body."));
  }
});

test("Write edits formulas in place with live rendering, validation and undo", async ({ page }) => {
  const body = 'Area $\\pi r^2$ here.\n\n$$\nx = 1\n$$\n\nAfter.';
  const id = await openSeed(page, body);
  await mode(page, "Write");
  await expect(page.locator(".tiptap .katex")).toHaveCount(2);
  const inline = page.locator(".write-math .write-math-formula");
  await inline.click();
  const field = page.getByLabel("Formula TeX", { exact: true });
  await expect(field).toHaveValue("\\pi r^2");
  await field.fill(" bad ");
  await page.locator(".write-math").getByRole("button", { name: "Apply" }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(await diskBody(page, id)).toBe(body);
  await field.fill("\\tau r^2");
  await expect(page.locator(".write-math .write-math-preview .katex")).toHaveCount(1);
  await field.press("Control+Enter");
  await expect.poll(() => diskBody(page, id)).toBe(body.replace("\\pi", "\\tau"));
  await page.locator(".write-math-block .write-math-formula").click();
  const display = page.getByLabel("Display formula TeX", { exact: true });
  await display.fill("x = 1\n$$\ny");
  await page.locator(".write-math-block").getByRole("button", { name: "Apply" }).click();
  await expect(display).toHaveAttribute("aria-invalid", "true");
  await display.fill("x = 2\n+ 3");
  await display.press("Escape");
  expect(await diskBody(page, id)).toBe(body.replace("\\pi", "\\tau"));
  await page.locator(".write-math-block .write-math-formula").click();
  await display.fill("x = 2\n+ 3");
  await display.press("Control+Enter");
  const edited = body.replace("\\pi", "\\tau").replace("x = 1", "x = 2\n+ 3");
  await expect.poll(() => diskBody(page, id)).toBe(edited);
  await page.locator(".tiptap > p").last().click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => diskBody(page, id)).toBe(body.replace("\\pi", "\\tau"));
  await mode(page, "Preview");
  await expect(page.locator("#preview .katex")).toHaveCount(2);
});

test("Write creates formulas by typing and keeps unsupported math layouts in Markdown", async ({ page }) => {
  const id = await openSeed(page, "Start.");
  await mode(page, "Write");
  await page.locator(".tiptap p").click(); await page.keyboard.press("End");
  await page.keyboard.type(" Costs $5 and $6. Then $a+b$ done.");
  await expect(page.locator(".tiptap .write-math")).toHaveCount(1);
  await page.keyboard.press("Enter"); await page.keyboard.type("$$"); await page.keyboard.press("Enter");
  const display = page.getByLabel("Display formula TeX", { exact: true });
  await expect(display).toBeFocused();
  await display.fill("c^2"); await display.press("Control+Enter");
  await expect.poll(() => diskBody(page, id)).toBe("Start. Costs $5 and $6. Then $a+b$ done.\n\n$$\nc^2\n$$");
  // A formula lazily below a list nested in a quote still keeps Markdown.
  const nested = "> - item\n> $$\n> x\n> $$";
  const other = await openSeed(page, nested);
  await mode(page, "Write");
  await expect(page.locator("#toast-text")).toContainText("Showing Markdown");
  await expect(page.locator("#source-pane")).toBeVisible();
  expect(await diskBody(page, other)).toBe(nested);
});

test("display formulas in numbered lists and directly below lists or quotes stay exact", async ({ page }) => {
  test.setTimeout(90_000);
  const cases = [
    "1. Body. item\n\n   $$\n   x\n   $$\n\n2. second",
    "1. Body. item\n   $$\n   x\n   $$\n2. next",
    "10. Body. ten\n\n    $$\n    y\n    $$",
    "- Body. item\n$$\nx\n$$\n\nAfter.",
    "> Body. quote\n$$\nx\n$$\nAfter.",
    "1. Body. loose\n\n2. items",
    "- Body. loose\n\n- bullets\n- tight after",
  ];
  for (const body of cases) {
    const id = await openSeed(page, body);
    await mode(page, "Write");
    await expect(page.locator("#rich-pane"), body).toBeVisible();
    await page.locator(".tiptap").getByText("Body.", { exact: false }).first().click({ position: { x: 2, y: 8 } });
    await page.keyboard.press("Home"); await page.keyboard.type("Edited ");
    await expect.poll(() => diskBody(page, id), body).toBe(body.replace("Body.", "Edited Body."));
  }
  // Preview, too, ends the list before such a formula.
  const id = await openSeed(page, "- item\n$$\nx\n$$");
  await mode(page, "Preview");
  await expect(page.locator("#preview > ul + .math .katex")).toHaveCount(1);
  expect(await diskBody(page, id)).toBe("- item\n$$\nx\n$$");
});

for (const [index, text] of [
  "Text[^1] and again[^1].\n\n[^1]: Keep this definition.\n",
  "Text[^source].\n\n[^source]:  First **bold** line.  \n    Continued with [a link](https://example.com).\n\n    A second paragraph.\n\nAfter.",
  "Text[^a] and text[^b].\n\n\n[^a]: One.\n[^b]: Two.\n\n\n",
  "[^named]: Before the text.\n\nText[^named].",
  "Text[^tab].\n\n[^tab]: First.\n\tTabbed continuation.\n",
  '```text\n[^code]: literal\n```\n\nText[^real].\n\n[^real]: Actual note.',
].entries()) {
  test(`Write keeps footnote definition case ${index + 1} exact through body edits`, async ({ page }) => {
    const id = await openSeed(page, text);
    await mode(page, "Write");
    await expect(page.locator("#rich-pane")).toBeVisible();
    expect(await diskBody(page, id)).toBe(text);
    const paragraph = page.locator(".tiptap > p").filter({ hasText: "Text" }).first();
    await paragraph.click({ position: { x: 2, y: 8 } });
    await page.keyboard.press("Home"); await page.keyboard.type("Edited ");
    await expect.poll(() => diskBody(page, id)).toBe(text.replace("Text", "Edited Text"));
    await mode(page, "Markdown"); await mode(page, "Write");
    await expect(page.locator("#rich-pane")).toBeVisible();
    expect(await diskBody(page, id)).toBe(text.replace("Text", "Edited Text"));
  });
}

test("Write edits multiline footnotes, follows references and undoes definition edits", async ({ page }) => {
  const text = '---\ntags: [research]\n---\n\nA claim[^source] and another[^2].\n\n[^source]:  First line.  \n\tNext line.\n\n[^2]: Untouched.\n';
  const id = await openSeed(page, text);
  await mode(page, "Write");
  const field = page.getByRole("textbox", { name: "Footnote source", exact: true });
  await expect(field).toHaveValue("First line.  \nNext line.");
  await page.getByRole("button", { name: "Edit footnote source", exact: true }).click();
  await expect(field).toBeFocused();
  await field.fill("Revised line.  \nNext line.\nA new continuation.");
  const edited = text.replace("First line.  \n\tNext line.", "Revised line.  \n\tNext line.\n    A new continuation.");
  await expect.poll(() => diskBody(page, id)).toBe(edited);
  await page.locator(".tiptap > p").first().click({ position: { x: 2, y: 8 } });
  await page.keyboard.press("Control+z");
  await expect.poll(() => diskBody(page, id)).toBe(text);
  await expect(field).toHaveValue("First line.  \nNext line.");
  await field.fill("Changed.");
  await expect.poll(() => diskBody(page, id)).toBe(text.replace("First line.  \n\tNext line.", "Changed."));
  await page.reload(); await mode(page, "Write");
  await expect(page.getByRole("textbox", { name: "Footnote source", exact: true })).toHaveValue("Changed.");
  await mode(page, "Preview");
  await expect(page.locator("#preview .footnotes")).toContainText("Changed.");
  await expect(page.locator("#preview .footnotes")).toContainText("Untouched.");
});

test("unsupported footnote layouts fall back and unresolved references stay exact", async ({ page }) => {
  for (const text of [
    "Text[^a].\n\n[^a]: One.\n\n[^a]: Duplicate.",
    "Text[^my label].\n\n[^my label]: A spaced label.",
    "**Text^[inline aside].**",
    "[Link^[aside]](https://example.com).",
    "Text^[unfinished.",
    "Text^[two\n\nparagraphs].",
    "| Cell |\n| --- |\n| Text^[a \\| b] |",
    "Escaped \\^[literal aside].",
    "Escaped \\[^a].",
    "**Bold[^a] text.**\n\n[^a]: Note.",
  ]) {
    const id = await openSeed(page, text); await mode(page, "Write");
    // The Markdown view may still show from the previous note; the message
    // only appears once Write has declined this one.
    await expect(page.locator("#toast-text"), text).toContainText("Showing Markdown");
    await expect(page.locator("#source-pane")).toBeVisible();
    expect(await diskBody(page, id)).toBe(text);
  }
  const id = await openSeed(page, "Unresolved[^missing].\n\nBody."); await mode(page, "Write");
  await page.getByRole("button", { name: "Edit footnote missing", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#toast-text")).toContainText("has no definition yet");
  expect(await diskBody(page, id)).toBe("Unresolved[^missing].\n\nBody.");
});

test("breadcrumb folder glyph follows the text baseline across font sizes and zoom", async ({ page }) => {
  await openSeed(page, "A nested note.", `Lab/Baseline ${Date.now()}`);
  await page.evaluate(() => document.fonts.ready);
  for (const fontSize of [18, 22]) {
    for (const zoom of [0.8, 1, 1.25, 1.5]) {
      const fit = await page.evaluate(({ fontSize, zoom }) => {
        document.body.style.zoom = String(zoom);
        document.querySelectorAll(".breadcrumb").forEach(el => { el.style.fontSize = `${fontSize}px`; });
        const name = document.querySelector(".breadcrumb:not(:has(svg))");
        const marker = document.createElement("span");
        marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
        name.append(marker); const baseline = marker.getBoundingClientRect().top; marker.remove();
        const context = document.createElement("canvas").getContext("2d"); context.font = getComputedStyle(name).font;
        const metrics = context.measureText("H");
        const glyph = document.querySelector(".breadcrumb svg path").getBoundingClientRect();
        return { top: (glyph.y - baseline) / zoom + metrics.actualBoundingBoxAscent, bottom: (glyph.bottom - baseline) / zoom };
      }, { fontSize, zoom });
      expect(Math.abs(fit.top), `top at ${fontSize}px, ${zoom} zoom`).toBeLessThan(1.5);
      expect(Math.abs(fit.bottom), `baseline at ${fontSize}px, ${zoom} zoom`).toBeLessThan(1);
    }
  }
});


test("Write task statuses preserve markers, spacing, nesting and final newlines", async ({ page }) => {
  for (const list of [
    "- [ ] Open\n- [X] Done\n- [?] Question\n- [/] Working\n- [-] Cancelled\n- [>] Later\n- [!] Important\n- [z] Custom",
    "+  [?]\tQuestion\n+  [/]  Working\n+  [X] Done\n",
    "- [?] Parent\n  - [/] Child\n    - [!] Deep child\n- [>] Later",
  ]) {
    const text = list + "\n\nBody.";
    const id = await openSeed(page, text); await mode(page, "Write");
    await expect(page.locator("#rich-pane")).toBeVisible();
    await page.locator(".tiptap > p").last().click(); await page.keyboard.press("End"); await page.keyboard.type(" Edited.");
    await expect.poll(() => diskBody(page, id)).toBe(text + " Edited.");
    await page.reload(); await mode(page, "Write");
    await page.getByRole("combobox", { name: list.includes("Parent") ? "Task status for Parent" : "Task status for Question", exact: true }).selectOption("!");
    await expect.poll(() => diskBody(page, id)).toBe((text + " Edited.").replace("[?]", "[!]"));
  }
});

test("Write changes task status, uses checkboxes and undoes status edits on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const text = "- [?] Review\n- [X] Keep uppercase\n\nBody.\n";
  const id = await openSeed(page, text); await mode(page, "Write");
  const select = page.getByRole("combobox", { name: "Task status for Review", exact: true });
  await select.selectOption("/"); await expect.poll(() => diskBody(page, id)).toBe(text.replace("[?]", "[/]"));
  await page.locator(".tiptap > p").last().click(); await page.keyboard.press("Control+z");
  await expect.poll(() => diskBody(page, id)).toBe(text);
  await select.selectOption("x"); await expect.poll(() => diskBody(page, id)).toBe(text.replace("[?]", "[x]"));
  await page.getByRole("checkbox", { name: "Task item checkbox for Review", exact: true }).uncheck();
  await expect.poll(() => diskBody(page, id)).toBe(text.replace("[?]", "[ ]"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("custom task layouts that cannot stay exact keep the source fallback", async ({ page }) => {
  for (const text of ["- [?] Question\n- Plain bullet", "- [?] First\n\n- [/] Loose", "1. [?] Ordered", "- [?] First\n  A continuation."]) {
    const id = await openSeed(page, text); await mode(page, "Write");
    await expect(page.locator("#source-pane")).toBeVisible(); expect(await diskBody(page, id)).toBe(text);
  }
});

test("typing a custom task status creates an editable task", async ({ page }) => {
  const id = await openSeed(page, ""); await mode(page, "Write");
  await expect(page.locator("#rich-pane")).toBeVisible();
  await page.locator(".tiptap p").click();
  await page.keyboard.type("- [?] New task");
  await expect(page.getByRole("combobox", { name: "Task status for New task", exact: true })).toBeVisible();
  await expect.poll(() => diskBody(page, id)).toBe("- [?] New task");
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); await page.keyboard.type("After.");
  await expect.poll(() => diskBody(page, id)).toBe("- [?] New task\n\nAfter.");
});
