import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { load } from "js-yaml";

const workflow = load(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
const gate = workflow.jobs.gate.steps.find(step => step.name === "Require a commit on main and release notes").run;
const publish = workflow.jobs.release.steps.find(step => step.name === "Publish release").run;

// Execute the workflow's actual shell steps in a disposable repository fixture.
// Git ancestry and GitHub publishing are stubbed; no tag or release is created.
function runStep(script, tag, { notes = true, sha = "on-main", releaseExists = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "labradorite-release-policy-"));
  try {
    const bin = join(root, "bin"), probe = join(root, "git-called"), calls = join(root, "gh-calls");
    mkdirSync(bin);
    mkdirSync(join(root, ".github/release-notes"), { recursive: true });
    mkdirSync(join(root, "dist"));
    if (notes) for (const version of ["v0.0.0", "v1.5.0", "v2.0.0", "v10.24.300"])
      writeFileSync(join(root, ".github/release-notes", version + ".md"), "Release notes.\n");
    writeFileSync(join(root, "dist/labradorite_fixture.tar.gz"), "Archive fixture.\n");
    writeFileSync(join(bin, "git"), `#!/bin/sh
printf '%s\n' "$*" > "$GIT_PROBE"
[ "$*" = 'merge-base --is-ancestor on-main origin/main' ]
`, { mode: 0o700 });
    writeFileSync(join(bin, "gh"), `#!/bin/sh
printf '%s\n' "$*" >> "$GH_CALLS"
if [ "$1 $2" = 'release view' ]; then [ "$RELEASE_EXISTS" = 'true' ]; exit $?; fi
if [ "$1 $2" = 'release create' ]; then exit 0; fi
exit 2
`, { mode: 0o700 });
    const result = spawnSync("bash", ["-c", script], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GITHUB_REF_NAME: tag,
        GITHUB_SHA: sha, GIT_PROBE: probe, GH_CALLS: calls, RELEASE_EXISTS: String(releaseExists) },
    });
    assert.ifError(result.error);
    return { ...result, ancestorChecked: existsSync(probe),
      calls: existsSync(calls) ? readFileSync(calls, "utf8") : "",
      injectedFile: existsSync(join(root, "INJECTED")) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("only numeric stable tags trigger public releases", () => {
  const patterns = workflow.on.push.tags;
  // This documented GitHub pattern subset has [] ranges, + repetition and
  // literal dots. Verify the filter as well as the stricter gate below.
  assert.deepEqual(patterns, ["v[0-9]+.[0-9]+.[0-9]+"]);
  const matches = new RegExp("^" + patterns[0].replaceAll(".", "\\.") + "$");
  for (const tag of ["v0.0.0", "v1.5.0", "v2.0.0", "v10.24.300"]) assert.match(tag, matches);
  for (const tag of ["v1.6.0-beta.1", "v2.0.0-alpha.1", "v2.0.0-rc.1", "v2.0.0+build.1", "vnext", "v2.0", "v2.0.0/other"])
    assert.doesNotMatch(tag, matches);
});

test("the actual gate accepts stable versions with ancestry and notes", () => {
  for (const tag of ["v0.0.0", "v1.5.0", "v2.0.0", "v10.24.300"]) {
    const result = runStep(gate, tag);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.ancestorChecked, true);
  }
});

test("prerelease, malformed and unsafe tags fail before ancestry or publication", () => {
  for (const tag of ["", "1.5.0", "v1.6.0-beta.1", "v2.0.0-alpha.1", "v2.0.0-rc.1", "v2.0.0+build.1",
    "v01.5.0", "v1.05.0", "v1.5.00", "v1.5", "v1.5.0.1", "v1x5x0", "vnext", "v1.5.0/other",
    "v1.5.0\n", "v1.5.0; touch INJECTED", "v1.5.0$(touch INJECTED)"]) {
    const result = runStep(gate, tag);
    assert.notEqual(result.status, 0, tag);
    assert.match(result.stdout, /Only stable vMAJOR.MINOR.PATCH/, tag);
    assert.equal(result.ancestorChecked, false, tag);
    assert.equal(result.calls, "", tag);
    assert.equal(result.injectedFile, false, tag);
  }
});

test("stable tags still require main ancestry and matching release notes", () => {
  const offMain = runStep(gate, "v1.5.0", { sha: "off-main" });
  assert.notEqual(offMain.status, 0);
  assert.match(offMain.stdout, /is not on main/);
  const noNotes = runStep(gate, "v1.5.0", { notes: false });
  assert.notEqual(noNotes.status, 0);
  assert.match(noNotes.stdout, /Missing .github\/release-notes\/v1.5.0.md/);
});

test("publishing depends on the gate and CI, with write access only for publishing", () => {
  assert.equal(workflow.jobs.checks.needs, "gate");
  assert.equal(workflow.jobs.checks.uses, "./.github/workflows/ci.yml");
  assert.equal(workflow.jobs.release.needs, "checks");
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.release.permissions.contents, "write");
});

test("stable publication verifies the tag and explicitly marks the release latest", () => {
  const result = runStep(publish, "v2.0.0");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.calls, /release create v2\.0\.0 --verify-tag --latest /);
  assert.doesNotMatch(result.calls, /--prerelease/);
});

test("a published release is still never overwritten", () => {
  const result = runStep(publish, "v1.5.0", { releaseExists: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /already published/);
  assert.doesNotMatch(result.calls, /release create/);
});
