import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { scanPublication } from "../scripts/check-publication.mjs";

async function repository(run) {
  const root = await mkdtemp(path.join(tmpdir(), "inbox-publication-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("checks untracked source while leaving ignored private state unopened", () =>
  repository(async (root) => {
    await writeFile(path.join(root, ".gitignore"), ".private/\n");
    await mkdir(path.join(root, ".private"));
    await writeFile(
      path.join(root, ".private", "credentials.json"),
      "private test material",
      { mode: 0 }
    );
    await writeFile(path.join(root, "README.md"), "# Portable source\n");
    const clean = await scanPublication(root);
    assert.deepEqual(clean.findings, []);
    assert.equal(clean.files, 2);
    await writeFile(
      path.join(root, "leak.txt"),
      ["ghp", "_", "a".repeat(36)].join("")
    );
    assert.deepEqual((await scanPublication(root)).findings, [
      { file: "leak.txt", category: "github-token" },
    ]);
  }));

test("rejects tracked ignored credentials by filename without reading content", () =>
  repository(async (root) => {
    await mkdir(path.join(root, ".runtime"));
    await writeFile(
      path.join(root, ".runtime", "credentials.json"),
      "synthetic"
    );
    execFileSync("git", ["add", ".runtime/credentials.json"], { cwd: root });
    await writeFile(path.join(root, ".gitignore"), ".runtime/\n");
    assert.deepEqual((await scanPublication(root)).findings, [
      {
        file: ".runtime/credentials.json",
        category: "private-or-generated-path",
      },
    ]);
  }));

test("reports categories without returning matched credential or personal values", () =>
  repository(async (root) => {
    const value = [
      "eyJ",
      "A".repeat(16),
      ".",
      "eyJ",
      "B".repeat(16),
      ".",
      "C".repeat(24),
    ].join("");
    await writeFile(
      path.join(root, "example.json"),
      JSON.stringify({ access_token: value })
    );
    const report = await scanPublication(root);
    assert.deepEqual(
      report.findings.map((item) => item.category),
      ["jwt-token", "oauth-token-value"]
    );
    assert.ok(!JSON.stringify(report).includes(value));
  }));

test("does not let a clean worktree hide credentials already staged for publication", () =>
  repository(async (root) => {
    await writeFile(
      path.join(root, "config.json"),
      JSON.stringify({ refresh_token: "s".repeat(48) })
    );
    execFileSync("git", ["add", "config.json"], { cwd: root });
    await writeFile(path.join(root, "config.json"), "{}\n");
    assert.deepEqual((await scanPublication(root)).findings, [
      { file: "config.json", category: "oauth-token-value" },
    ]);
  }));

test("flags a literal app credential but permits clearly synthetic fixtures", () =>
  repository(async (root) => {
    await writeFile(
      path.join(root, "fixture.ts"),
      `export const token = 'test-only-${"t".repeat(32)}';\n`
    );
    assert.deepEqual((await scanPublication(root)).findings, []);
    await writeFile(
      path.join(root, "config.ts"),
      `export const token = '${"s".repeat(48)}';\n`
    );
    assert.deepEqual((await scanPublication(root)).findings, [
      { file: "config.ts", category: "literal-credential-value" },
    ]);
  }));

test("rejects an operator config even if force-staged under its usual private filename", () =>
  repository(async (root) => {
    await writeFile(path.join(root, "inbox.config.json"), "{}\n");
    execFileSync("git", ["add", "inbox.config.json"], { cwd: root });
    await writeFile(path.join(root, ".gitignore"), "inbox.config.json\n");
    assert.deepEqual((await scanPublication(root)).findings, [
      { file: "inbox.config.json", category: "private-or-generated-path" },
    ]);
  }));

test("allows the public config template and rejects destination config under another filename", () =>
  repository(async (root) => {
    const template = {
      installation: "my-inbox",
      host: "https://api.executor.sh",
      organization: "YOUR_ORGANIZATION_ID",
      projects: [],
      principals: [],
    };
    await writeFile(
      path.join(root, "config.example.json"),
      JSON.stringify(template)
    );
    assert.deepEqual((await scanPublication(root)).findings, []);
    await writeFile(
      path.join(root, "destination.json"),
      JSON.stringify({ ...template, organization: "fixture-organization" })
    );
    assert.deepEqual((await scanPublication(root)).findings, [
      { file: "destination.json", category: "installation-config-state" },
    ]);
    await writeFile(
      path.join(root, "destination.json"),
      JSON.stringify({ ...template, host: "https://fixture.invalid" })
    );
    assert.deepEqual((await scanPublication(root)).findings, [
      { file: "destination.json", category: "installation-config-state" },
    ]);
  }));
