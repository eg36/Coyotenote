import { test, expect } from "./fixtures.js";

async function openNote(page, body, id = "Document actions") {
  const { token } = await (await page.request.get("/api/state")).json();
  const response = await page.request.post("/api/note", { headers: { "X-Labradorite-Token": token }, data: { id, body } });
  expect(response.ok()).toBe(true);
  await page.goto("/?note=" + encodeURIComponent(id));
  await expect(page.locator("#document-title")).toHaveText(id.split("/").pop());
  await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-expanded", /true|false/);
  await expect(page.locator(".tiptap")).toBeVisible();
  return id;
}
const tool = (page, name) => page.locator("#format-panel").getByRole("button", { name, exact: true });
const bodyOf = async (page, id) => (await (await page.request.get("/api/note?id=" + encodeURIComponent(id))).json()).body;
async function rejectSaves(page) {
  await page.context().addInitScript(() => {
    const original = window.fetch;
    window.fetch = (url, options) => localStorage.getItem("test-document-save-failure") && options?.method === "PUT" && new URL(url, location.href).pathname === "/api/note"
      ? Promise.reject(new TypeError("Failed to fetch")) : original(url, options);
  });
  await page.evaluate(() => {
    localStorage.setItem("test-document-save-failure", "true");
    const original = window.fetch;
    window.fetch = (url, options) => localStorage.getItem("test-document-save-failure") && options?.method === "PUT" && new URL(url, location.href).pathname === "/api/note"
      ? Promise.reject(new TypeError("Failed to fetch")) : original(url, options);
  });
}

test("Format attaches a PDF at the caret and preserves its note context", async ({ page }) => {
  const original = "Before _exact_.\n\nAttach here.\n\nAfter **exact**.", id = await openNote(page, original);
  await page.locator(".tiptap").evaluate(dom => {
    const text = dom.querySelectorAll("p")[1].firstChild;
    dom.editor.commands.setTextSelection(dom.editor.view.posAtDOM(text, text.textContent.length));
    dom.editor.view.focus();
  });
  const choosing = page.waitForEvent("filechooser");
  await tool(page, "Attach PDF, audio or video").click();
  const chooser = await choosing;
  const pdf = Buffer.from("%PDF-1.4\n% sidebar attachment\n");
  await chooser.setFiles({ name: "Sidebar.pdf", mimeType: "application/pdf", buffer: pdf });
  const expected = "Before _exact_.\n\nAttach here.![[attachments/Sidebar.pdf]]\n\nAfter **exact**.";
  await expect.poll(() => bodyOf(page, id)).toBe(expected);
  const { files } = await (await page.request.get("/api/library")).json();
  expect(files.find(file => file.path === "attachments/Sidebar.pdf")?.size).toBe(pdf.length);
  await expect(page.locator("#document-title")).toHaveText(id);
});

test("Format Properties preserves existing fields, raw YAML and empty front matter on repeated use", async ({ page }) => {
  for (const [index, body, field] of [
    [0, '---\n# Keep comment\ntitle: "Original"\ntags: [one, two]\n---\n\nBody _exact_.\n', "title"],
    [1, '---\nnested:\n  key: value\n---\n\nBody _exact_.\n', null],
    [2, '---\n---\n\nBody _exact_.\n', null],
    [3, '---\ndone: true\ncount: 2\n---\n\nBody _exact_.\n', "done"],
  ]) {
    const id = await openNote(page, body, "Properties " + index);
    for (let count = 0; count < 2; count++) {
      await tool(page, "Open properties").click();
      await expect(field ? page.locator("#properties").getByRole(field === "done" ? "checkbox" : "textbox", { name: field, exact: true }) : page.locator("#properties-text")).toBeFocused();
      expect(await bodyOf(page, id)).toBe(body);
    }
    if (index === 0) {
      await page.locator("#properties").getByRole("button", { name: "Edit YAML", exact: true }).click();
      await tool(page, "Open properties").click();
      await expect(page.locator("#properties-text")).toBeFocused();
      expect(await bodyOf(page, id)).toBe(body);
    }
  }
  const id = await openNote(page, "No properties yet.", "New properties");
  await tool(page, "Open properties").click();
  await expect(page.locator("#properties").getByRole("textbox", { name: "tags", exact: true })).toBeFocused();
  const initialized = "---\ntags: \n---\n\nNo properties yet.";
  await expect.poll(() => bodyOf(page, id)).toBe(initialized);
  await tool(page, "Open properties").click();
  expect(await bodyOf(page, id)).toBe(initialized);
});

test("Format Save now retries failed edits and clears the error", async ({ page }) => {
  const id = await openNote(page, "Saved.");
  await rejectSaves(page);
  await page.locator(".tiptap").evaluate(dom => {
    dom.editor.commands.setTextSelection(dom.editor.state.doc.content.size - 1);
    dom.editor.view.focus();
  });
  await page.keyboard.type(" Changed.");
  await expect(page.locator("#error-banner")).toBeVisible();
  expect(await bodyOf(page, id)).toBe("Saved.");
  await page.evaluate(() => localStorage.removeItem("test-document-save-failure"));
  await tool(page, "Save now").click();
  await expect.poll(() => bodyOf(page, id)).toBe("Saved. Changed.");
  await expect(page.locator("#error-banner")).toBeHidden();
});

test("Format document actions stay disabled while a recovered draft awaits a decision", async ({ page }) => {
  const id = await openNote(page, "Saved.");
  await rejectSaves(page);
  await page.locator(".tiptap").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Draft.");
  await expect(page.locator("#error-banner")).toBeVisible();
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  for (const name of ["Attach PDF, audio or video", "Save now", "Open properties"])
    await expect(tool(page, name)).toBeDisabled();
  expect(await bodyOf(page, id)).toBe("Saved.");
  await expect(page.locator("#properties")).toBeHidden();
});
