#!/usr/bin/env node
import { constants } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "./lib/config.mjs";
import { createInstaller } from "./lib/installer.mjs";
import { officialCli } from "./lib/process.mjs";
import { installationDirectory, withLock } from "./lib/state.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const usage = `Usage: node scripts/install.mjs <init|prepare|build|deploy|profiles|install|publication|status> --config inbox.config.json

init      Copy the example config without overwriting an existing file.
prepare   Discover the host framework, generate/reuse private identity, stage source.
build     Install locked dependencies, typecheck server/UI, build hosted assets.
deploy    Create/commit/deploy through the signed-in official CLI.
profiles  Provision each agent/reviewer credential and profile.
install   Run prepare, build, deploy, profiles; safe to resume with the same config.
publication  Save a publishable commit without grants, then restore the installation source.
status    Print safe deployment and profile receipts (never credentials).

Options:
  --allow-framework-change  Prepare against an untested host version after you inspect compatibility.
  --adopt-app APP_ID         Explicitly adopt an existing matching app during deploy/install.

First sign in: mise exec -- pnpm --package=executor@2.0.0-beta.14 dlx executor apps login --host https://api.executor.sh
Configuration becomes immutable after prepare. Preserve .runtime/installations/<name>/ privately.
`;
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep explicit argument validation and authorized stage dispatch in one CLI entry point.
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log(usage);
    return;
  }
  if (Number(process.versions.node.split(".")[0]) < 24) {
    throw new Error("Node.js 24 or later is required.");
  }
  const command = args.shift();
  if (
    ![
      "init",
      "prepare",
      "build",
      "deploy",
      "profiles",
      "install",
      "publication",
      "status",
    ].includes(command)
  ) {
    throw new Error("Unknown installer command. Use --help.");
  }
  let configFile,
    adoptApp,
    allowFrameworkChange = false;
  const value = (option) => {
    const result = args.shift();
    if (!result || result.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    return result;
  };
  while (args.length) {
    const option = args.shift();
    if (option === "--config" && !configFile) {
      configFile = value(option);
    } else if (option === "--adopt-app" && !adoptApp) {
      adoptApp = value(option);
    } else if (option === "--allow-framework-change" && !allowFrameworkChange) {
      allowFrameworkChange = true;
    } else {
      throw new Error(`Unsupported or repeated option ${option}.`);
    }
  }
  if (!configFile || configFile.startsWith("--")) {
    throw new Error("Pass --config with an explicit config file.");
  }
  if (adoptApp && !["deploy", "install"].includes(command)) {
    throw new Error("--adopt-app applies only to deploy/install.");
  }
  if (allowFrameworkChange && !["prepare", "install"].includes(command)) {
    throw new Error(
      "--allow-framework-change applies only to prepare/install."
    );
  }
  if (command === "init") {
    await copyFile(
      path.join(root, "config.example.json"),
      path.resolve(configFile),
      constants.COPYFILE_EXCL
    );
    console.log(
      `Created ${configFile}. Edit the target, projects, and principals before prepare.`
    );
    return;
  }
  const config = validateConfig(
    JSON.parse(await readFile(path.resolve(configFile), "utf8"))
  );
  const directory = await installationDirectory(root, config.installation);
  const installer = createInstaller({
    root,
    directory,
    config,
    cli: officialCli(config),
  });
  await withLock(directory, async () => {
    for (const step of command === "install"
      ? ["prepare", "build", "deploy", "profiles"]
      : [command]) {
      console.error(
        `${step}: ${config.installation} → ${config.organization} on ${config.host}`
      );
      console.log(
        JSON.stringify(
          await installer[step]({ adoptApp, allowFrameworkChange }),
          null,
          2
        )
      );
    }
  });
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
