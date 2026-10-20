import { build } from "esbuild";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  access,
  copyFile,
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
let patchedDiagramYAML = false;
const result = await build({
  entryPoints: ["web/src/app.ts"],
  // Replace Mermaid's prebundled older YAML parser with the patched package.
  plugins: [{
    name: "patched-diagram-yaml",
    setup(builder) {
      builder.onLoad({ filter: /mermaid[\\/]dist[\\/]chunks[\\/]mermaid\.core[\\/]chunk-LNGE3PJU\.mjs$/ }, () => {
        patchedDiagramYAML = true;
        return {
          contents: 'export { JSON_SCHEMA, load } from "js-yaml";',
          loader: "js", resolveDir: process.cwd(),
        };
      });
    },
  }],
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
if (!patchedDiagramYAML) throw new Error("The diagram YAML replacement must be updated before building.");
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.startsWith("node_modules/")) continue;
  let directory = path.dirname(input);
  while (directory.startsWith("node_modules")) {
    try {
      await access(path.join(directory, "package.json"));
      const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      if (!pkg.name) { directory = path.dirname(directory); continue; }
      packages.add(directory);
      break;
    } catch {}
    directory = path.dirname(directory);
  }
}
// Mermaid's published core also contains these two prebundled libraries.
packages.add("node_modules/fastdom");
packages.add("node_modules/js-yaml");
const licenses = [];
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const files = await readdir(directory);
  const filename = files.find((name) =>
    /^licen[sc]e(?:\.md|\.txt)?$/i.test(name),
  );
  if (!filename && pkg.name === "fastdom") {
    licenses.push(`${pkg.name} ${pkg.version}\n${"=".repeat(72)}\n${await readFile("docs/licenses/fastdom.txt", "utf8")}`);
    continue;
  }
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

// Keep KaTeX's CSS and fonts local; load the stylesheet only for math notes.
await writeFile("web/assets/katex.css", (await readFile("node_modules/katex/dist/katex.min.css", "utf8")).replaceAll("fonts/", "katex-"));
for (const name of await readdir("node_modules/katex/dist/fonts"))
  await copyFile(path.join("node_modules/katex/dist/fonts", name), path.join("web/assets", "katex-" + name));
await copyFile("docs/licenses/KaTeX-fonts.txt", "web/assets/KaTeX-fonts-LICENSE.txt");
