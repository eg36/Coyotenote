import { test, expect } from "@playwright/test";

let counter = 0;
async function seed(page, name, body = "") {
  const bootstrap = await (await page.request.get("/api/state")).json();
  const response = await page.request.post("/api/note", {
    headers: { "X-Coyote-Token": bootstrap.token },
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
    "rgb(255, 255, 255)",
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
  await search.fill("Coyote Dark");
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
    expect((await frame.boundingBox()).width).toBeCloseTo(width - (width <= 1200 ? 60 : 88), 0);
    await expect(page.locator("#source-pane")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.locator("#sidebar-toggle").click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.locator("#focus-button").click();
    await expect(page.locator("#sidebar")).toBeHidden();
    expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(width - 1);
    expect((await frame.boundingBox()).width).toBeCloseTo(width - (width <= 1200 ? 60 : 88), 0);
    await page.locator("#focus-button").click();
  }
  // Keep the correct column after switching from a collapsed desktop to mobile.
  await page.locator("#sidebar-toggle").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(389);
  expect((await frame.boundingBox()).width).toBeCloseTo(366, 0);
  await page.locator("#sidebar-toggle").click();
  await expect(page.getByLabel("Search notes")).toBeVisible();
  await page.locator("#sidebar-scrim").click();
  expect((await workspace.boundingBox()).width).toBeGreaterThanOrEqual(389);
  expect((await frame.boundingBox()).width).toBeCloseTo(366, 0);
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
}) => {
  const external = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4289"))
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
    headers: { "X-Coyote-Token": bootstrap.token },
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

test("autosave renews a stale token after a restart but never across vaults", async ({
  page,
}) => {
  const id = await openSeed(page, "Before restart.");
  let stale = 1;
  await page.route("**/api/note", (route) => {
    const request = route.request();
    if (request.method() !== "PUT" || stale-- <= 0) return route.continue();
    return route.continue({
      headers: { ...request.headers(), "x-coyote-token": "stale-token" },
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
