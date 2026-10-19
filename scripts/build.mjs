import { build } from "esbuild";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  access,
} from "node:fs/promises";
import path from "node:path";
await mkdir("web/assets", { recursive: true });
for (const file of await readdir("web/assets"))
  if (
    file === "app.js" ||
    file.startsWith("chunk-") ||
    file.endsWith(".LEGAL.txt")
  )
    await rm(path.join("web/assets", file));
const result = await build({
  entryPoints: ["web/src/app.js"],
  bundle: true,
  splitting: true,
  format: "esm",
  target: ["chrome110", "firefox115", "safari16.4"],
  outdir: "web/assets",
  entryNames: "app",
  chunkNames: "chunk-[hash]",
  minify: true,
  legalComments: "linked",
  metafile: true,
});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.startsWith("node_modules/")) continue;
  let directory = path.dirname(input);
  while (directory.startsWith("node_modules")) {
    try {
      await access(path.join(directory, "package.json"));
      packages.add(directory);
      break;
    } catch {}
    directory = path.dirname(directory);
  }
}
const licenses = [];
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const files = await readdir(directory);
  const filename = files.find((name) =>
    /^licen[sc]e(?:\.md|\.txt)?$/i.test(name),
  );
  if (!filename)
    throw new Error("Missing license for bundled package " + pkg.name);
  const license = await readFile(path.join(directory, filename), "utf8");
  licenses.push(
    `${pkg.name} ${pkg.version}\n${"=".repeat(72)}\n${license.trim()}\n`,
  );
}
await writeFile("web/assets/THIRD_PARTY_LICENSES.txt", licenses.join("\n\n"));
console.log(
  `Embedded browser assets built; ${licenses.length} bundled package licenses included.`,
);
