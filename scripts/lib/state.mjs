import { mkdir, readFile, writeFile, rename, lstat, open, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { configDigest, credentialHash } from './config.mjs';

export async function readJson(file, optional = false) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Refusing non-regular state file: ${path.basename(file)}`);
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
export async function writeJson(file, value) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}
export async function installationDirectory(root, name) {
  let directory = root;
  for (const component of ['.runtime', 'installations', name]) {
    directory = path.join(directory, component);
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Installation state must use real directories, never symlinks.');
    await chmod(directory, 0o700);
  }
  return directory;
}
export async function withLock(directory, action) {
  const file = path.join(directory, 'operation.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw Error('Another installer may be running. If it stopped, inspect and remove operation.lock before retrying.'); throw error; }
  await handle.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }) + '\n');
  try { return await action(); }
  finally { await handle.close(); const { unlink } = await import('node:fs/promises'); await unlink(file); }
}
export async function loadIdentity(directory, config, { create = false } = {}) {
  const stateFile = path.join(directory, 'installation.json');
  const credentialsFile = path.join(directory, 'credentials.json');
  const state = await readJson(stateFile, true);
  const credentials = await readJson(credentialsFile, true);
  const digest = configDigest(config);
  if (state && (state.configDigest !== digest || state.host !== config.host || state.organization !== config.organization || state.slug !== config.app.slug))
    throw Error('Installation target or configuration changed. Restore its original config; automatic identity/grant migration is not supported.');
  if (state && !credentials) throw Error('Credentials are missing for this installation. Restore the private backup; refusing to rotate identities silently.');
  if (!state && credentials) throw Error('Credentials exist without their installation receipt. Restore the receipt; refusing to adopt unidentified secrets.');
  if (!state) {
    for (const name of ['app.json', 'deployment.json', 'profiles.json', 'prepared.json', 'build.json'])
      if (await readJson(path.join(directory, name), true)) throw Error('Receipts exist without their installation identity; restore the private backup.');
    if (!create) throw Error('Run prepare first.');
    const secrets = { principals: config.principals.map(principal => ({ id: principal.id, token: randomBytes(32).toString('hex') })) };
    const fresh = { version: 1, configDigest: digest, host: config.host, organization: config.organization, slug: config.app.slug, createdAt: new Date().toISOString(),
      credentialHashes: Object.fromEntries(secrets.principals.map(principal => [principal.id, credentialHash(principal.token)])) };
    // Write the non-secret guard first: interruption cannot silently generate new
    // credentials on a later retry. Before any deployment, recovery is manual.
    await writeJson(stateFile, fresh);
    await writeJson(credentialsFile, secrets);
    return { state: fresh, credentials: secrets };
  }
  if (!credentials || !Array.isArray(credentials.principals) || credentials.principals.length !== config.principals.length ||
      new Set(credentials.principals.map(principal => principal.id)).size !== config.principals.length ||
      credentials.principals.some(principal => !config.principals.some(p => p.id === principal.id) || !/^[a-f0-9]{64}$/.test(principal.token)))
    throw Error('Stored credential structure does not match this installation.');
  if (credentials.principals.some(principal => state.credentialHashes?.[principal.id] !== credentialHash(principal.token)))
    throw Error('Stored credentials changed. Restore the private backup; explicit credential rotation is not implemented.');
  await chmod(credentialsFile, 0o600);
  return { state, credentials };
}
