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
async function mode(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
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

test("document menus switch views, close with Escape and disable note actions at home", async ({ page }) => {
  await page.goto("/");
  const file = page.locator('[data-menu="file"]');
  const view = page.locator('[data-menu="view"]');
  const popup = page.locator("#menu-popup");
  await file.click();
  await expect(popup.getByRole("menuitem", { name: "Rename or move…" })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-menu="edit"]')).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await expect(page.locator('[data-menu="edit"]')).toBeFocused();
  await openSeed(page, "A document with menus.");
  await view.click();
  await popup.getByRole("menuitem", { name: "Split", exact: true }).click();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "split");
  await expect(popup).toBeHidden();
  await view.click();
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await expect(view).toBeFocused();
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

test("all fourteen themes, preview cancel and persistence", async ({
  page,
}) => {
  await openSeed(page, "# Theme test\n\nHello.");
  await page.locator("#theme-button").click();
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
  await page.locator("#theme-button").click();
  await page.locator('[data-theme-id="light"]').hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "catppuccin-mocha",
  );
  await page.locator("#theme-button").click();
  await page.locator('[data-theme-id="light"]').click();
  await expect(page.locator("#rich-pane")).toHaveCSS(
    "background-color",
    "rgb(251, 252, 253)",
  );
});

test("theme picker is a compact palette list with an unobscured backdrop", async ({ page }) => {
  await openSeed(page, "# Themes");
  await page.locator("#theme-button").click();
  const picker = page.getByRole("dialog", { name: "Choose a theme" });
  await expect(picker).toBeVisible();
  expect((await picker.boundingBox()).width).toBeLessThanOrEqual(360);
  expect(await picker.evaluate((el) => getComputedStyle(el, "::backdrop").backdropFilter)).toBe("none");
  expect(await picker.evaluate((el) => getComputedStyle(el, "::backdrop").backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await expect(picker.locator(".theme-option")).toHaveCount(14);
  await expect(picker.locator(".theme-swatch i")).toHaveCount(56);
  const rows = await picker.locator(".theme-option").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
  expect(new Set(rows).size).toBe(1);
  await page.getByLabel("Find a theme").fill("catppuccin");
  await expect(picker.locator(".theme-option")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.locator("#sidebar-toggle").click();
  await page.locator("#theme-button").click();
  const box = await picker.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.height).toBeLessThanOrEqual(635);
});

test("theme keyboard preview wraps, cancels and commits a filtered selection", async ({ page }) => {
  await openSeed(page, "# Keyboard themes");
  await page.locator("#theme-button").click();
  const search = page.getByRole("combobox", { name: "Find a theme" });
  await search.fill("Labradorite Dark");
  await search.press("Enter");
  await expect(page.locator("#modal")).not.toBeVisible();
  await page.locator("#theme-button").click();
  await expect(search).toBeFocused();
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
  await page.locator("#theme-button").click();
  await search.fill("catppuccin");
  await expect(page.getByRole("listbox", { name: "Themes" }).getByRole("option")).toHaveCount(4);
  await search.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "catppuccin-macchiato");
  await search.press("Enter");
  await expect(page.locator("#modal")).not.toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "catppuccin-macchiato");
});

test("empty theme search and failed selection preserve the previous theme", async ({ page }) => {
  await openSeed(page, "# Theme recovery");
  const original = await page.locator("html").getAttribute("data-theme");
  await page.locator("#theme-button").click();
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
  const rows = page.locator(".note-row").filter({ hasText: "sorting needle" });
  const order = () => rows.evaluateAll((els) => els.map((el) => el.dataset.note));
  await expect(sort).toHaveValue("modified");
  await expect.poll(order).toEqual([ids[0], ids[2], ids[1]]);
  await sort.selectOption("title-asc");
  await expect.poll(order).toEqual([ids[2], ids[1], ids[0]]);
  await sort.selectOption("title-desc");
  await expect.poll(order).toEqual([ids[0], ids[1], ids[2]]);
  await page.reload();
  await expect(sort).toHaveValue("title-desc");
  await page.getByLabel("Search notes").fill(folder);
  await expect(page.locator("#note-count")).toHaveText("3");
  await page.locator("#next-note").click();
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
  await page.getByLabel("Search notes").fill("elusive searchable");
  await expect(page.locator(".note-row")).toHaveCount(1);
  await page.getByLabel("Search notes").fill("");
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
  await expect(page.getByLabel("Search notes")).toBeVisible();
  await page.locator("#sidebar-scrim").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
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
    expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(width - 1);
    expect((await frame.boundingBox()).width).toBeCloseTo(width, 0);
    await expect(page.locator("#source-pane")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.locator("#sidebar-toggle").click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.locator("#focus-button").click();
    await expect(page.locator("#sidebar")).toBeHidden();
    expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(width - 1);
    expect((await frame.boundingBox()).width).toBeCloseTo(width, 0);
    await page.locator("#focus-button").click();
  }
  // Keep the correct column after switching from a collapsed desktop to mobile.
  await page.locator("#sidebar-toggle").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(389);
  expect((await frame.boundingBox()).width).toBeCloseTo(390, 0);
  await page.locator("#sidebar-toggle").click();
  await expect(page.getByLabel("Search notes")).toBeVisible();
  await page.locator("#sidebar-scrim").click();
  expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(389);
  expect((await frame.boundingBox()).width).toBeCloseTo(390, 0);
});

test("writing starts below one header and one editor bar, even when zoomed", async ({ page }) => {
  await openSeed(page, "# Close to the top\n\nThe first paragraph should be in view.");
  for (const [width, height] of [[1440, 900], [720, 450], [390, 844]]) {
    await page.setViewportSize({ width, height });
    expect((await page.locator("#rich-editor").boundingBox()).y).toBeLessThanOrEqual(width < 700 ? 150 : 120);
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
  await page.locator("#focus-button").click();
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
  await page.getByRole("button", { name: "Go back to previous note" }).click();
  await expect(page.locator("#document-title")).toHaveText(origin);
  await mode(page, "Markdown");
  await page.locator(".cm-content").fill("Edit in origin.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => diskBody(page, origin)).toBe("Edit in origin.");
  await page.locator(`[data-note="${target}"]`).click();
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
  await page.locator("#theme-button").click();
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
  await page.locator("#search").fill(`zephyr${stamp}`);
  await expect(page.locator("#note-list .note-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Move note to trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("Note moved to trash.");
  await expect(page.locator("#modal")).toBeHidden();
  await expect(page.locator("#document-title")).not.toHaveText(lonely);
  await expect(page.locator("#note-list")).toContainText("No matching notes");
  await page.locator("#search").fill("");
  await page.locator("#search").fill(stamp.toString());
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
  await page.getByLabel("Search notes").fill("Same");
  await expect(page.locator("#error-text")).toContainText("different vault");
  await page.getByRole("textbox", { name: "WYSIWYG editor" }).fill("Edited here.");
  await expect(page.locator("#retry-save")).toHaveText("Retry save");
  await page.locator("#retry-save").click();
  await expect(page.locator("#error-text")).toContainText("different vault");
  await expect(page.locator("#download-draft")).toBeVisible();
  expect(leaked).toBe(false);
  expect(await diskBody(page, id)).toContain("Same text in both vaults.");
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
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#note-list")).toContainText("Second outside edit");
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
  await expect(page.locator("#modal-title")).toHaveText("Choose a theme");
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

test("note rows show the title, edit date and an excerpt that skips the title heading", async ({
  page,
}) => {
  const id = `Seed list ${Date.now()}`;
  await openSeed(page, `# ${id}\n\nStart the beans in May.`, id);
  const row = page.locator(`#note-list .note-row[data-note="${id}"]`);
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(row.locator(".note-title")).toHaveText(id);
  await expect(row.locator(".note-date")).not.toBeEmpty();
  await expect(row.locator(".note-excerpt")).toHaveText("Start the beans in May.");
});

test("search results show the matching passage with the match marked", async ({
  page,
}) => {
  const word = `marigold${Date.now()}`;
  const id = await openSeed(
    page,
    `# Garden\n\n${"Opening words. ".repeat(12)}Plant the ${word} <b>beds</b> early.`,
  );
  await page.locator("#search").fill(word.toUpperCase());
  const row = page.locator(`#note-list .note-row[data-note="${id}"]`);
  await expect(row.locator("mark")).toHaveText(word);
  await expect(row.locator(".note-excerpt")).toContainText(
    `Plant the ${word} <b>beds</b> early.`,
  );
  await expect(row.locator(".note-excerpt b")).toHaveCount(0);
  await page.locator("#search").fill("");
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
  await page.locator("#search").click();
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
  await page.locator("#search").fill(`Archived`);
  await expect(row(`${archive}/Old plan`)).toBeVisible();
  await page.locator("#search").fill("");
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
  await page.locator("#search").fill(String(stamp));
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
  const filter = page.getByLabel("Show notes with a tag");
  await expect(filter).toBeVisible();
  await expect(filter.locator("option", { hasText: `#${tag} · 3` })).toHaveCount(1);
  await filter.selectOption(tag);
  await expect(page.locator("#note-list .note-row")).toHaveCount(3);
  await expect(page.locator("#note-list")).not.toContainText(`Untagged ${stamp}`);
  await filter.selectOption("");
  await expect(page.locator("#note-list")).toContainText(`Untagged ${stamp}`);

  // Tags in Preview are buttons that apply the filter.
  await mode(page, "Preview");
  await page.locator("#preview .tag", { hasText: `#${tag}` }).click();
  await expect(filter).toHaveValue(tag);
  await expect(page.locator("#note-list .note-row")).toHaveCount(3);
  await filter.selectOption("");
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

test.describe("daily notes", () => {
  test.use({ timezoneId: "Pacific/Honolulu" });
  test("uses the local date and reopens the same text from every entry point", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#save-label")).toHaveText("Ready when you are");
    // UTC is already November 4; the writer's date is still November 3.
    await page.clock.setFixedTime(new Date("2026-11-04T03:00:00Z"));
    await page.locator('[data-menu="file"]').click();
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
  await page.locator('[data-menu="edit"]').click();
  await page.getByRole("menuitem", { name: "Find and replace…" }).click();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "source");
  const find = page.locator('.cm-search input[name="search"]');
  const replace = page.locator('.cm-search input[name="replace"]');
  await expect(find).toBeFocused();
  await find.fill("alpha");
  await replace.fill("omega");
  await replace.press("Tab");
  await page.locator('.cm-search button[name="replaceAll"]').click();
  await expect.poll(() => diskBody(page, id)).toContain("omega omega beta with edits");
  await find.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-search")).toHaveCount(0);
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
  await expect(page.locator(".cm-search")).toBeVisible();
  await expect(page.locator("#editor-area")).toHaveAttribute("data-mode", "split");
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.cm-search button[name="replaceAll"]')).toBeInViewport();
  expect(await page.locator(".cm-search").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
});

test("writing settings persist across modes, reloads and rich editor recreation", async ({ page }) => {
  const id = await openSeed(page, "Text made comfortable.");
  await page.locator('[data-menu="view"]').click();
  await page.getByRole("menuitem", {name:"Writing settings…"}).click();
  const dialog = page.getByRole("dialog", {name:"Writing settings"});
  await dialog.getByLabel("Text size", {exact:true}).selectOption("22");
  await dialog.getByLabel("Line width", {exact:true}).selectOption("960");
  await dialog.getByRole("checkbox", {name:/Check spelling/}).uncheck();
  await dialog.getByRole("button", {name:"Save settings"}).click();
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
  await page.getByLabel("Search notes, headings and commands").fill(">writing settings");
  await page.keyboard.press("Enter");
  await dialog.getByLabel("Text size", {exact:true}).selectOption("14");
  await dialog.getByRole("button", {name:"Cancel", exact:true}).click();
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "22px");
});

test("invalid saved preferences fall back safely and unavailable storage is explained", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("labradorite-writing", '{"textSize":900,"lineWidth":-1,"spellcheck":"no"}'));
  await openSeed(page, "Safe writing defaults.");
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "18px");
  await expect(page.locator("#rich-editor")).toHaveCSS("max-width", "760px");
  await expect(page.locator(".tiptap")).toHaveAttribute("spellcheck", "true");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); }; });
  await page.locator('[data-menu="view"]').click();
  await page.getByRole("menuitem", {name:"Writing settings…"}).click();
  await page.getByLabel("Text size", {exact:true}).selectOption("20");
  await page.getByRole("button", {name:"Save settings"}).click();
  await expect(page.locator("#rich-editor")).toHaveCSS("font-size", "20px");
  await expect(page.locator("#toast")).toContainText("could not remember them");
});

test("phone menus keep journal commands and settings reachable without a keyboard", async ({ page }) => {
  await openSeed(page, "A phone-sized writing space.", `A long document title that must leave room for the menus ${Date.now()}`);
  for (const width of [320, 390, 530]) {
    await page.setViewportSize({width,height:720});
    await page.locator('[data-menu="view"]').click();
    const item = page.getByRole("menuitem", {name:"Writing settings…"});
    await expect(item).toBeInViewport();
    await item.click();
    await expect(page.getByLabel("Text size", {exact:true})).toBeInViewport();
    await page.getByRole("button", {name:"Cancel",exact:true}).click();
    await page.locator('[data-menu="file"]').click();
    await expect(page.getByRole("menuitem", {name:"Today's note"})).toBeInViewport();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({width:390,height:320});
  await page.locator('[data-menu="view"]').click();
  const popup = page.locator("#menu-popup");
  expect(await popup.evaluate((el) => el.scrollHeight > el.clientHeight)).toBeTruthy();
  await page.getByRole("menuitem", {name:"Writing settings…"}).click();
  await expect(page.getByRole("dialog", {name:"Writing settings"})).toBeVisible();
});
