/** Check the exact tracked + non-ignored source candidate set; never print matched values. */
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const forbiddenPath =
  /(?:^|\/)(?:\.runtime|\.private|\.local|\.upstream|node_modules|\.git|coverage|playwright-report|test-results)(?:\/|$)|(?:^|\/)(?:credentials|scoped-oauth|oauth-state|cookies|storage-state)\.json$|(?:^|\/)\.env(?:\.(?!example$)[^/]+)?$|\.(?:pem|key|p12|pfx|sqlite(?:-[^/]+)?|db(?:-[^/]+)?)$/i;
const operatorConfigPath =
  /(?:^|\/)(?:inbox\.config(?:\.[^/]+)?|inbox\.[^/]+\.config|config\.local|[^/]+\.config\.local)\.json$/i;
const isPrivatePath = (name) =>
  forbiddenPath.test(name) || operatorConfigPath.test(name);
const rules = [
  ["private-key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  [
    "github-token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  ],
  [
    "jwt-token",
    /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/,
  ],
  [
    "oauth-token-value",
    /["'](?:access_token|refresh_token|client_secret|id_token)["']\s*:\s*["'](?!test[-_]|fixture[-_]|example[-_]|<)[A-Za-z0-9._~+/-]{20,}["']/,
  ],
  [
    "literal-credential-value",
    /\b(?:token|secret|password|apiKey|api_key)["']?\s*[:=]\s*["'](?!test[-_]|fixture[-_]|example[-_]|demo[-_]|<)[A-Za-z0-9._~+/=-]{24,}["']/,
  ],
  [
    "literal-bearer-token",
    /["'`]Bearer (?!test[-_]|fixture[-_]|example[-_]|<)[A-Za-z0-9._~+/-]{24,}["'`]/,
  ],
  [
    "personal-home-path",
    /\/(?:Users|home)\/(?!<|USER(?:\/|\b)|example(?:\/|\b))[a-zA-Z][a-zA-Z0-9_.-]*\//,
  ],
  [
    "executor-deployment-identifier",
    /\b(?:app|ins|acc|dpl)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  ],
  ["private-executor-app-url", /https?:\/\/[a-z0-9.-]+\.executor\.website\b/i],
  [
    "personal-deployment-reference",
    /\bosmel(?:-|\/|\.|@)|native-inbox-cloud-native-[ab]-v1/i,
  ],
];

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Audit each publication source and index boundary together without reading excluded private files.
export async function scanPublication(root) {
  const files = [
    ...new Set(
      execFileSync(
        "git",
        ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        }
      )
        .split("\0")
        .filter(Boolean)
    ),
  ].sort();
  const findings = [];
  const binaryFiles = new Set();
  const checkContent = (name, bytes) => {
    if (bytes.includes(0)) {
      binaryFiles.add(name);
      return;
    }
    const content = bytes.toString("utf8");
    if (name.endsWith(".json")) {
      let config;
      try {
        config = JSON.parse(content);
      } catch {
        /* Not an installation config. */
      }
      if (
        config?.installation &&
        typeof config.host === "string" &&
        typeof config.organization === "string" &&
        Array.isArray(config.projects) &&
        Array.isArray(config.principals) &&
        (config.organization !== "YOUR_ORGANIZATION_ID" ||
          config.host !== "https://api.executor.sh") &&
        !findings.some(
          (item) =>
            item.file === name && item.category === "installation-config-state"
        )
      ) {
        findings.push({ file: name, category: "installation-config-state" });
      }
    }
    for (const [category, pattern] of rules) {
      if (
        pattern.test(content) &&
        !findings.some(
          (item) => item.file === name && item.category === category
        )
      ) {
        findings.push({ file: name, category });
      }
    }
  };
  for (const name of files) {
    if (isPrivatePath(name)) {
      findings.push({ file: name, category: "private-or-generated-path" });
      continue; // In particular, do not open private files even if accidentally tracked.
    }
    const absolute = path.resolve(root, name);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
      findings.push({ file: name, category: "path-outside-repository" });
      continue;
    }
    let stat;
    try {
      stat = await lstat(absolute);
    } catch (error) {
      if (error.code === "ENOENT") {
        continue; // Tracked deletion is safe to publish.
      }
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      findings.push({ file: name, category: "non-regular-source-file" });
      continue;
    }
    checkContent(name, await readFile(absolute));
  }
  // A clean working-tree edit must not hide an older secret still staged for commit.
  // Skip forbidden paths before asking Git for their contents, just as above.
  const staged = execFileSync("git", ["ls-files", "--stage", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("\t");
      const [mode, object, stage] = entry.slice(0, separator).split(" ");
      return { mode, object, stage, name: entry.slice(separator + 1) };
    })
    .filter((entry) => !isPrivatePath(entry.name));
  for (const entry of staged) {
    if (!["100644", "100755"].includes(entry.mode) || entry.stage !== "0") {
      findings.push({
        file: entry.name,
        category: "non-regular-or-unmerged-index-entry",
      });
    }
  }
  const readable = staged.filter(
    (entry) => ["100644", "100755"].includes(entry.mode) && entry.stage === "0"
  );
  if (readable.length) {
    const objects = execFileSync("git", ["cat-file", "--batch"], {
      cwd: root,
      input: `${readable.map((entry) => entry.object).join("\n")}\n`,
      maxBuffer: 128 * 1024 * 1024,
    });
    let offset = 0;
    for (const entry of readable) {
      const newline = objects.indexOf(10, offset);
      const [, type, size] = objects
        .subarray(offset, newline)
        .toString("ascii")
        .split(" ");
      const length = Number(size);
      if (type !== "blob" || !Number.isSafeInteger(length) || length < 0) {
        throw new Error("Invalid Git object response.");
      }
      offset = newline + 1;
      checkContent(entry.name, objects.subarray(offset, offset + length));
      offset += length + 1;
    }
  }
  return { files: files.length, binaryFiles: binaryFiles.size, findings };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await scanPublication(root);
  for (const finding of result.findings) {
    console.error(`${finding.file}: ${finding.category}`);
  }
  if (result.findings.length) {
    console.error(
      `Publication check failed: ${result.findings.length} finding(s). Matched values are intentionally omitted.`
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Publication check passed: ${result.files} source candidates; ${result.binaryFiles} binary assets require ordinary human review.`
    );
    console.log(
      "This focused source check is not a full secret scanner or a Git history audit."
    );
  }
}
