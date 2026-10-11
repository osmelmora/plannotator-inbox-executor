/** Recompute attribution hashes after a reviewed adaptation; never copies or edits upstream. */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const encodedAssetPattern = /\.(webp|png|jpg|svg)\.ts$/;

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(base, "app/vendor");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/refresh-ui-provenance.mjs --check\n       node scripts/refresh-ui-provenance.mjs --upstream /path/to/pinned-plannotator-checkout\nChecks fork hashes offline, or refreshes vendor/domain attribution against the exact recorded upstream commit."
  );
  process.exit(0);
}
if (
  !(
    (args.length === 1 && args[0] === "--check") ||
    (args.length === 2 && args[0] === "--upstream")
  )
) {
  throw new Error(
    "Pass --check or --upstream CHECKOUT. No implicit machine-local paths are used."
  );
}
const upstream = args[0] === "--upstream" ? path.resolve(args[1]) : null;
const manifestPath = path.join(vendor, "UPSTREAM.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (
  upstream &&
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: upstream,
    encoding: "utf8",
  }).trim() !== manifest.commit
) {
  throw new Error("Upstream checkout does not match the pinned fork commit.");
}
const previous = new Map(manifest.files.map((file) => [file.path, file]));
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)]
    );
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const domain = path.join(base, "app/domain");
const domainManifestPath = path.join(domain, "UPSTREAM.json");
const domainManifest = JSON.parse(fs.readFileSync(domainManifestPath, "utf8"));
if (domainManifest.commit !== manifest.commit) {
  throw new Error("Domain and UI upstream commits differ.");
}
if (!upstream) {
  for (const file of manifest.files) {
    if (
      hash(fs.readFileSync(path.join(vendor, file.path))) !== file.forkSha256
    ) {
      throw new Error(`Stale fork provenance: vendor/${file.path}`);
    }
  }
  for (const file of domainManifest.files) {
    if (
      hash(fs.readFileSync(path.join(domain, file.fork))) !== file.forkSha256
    ) {
      throw new Error(`Stale fork provenance: domain/${file.fork}`);
    }
  }
  const actual = walk(vendor)
    .filter((file) => file !== manifestPath)
    .map((file) => path.relative(vendor, file))
    .sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify(manifest.files.map((file) => file.path).sort())
  ) {
    throw new Error("Vendor file inventory differs from provenance.");
  }
  console.log(
    `Provenance checked: ${manifest.files.length} vendor files and ${domainManifest.files.length} domain files.`
  );
  process.exit(0);
}
manifest.files = walk(vendor)
  .filter((file) => file !== manifestPath)
  .map((file) => {
    const relative = path.relative(vendor, file);
    const old = previous.get(relative);
    const upstreamPath =
      old?.upstreamPath ??
      (relative.startsWith("build/") || relative.startsWith("LICENSE-")
        ? relative
        : `packages/${relative.replace(encodedAssetPattern, ".$1")}`);
    const original = execFileSync(
      "git",
      ["show", `${manifest.commit}:${upstreamPath}`],
      { cwd: upstream, maxBuffer: 32 * 1024 * 1024 }
    );
    return {
      ...old,
      path: relative,
      forkSha256: hash(fs.readFileSync(file)),
      upstreamPath,
      upstreamSha256: hash(original),
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of domainManifest.files) {
  const original = execFileSync(
    "git",
    ["show", `${manifest.commit}:${file.upstream}`],
    { cwd: upstream, maxBuffer: 32 * 1024 * 1024 }
  );
  file.upstreamSha256 = hash(original);
  file.forkSha256 = hash(fs.readFileSync(path.join(domain, file.fork)));
}
fs.writeFileSync(
  domainManifestPath,
  `${JSON.stringify(domainManifest, null, 2)}\n`
);
console.log(
  `Recorded ${manifest.files.length} vendor files and ${domainManifest.files.length} domain files against pinned commit ${manifest.commit}.`
);
