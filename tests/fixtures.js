import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const binary = resolve(process.env.LABRADORITE_BINARY || join("bin", process.platform === "win32" ? "labradorite.exe" : "labradorite"));

// Each test gets its own server on an empty vault and a free port, so tests
// run in parallel and never see each other's notes or settings.
export const test = base.extend({
  baseURL: async ({}, use) => {
    const vault = mkdtempSync(join(tmpdir(), "labradorite-test-"));
    const server = spawn(binary, ["-no-browser", "-listen", "127.0.0.1:0", "-data-dir", vault], { stdio: ["ignore", "pipe", "inherit"] });
    const exited = new Promise((done) => server.once("exit", done));
    const address = await new Promise((done, fail) => {
      server.once("error", fail);
      exited.then((code) => fail(new Error(`labradorite exited with ${code} before listening`)));
      createInterface({ input: server.stdout }).on("line", (line) => {
        if (line.startsWith("Open http://")) done(line.slice("Open ".length));
      });
    });
    try {
      await use(address);
    } finally {
      server.kill();
      await exited;
      rmSync(vault, { recursive: true, force: true, maxRetries: 5 });
    }
  },
});
export { expect };
