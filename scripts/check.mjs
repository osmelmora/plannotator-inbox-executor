/** Offline publication and build-boundary checks; no live Executor calls. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const args of [
  ["scripts/check-publication.mjs"],
  ["scripts/refresh-ui-provenance.mjs", "--check"],
  ["scripts/check-browser.mjs"],
  ["scripts/check-diff-renderer.mjs"],
]) {
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}

const publicFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" }
)
  .split("\0")
  .filter(Boolean);
for (const file of new Set(publicFiles)) {
  if (
    !file.endsWith(".md") ||
    file.startsWith("app/vendor/") ||
    file.startsWith("app/domain/")
  ) {
    continue;
  }
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    continue;
  }
  const text = fs.readFileSync(absolute, "utf8");
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const [, target] = match;
    if (/^(?:[a-z][a-z0-9+.-]*:|#|<)/i.test(target)) {
      continue;
    }
    const relative = decodeURIComponent(target.split("#")[0]);
    if (
      relative &&
      !fs.existsSync(path.resolve(path.dirname(absolute), relative))
    ) {
      throw new Error(`Broken documentation link in ${file}: ${target}`);
    }
  }
}
console.log("Public documentation links checked.");
