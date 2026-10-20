import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  // tests/fixtures.js starts a separate server and vault for every test.
  fullyParallel: true,
  // CI runners have four cores; locally Playwright uses half the machine.
  workers: process.env.CI ? 4 : undefined,
  timeout: 30000,
  expect: { timeout: 8000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    viewport: { width: 1440, height: 1000 },
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        }
      : {},
  },
});
