#!/usr/bin/env node
import { copyFile, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateConfig } from './lib/config.mjs';
import { installationDirectory, withLock } from './lib/state.mjs';
import { officialCli } from './lib/process.mjs';
import { createInstaller } from './lib/installer.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const usage = `Usage: node scripts/install.mjs <init|prepare|build|deploy|profiles|install|status> --config inbox.config.json

init      Copy the example config without overwriting an existing file.
prepare   Discover the host framework, generate/reuse private identity, stage source.
build     Install locked dependencies, typecheck server/UI, build hosted assets.
deploy    Create/commit/deploy through the signed-in official CLI.
profiles  Provision each agent/reviewer credential and profile.
install   Run prepare, build, deploy, profiles; safe to resume with the same config.
status    Print safe deployment and profile receipts (never credentials).

Options:
  --allow-framework-change  Prepare against an untested host version after you inspect compatibility.
  --adopt-app APP_ID         Explicitly adopt an existing matching app during deploy/install.

First sign in: npm exec --yes --package=executor@2.0.0-beta.14 -- executor apps login --host https://api.executor.sh
Configuration becomes immutable after prepare. Preserve .runtime/installations/<name>/ privately.
`;
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) { console.log(usage); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Node.js 24 or later is required.');
  const command = args.shift();
  if (!['init', 'prepare', 'build', 'deploy', 'profiles', 'install', 'status'].includes(command)) throw Error('Unknown installer command. Use --help.');
  let configFile, adoptApp, allowFrameworkChange = false;
  const value = option => { const result = args.shift(); if (!result || result.startsWith('--')) throw Error(`${option} requires a value.`); return result; };
  while (args.length) {
    const option = args.shift();
    if (option === '--config' && !configFile) configFile = value(option);
    else if (option === '--adopt-app' && !adoptApp) adoptApp = value(option);
    else if (option === '--allow-framework-change' && !allowFrameworkChange) allowFrameworkChange = true;
    else throw Error(`Unsupported or repeated option ${option}.`);
  }
  if (!configFile || configFile.startsWith('--')) throw Error('Pass --config with an explicit config file.');
  if (adoptApp && !['deploy', 'install'].includes(command)) throw Error('--adopt-app applies only to deploy/install.');
  if (allowFrameworkChange && !['prepare', 'install'].includes(command)) throw Error('--allow-framework-change applies only to prepare/install.');
  if (command === 'init') {
    await copyFile(path.join(root, 'config.example.json'), path.resolve(configFile), constants.COPYFILE_EXCL);
    console.log(`Created ${configFile}. Edit the target, projects, and principals before prepare.`);
    return;
  }
  const config = validateConfig(JSON.parse(await readFile(path.resolve(configFile), 'utf8')));
  const directory = await installationDirectory(root, config.installation);
  const installer = createInstaller({ root, directory, config, cli: officialCli(config) });
  await withLock(directory, async () => {
    for (const step of command === 'install' ? ['prepare', 'build', 'deploy', 'profiles'] : [command]) {
      console.error(`${step}: ${config.installation} → ${config.organization} on ${config.host}`);
      console.log(JSON.stringify(await installer[step]({ adoptApp, allowFrameworkChange }), null, 2));
    }
  });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
