import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const binary = resolve(process.env.LABRADORITE_BINARY || join("bin", process.platform === "win32" ? "labradorite.exe" : "labradorite"));
const vault = mkdtempSync(join(tmpdir(), "labradorite-test-"));
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 8000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4289",
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
  webServer: {
    command: `"${binary}" -no-browser -listen 127.0.0.1:4289 -data-dir "${vault}"`,
    url: "http://127.0.0.1:4289/healthz",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
