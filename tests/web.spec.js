import { test, expect } from "@playwright/test";

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
  if (await page.locator("#view-type").isVisible()) {
    await page.locator("#view-type").click();
    await page.getByRole("option", { name, exact: true }).click();
    await expect(page.locator("#view-menu")).toBeHidden();
  } else {
    await menu(page, "view");
    await page.getByRole("menuitem", { name, exact: true }).click();
    await expect(page.locator("#menu-popup")).toBeHidden();
  }
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
  await openSeed(page, "A document with menus.");
  const menus = await page.locator("#menu-bar").boundingBox();
  expect(Math.abs(menus.x + menus.width / 2 - homeMenus.x - homeMenus.width / 2)).toBeLessThan(1);
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
  await page.clock.pauseAt(new Date());
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
  await expect(page.locator(".theme-option")).toHaveCount(14);
  await page.locator('[data-theme-id="catppuccin-mocha"]').click();
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
  await page.locator('[data-theme-id="light"]').hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "catppuccin-mocha",
  );
  await openThemes(page);
  await page.locator('[data-theme-id="light"]').click();
  await expect(page.locator("#rich-pane")).toHaveCSS(
    "background-color",
    "rgb(251, 252, 253)",
  );
});

test("every theme draws text, accents, pills and focus rings at AA contrast", async ({ page }) => {
  await openSeed(page, "Contrast.");
  await openThemes(page);
  const ids = await page.locator(".theme-option").evaluateAll((options) => options.map((o) => o.dataset.themeId));
  expect(ids).toHaveLength(14);
  for (const id of ids) {
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
  await expect(picker.locator(".theme-option")).toHaveCount(14);
  await expect(picker.locator(".theme-list .theme-swatch i")).toHaveCount(56);
  const rows = await picker.locator(".theme-option").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
  expect(new Set(rows).size).toBe(1);
  await page.getByLabel("Find a theme").fill("catppuccin");
  await expect(picker.locator(".theme-option")).toHaveCount(4);
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

test("theme keyboard preview wraps, cancels and commits a filtered selection", async ({ page }) => {
  await openSeed(page, "# Keyboard themes");
  await openThemes(page);
  const search = page.getByRole("combobox", { name: "Find a theme" });
  await search.fill("Labradorite Dark");
  await search.press("Enter");
  // Choosing closes the list and keeps the settings window open.
  await expect(page.locator("#theme-panel")).toBeHidden();
  await expect(page.locator("#modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).not.toBeVisible();
  await openThemes(page);
  await search.press("ArrowUp");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gruvbox-light");
  await expect(page.getByRole("listbox", { name: "Themes" }).getByRole("option", { selected: true })).toHaveAttribute("data-theme-id", "gruvbox-light");
  await expect(search).toHaveAttribute("aria-activedescendant", "theme-option-gruvbox-light");
  // Preview changes the page, but never persists until Enter/click.
  expect((await (await page.request.get("/api/state")).json()).theme).toBe("dark");
  await search.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await search.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await search.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openThemes(page);
  await search.fill("catppuccin");
  await expect(page.getByRole("listbox", { name: "Themes" }).getByRole("option")).toHaveCount(4);
  await search.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "catppuccin-macchiato");
  await search.press("Enter");
  // Choosing keeps the theme and leaves the window open for other settings.
  await expect(page.locator("#modal")).toBeVisible();
  await expect.poll(async () => (await (await page.request.get("/api/state")).json()).theme).toBe("catppuccin-macchiato");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#modal")).not.toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "catppuccin-macchiato");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "catppuccin-macchiato");
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
  await page.getByLabel("Note path").fill(renamed);
  await page.getByRole("button", { name: "Rename note", exact: true }).click();
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
  page, context,
}) => {
  const original = "Before disconnect.";
  const draft = "Keep this unsaved draft.";
  const id = await openSeed(page, original);
  await mode(page, "Markdown");
  // Keep the simulated server outage in force across document teardown/reload,
  // including saves attempted by the old document's visibilitychange handler.
  const blockWrites = (route) => route.request().method() === "PUT"
    ? route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulated save outage" }),
      })
    : route.continue();
  await context.route("**/api/note", blockWrites);
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
  await context.unroute("**/api/note", blockWrites);
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
  context,
}) => {
  const id = await openSeed(page, "Saved base.");
  await mode(page, "Markdown");
  await context.route("**/api/note", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback(),
  );
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

  // Once the parent is gone, its leftover draft can be discarded. Routes no
  // longer intercept a closing page, so its last save fails in the page.
  await page.evaluate(() => {
    const fetch = window.fetch;
    window.fetch = (url, options) =>
      options?.method === "PUT" ? Promise.reject(new Error("offline")) : fetch(url, options);
  });
  await page.close({ runBeforeUnload: false });
  await popup.reload();
  await expect(popup.locator("#draft-banner")).toBeVisible();
  await popup.locator("#discard-draft").click();
  await expect.poll(() => drafts(popup)).toEqual([]);
  await context.unroute("**/api/note");
});

test("drafts of notes renamed or deleted elsewhere can still be recovered", async ({
  page,
  context,
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
  await context.route("**/api/note", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback(),
  );
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
  await context.unroute("**/api/note");
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
    "---\ntitle: untouched\n---\n\nText with a footnote.[^1]\n\n[^1]: Keep this definition.\n";
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
  await page.route("**/api/note", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  const draft = "Draft text.[^1]\n\n[^1]: A footnote Write cannot keep.";
  await page.locator(".cm-content").fill(draft);
  await expect(page.locator("#error-banner")).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  await mode(page, "Write");
  await expect(page.locator("#rich-pane")).toBeVisible();
  await page.unroute("**/api/note");
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
  await page.locator("#sidebar-scrim").click();
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
      expect(Math.abs(menuBox.x + menuBox.width / 2 - headerBox.x - headerBox.width / 2)).toBeLessThan(2);
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
      await page.locator("#sidebar-scrim").click({ position: { x: width - 12, y: 300 } });
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
  await page.route("**/api/note", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
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
  await page.unroute("**/api/note");
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
  await page.route("**/api/note", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
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
  await page.unroute("**/api/note");
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
  await page.locator(".cm-content").fill("Shared line.\nFirst tab ending.");
  await expect.poll(() => diskBody(page, id)).toContain("First tab ending.");
  await second.locator(".cm-content").fill("Shared line.\nSecond tab ending.");
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
  await second.getByRole("button", { name: "Keep my edits" }).click();
  await expect(second.locator("#error-banner")).toBeHidden();
  await expect.poll(() => diskBody(page, id)).toContain("Second tab ending.");

  await page.locator(".cm-content").fill("Shared line.\nFirst tab again.");
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
  // Emulate a slow machine whose animation frames run late.
  await page.addInitScript(() => {
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      setTimeout(() => frame(callback), 300);
  });
  const stamp = Date.now();
  const kept = `Kept ${stamp}`;
  await seed(page, kept, "Kept body.");
  await openSeed(page, "Leaving.", `Leaving ${stamp}`);
  await page
    .getByRole("button", { name: "Move note to trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("Note moved to trash.");
  const opened = await page
    .locator("#note-list .note-row.selected")
    .getAttribute("data-note");
  await (await searchBox(page)).click();
  await page.keyboard.type(`k${stamp}`, { delay: 40 });
  await expect(page.locator("#search")).toHaveValue(`k${stamp}`);
  await expect(page.locator("#search")).toBeFocused();
  await page.waitForTimeout(600);
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
  await expect(page.locator(".cm-activeLineGutter")).toHaveText("9");

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
  await expect(page.locator(".cm-activeLineGutter")).toHaveText("83");
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
    const box = page.getByLabel("Properties");
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
  await page.getByLabel("Properties").fill("title: New\ntags: [travel, plans]");
  await expect.poll(() => diskBody(page, id)).toBe("---\ntitle: New\ntags: [travel, plans]\n---\n\n# Real heading\n\nText.");
  await page.locator(".tiptap p").click();
  await page.keyboard.press("Home");
  await page.keyboard.type("Typed ");
  await expect.poll(() => diskBody(page, id)).toBe("---\ntitle: New\ntags: [travel, plans]\n---\n\n# Real heading\n\nTyped Text.");

  // A note without front matter can start some.
  const plain = await openSeed(page, "Plain text.");
  await expect(page.getByLabel("Properties")).toBeHidden();
  await page.keyboard.press("Control+k");
  await page.keyboard.type(">add properties");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Properties")).toBeFocused();
  await page.keyboard.type("journal");
  await expect.poll(() => diskBody(page, plain)).toBe("---\ntags: journal\n---\n\nPlain text.");
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
  await page.locator("#document-title").click();
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

test("highlights render in Preview and Write keeps their == markers", async ({ page }) => {
  const id = await openSeed(page, "Plain ==marked== and ==🟢green== words.\n\nSecond line.");
  await mode(page, "Preview");
  await expect(page.locator("#preview mark")).toHaveCount(2);
  await expect(page.locator("#preview mark").first()).toHaveText("marked");
  await expect(page.locator("#preview mark.hl-green")).toHaveText("green");
  const tint = await page.locator("#preview mark").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(tint).not.toBe("rgba(0, 0, 0, 0)");
  // Editing elsewhere in Write saves the highlights unchanged.
  await mode(page, "Write");
  await page.getByRole("textbox", { name: "WYSIWYG editor" }).locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Added.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, id)).toBe("Plain ==marked== and ==🟢green== words.\n\nSecond line. Added.");
});
