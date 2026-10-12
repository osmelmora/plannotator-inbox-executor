import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudApi } from "./cloud-api.mjs";
import { configDigest, credentialHash } from "./config.mjs";
import { run } from "./process.mjs";
import { loadIdentity, readJson, writeJson } from "./state.mjs";

const sensitiveFilePattern = /(?:credentials|secrets)(?:\.|$)/i;
const appIdPattern = /^app_[a-zA-Z0-9-]+$/;
const frameworkVersionPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
// Executor reads these by path, not through an import, and the license files
// travel with every copy. Other staged files are build inputs, such as the
// vendored UI source compiled into ui/public.
const hostFilePattern =
  /^(?:LICENSE|NOTICE|package\.json|ui\/index\.html|ui\/public\/.+|migrations\/.+|skills\/.+|(?:domain|vendor)\/(?:LICENSE-[A-Z]+|UPSTREAM\.json|README\.md))$/;

const excluded = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  ".runtime",
  ".private",
  ".env",
]);
export async function collectSource(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) {
      continue;
    }
    if (
      entry.name.startsWith(".env") ||
      sensitiveFilePattern.test(entry.name)
    ) {
      throw new Error(
        `Refusing sensitive-looking source file ${prefix}${entry.name}.`
      );
    }
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      files.push(
        ...(await collectSource(
          path.join(directory, entry.name),
          `${relative}/`
        ))
      );
    } else if (entry.isFile()) {
      const bytes = await readFile(path.join(directory, entry.name));
      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        // biome-ignore lint/style/useErrorCause: Keep upload validation errors independent of the source bytes being rejected.
        throw new Error(
          `Non-UTF-8 source cannot be uploaded as text: ${relative}`
        );
      }
      files.push({ path: relative, content });
    } else {
      throw new Error(`Refusing symlink or non-file source ${relative}.`);
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function sourceDigest(files) {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}
function requireBareName(files) {
  const manifest = files.find((file) => file.path === "package.json");
  if (JSON.parse(manifest.content).name.startsWith("@")) {
    throw new Error(
      "The installation package.json must keep a bare name, so Executor refuses to publish commits that carry grants."
    );
  }
}
function sameSource(left, right) {
  const contents = new Map(right.map((file) => [file.path, file.content]));
  return (
    left.length === right.length &&
    left.every((file) => contents.get(file.path) === file.content)
  );
}
export function uploadSource(files, runtime) {
  const imported = new Set(runtime);
  return files.filter(
    (file) => imported.has(file.path) || hostFilePattern.test(file.path)
  );
}
/** Profile names are capped at 128 UTF-16 code units by the pinned host.
 * Account labels have no smaller declared bound; share the same display label.
 * Keep the complete stable principal suffix, shortening only the app's name. */
export function principalDisplayLabel(appName, principalId) {
  const suffix = ` · ${principalId}`;
  const available = 128 - suffix.length;
  if (available < 1) {
    throw new Error("Principal ID leaves no room for its display label.");
  }
  let prefix = "";
  for (const character of appName) {
    if (prefix.length + character.length > available) {
      break;
    }
    prefix += character;
  }
  return prefix.trimEnd() + suffix;
}
function checkApp(app, config, organization) {
  if (
    !(app && appIdPattern.test(app.id)) ||
    app.slug !== config.app.slug ||
    app.owner !== `organization:${organization}`
  ) {
    throw new Error(
      "Executor returned an app outside the selected organization or slug."
    );
  }
}
export function createInstaller({
  root,
  directory,
  config,
  cli,
  runner = run,
  apiFactory = cloudApi,
}) {
  const stage = path.join(directory, "staging");
  const appDirectory = path.join(stage, "app");
  const receipt = (name) => path.join(directory, `${name}.json`);
  const sourceFile = path.join(directory, "source.json");
  async function identity(options) {
    return await loadIdentity(directory, config, options);
  }
  async function readSource(appId) {
    const source = await cli(["source", "--app", appId]);
    if (
      typeof source.revision?.commit !== "string" ||
      !source.revision.commit
    ) {
      throw new Error("Host returned no source commit.");
    }
    return source;
  }
  async function commitSource(appId, files, expected, message) {
    await writeJson(sourceFile, files);
    const saved = await cli([
      "commit",
      "--app",
      appId,
      "--files",
      sourceFile,
      "--expected",
      expected,
      "--message",
      message,
    ]);
    const commit = saved.revision?.commit;
    if (typeof commit !== "string" || !commit) {
      throw new Error("Host returned no saved commit.");
    }
    return commit;
  }
  async function framework() {
    const release = await cli(["framework"]);
    if (
      typeof release.version !== "string" ||
      !frameworkVersionPattern.test(release.version)
    ) {
      throw new Error("Host did not report an exact framework version.");
    }
    return release.version;
  }
  async function prepare({ allowFrameworkChange = false } = {}) {
    const version = await framework();
    const manifest = await readJson(path.join(root, "app/package.json"));
    const changed = manifest.dependencies.apps !== version;
    if (changed && !allowFrameworkChange) {
      throw new Error(
        `Host framework ${version} differs from the tested source pin ${manifest.dependencies.apps}. Inspect compatibility, then explicitly rerun prepare with --allow-framework-change.`
      );
    }
    const { credentials } = await identity({ create: true });
    // Inspect before copying, including symlinks. This also prevents hidden secret
    // files being uploaded accidentally if someone put them under app/.
    await collectSource(path.join(root, "app"));
    await rm(stage, { recursive: true, force: true });
    await mkdir(path.join(stage, "scripts"), { recursive: true });
    await mkdir(path.join(stage, "docs"), { recursive: true });
    await cp(path.join(root, "app"), appDirectory, {
      recursive: true,
      filter: (source) => !excluded.has(path.basename(source)),
    });
    for (const file of ["LICENSE", "NOTICE"]) {
      await cp(path.join(root, file), path.join(appDirectory, file));
    }
    for (const file of ["build-css.mjs", "build-ui.mjs", "runtime-files.mjs"]) {
      await cp(
        path.join(root, "scripts", file),
        path.join(stage, "scripts", file)
      );
    }
    await cp(
      path.join(root, "docs/ui-static-build-receipt.json"),
      path.join(stage, "docs/ui-static-build-receipt.json")
    );
    const grants = config.principals.map((principal) => ({
      ...principal,
      credentialHash: credentialHash(
        credentials.principals.find((p) => p.id === principal.id).token
      ),
    }));
    const projects = Object.fromEntries(
      config.projects.map(({ key, ...project }) => [key, project])
    );
    await writeFile(
      path.join(appDirectory, "config.ts"),
      `// Generated installation grants. Plaintext credentials remain outside uploaded source.\nexport const grants = ${JSON.stringify(grants, null, 2)} as const;\nexport const projects = ${JSON.stringify(projects, null, 2)} as const;\n`
    );
    manifest.dependencies.apps = version;
    await writeJson(path.join(appDirectory, "package.json"), manifest);
    if (changed) {
      // Change only the exact host framework pin. Preserve all other lockfile
      // resolutions; the new staging lock is retained as installation evidence.
      await runner(
        "pnpm",
        [
          "add",
          "--lockfile-only",
          "--ignore-scripts",
          "--save-exact",
          `apps@${version}`,
        ],
        { cwd: appDirectory }
      );
    }
    // pnpm owns its lockfile format, including multiple YAML documents in v12.
    // Inspect through its read-only JSON interface instead of parsing it ourselves.
    const lockedProjects = JSON.parse(
      await runner("pnpm", ["list", "apps", "--lockfile-only", "--json"], {
        cwd: appDirectory,
      })
    );
    if (
      !Array.isArray(lockedProjects) ||
      lockedProjects.length !== 1 ||
      lockedProjects[0]?.dependencies?.apps?.version !== version
    ) {
      throw new Error(
        "Staging lockfile does not pin the exact host framework."
      );
    }
    await rm(receipt("build"), { force: true });
    const result = {
      framework: version,
      configDigest: configDigest(config),
      preparedAt: new Date().toISOString(),
    };
    await writeJson(receipt("prepared"), result);
    return result;
  }
  async function build() {
    await identity();
    const prepared = await readJson(receipt("prepared"));
    if (prepared.configDigest !== configDigest(config)) {
      throw new Error("Staging config changed; prepare again.");
    }
    await runner("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: appDirectory,
      timeout: 300_000,
    });
    await runner(
      process.execPath,
      [path.join(appDirectory, "node_modules/typescript/bin/tsc"), "--noEmit"],
      { cwd: appDirectory }
    );
    await runner(
      process.execPath,
      [
        path.join(appDirectory, "node_modules/typescript/bin/tsc"),
        "-p",
        "ui/tsconfig.json",
      ],
      { cwd: appDirectory }
    );
    await runner(
      process.execPath,
      [path.join(stage, "scripts/build-css.mjs")],
      { cwd: stage }
    );
    await runner(process.execPath, [path.join(stage, "scripts/build-ui.mjs")], {
      cwd: stage,
    });
    const runtime = JSON.parse(
      await runner(
        process.execPath,
        [path.join(stage, "scripts/runtime-files.mjs")],
        { cwd: stage }
      )
    );
    if (!runtime.includes("index.ts")) {
      throw new Error("The runtime import graph does not include index.ts.");
    }
    const files = await collectSource(appDirectory);
    const result = {
      framework: prepared.framework,
      configDigest: prepared.configDigest,
      sourceDigest: sourceDigest(files),
      runtime,
      files: files.length,
      builtAt: new Date().toISOString(),
    };
    await writeJson(receipt("build"), result);
    return result;
  }
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep ordered deployment checks and recovery receipts visible together.
  async function deploy({ adoptApp } = {}) {
    await identity();
    if (adoptApp && !appIdPattern.test(adoptApp)) {
      throw new Error("Invalid --adopt-app ID.");
    }
    const built = await readJson(receipt("build"));
    if (built.framework !== (await framework())) {
      throw new Error(
        "Host framework changed. Prepare and build again before deployment."
      );
    }
    const files = await collectSource(appDirectory);
    if (
      sourceDigest(files) !== built.sourceDigest ||
      built.configDigest !== configDigest(config)
    ) {
      throw new Error(
        "Staged source changed since its successful build; rebuild before deployment."
      );
    }
    const inventory = await cli(["list"]);
    if (!Array.isArray(inventory)) {
      throw new Error("Unexpected app inventory.");
    }
    const previous = await readJson(receipt("app"), true);
    const candidates = inventory.filter(
      (candidate) => candidate.slug === config.app.slug
    );
    if (candidates.length > 1) {
      throw new Error("More than one app has the configured slug.");
    }
    if (previous && adoptApp && previous.id !== adoptApp) {
      throw new Error("Adoption target differs from recorded installation.");
    }
    const selectedId = previous?.id ?? adoptApp;
    if (!selectedId && candidates.length) {
      throw new Error(
        "An app already uses this slug. Refusing implicit adoption; use a different name or explicitly deploy --adopt-app APP_ID after checking its contents and credentials."
      );
    }
    let app = selectedId
      ? inventory.find((item) => item.id === selectedId)
      : null;
    if (selectedId && (!app || app.slug !== config.app.slug)) {
      throw new Error("Recorded/adopted app is absent or its slug differs.");
    }
    // No create call has an idempotency key. Persist creation intent first. If
    // its response was lost, a retry requires explicit adoption of the observed
    // app, so the installer never creates a second app silently.
    if (!Array.isArray(built.runtime)) {
      throw new Error("Build again to record the runtime import graph.");
    }
    const upload = uploadSource(files, built.runtime);
    requireBareName(upload);
    await writeJson(sourceFile, upload);
    if (!app) {
      const pending = await readJson(receipt("creation-pending"), true);
      if (pending) {
        throw new Error(
          "A previous create call may have succeeded. Inspect the target inventory and explicitly adopt that app, or remove creation-pending.json after confirming no app exists."
        );
      }
      await writeJson(receipt("creation-pending"), {
        host: config.host,
        organization: config.organization,
        slug: config.app.slug,
        startedAt: new Date().toISOString(),
      });
      app = await cli([
        "create",
        "--name",
        config.app.name,
        "--files",
        sourceFile,
      ]);
    }
    // Verify the configured UUID against the authenticated API context and app
    // owner before commits. The pinned CLI does not resolve organization slugs.
    const api = await apiFactory(config, app.id, cli);
    checkApp(app, config, api.context.organization);
    if (previous && (previous.owner !== app.owner || previous.id !== app.id)) {
      throw new Error("Recorded app identity differs from Cloud.");
    }
    await writeJson(receipt("app"), app);
    await rm(receipt("creation-pending"), { force: true });
    const source = await readSource(app.id);
    const commit = await commitSource(
      app.id,
      upload,
      source.revision.commit,
      "Deploy Plannotator Inbox Executor"
    );
    const result = await cli(["deploy", "--app", app.id, "--commit", commit]);
    if (!result.deployment?.id) {
      throw new Error("Host returned no deployment ID.");
    }
    const report = {
      host: config.host,
      organization: api.context.organization,
      app_id: app.id,
      slug: app.slug,
      framework: built.framework,
      deployment_id: result.deployment.id,
      commit,
      deployed_at: new Date().toISOString(),
    };
    await writeJson(receipt("deployment"), report);
    return report;
  }
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Ordered profile/account recovery preserves retry identity and authorization checks.
  async function profiles() {
    const { credentials } = await identity();
    const deployment = await readJson(receipt("deployment"));
    const app = await readJson(receipt("app"));
    const api = await apiFactory(config, deployment.app_id, cli);
    checkApp(app, config, api.context.organization);
    for (const name of [
      "profiles.list",
      "profiles.create",
      "profiles.get",
      "accounts.connect",
      "accounts.connection",
      "accounts.submit",
    ]) {
      api.describe(name);
    }
    let mapping = await readJson(receipt("profiles"), true);
    if (
      mapping &&
      (mapping.app_id !== app.id ||
        mapping.organization !== api.context.organization ||
        mapping.host !== config.host)
    ) {
      throw new Error("Profile receipt belongs to another target.");
    }
    mapping ??= {
      host: config.host,
      organization: api.context.organization,
      app_id: app.id,
      principals: [],
    };
    const inventory = await api.call("profiles.list");
    if (!Array.isArray(inventory)) {
      throw new Error("Unexpected profile inventory.");
    }
    for (const principal of config.principals) {
      const { token } = credentials.principals.find(
        (p) => p.id === principal.id
      );
      const hash = credentialHash(token);
      const idempotencyKey = `inbox-${app.id}-${principal.id}`;
      const displayLabel = principalDisplayLabel(config.app.name, principal.id);
      const matches = inventory.filter(
        (candidate) => candidate.idempotencyKey === idempotencyKey
      );
      if (matches.length > 1) {
        throw new Error("Ambiguous profile identity.");
      }
      let entry = mapping.principals.find((p) => p.id === principal.id);
      if (entry && entry.credential_hash !== hash) {
        throw new Error("Profile credentials changed; restore their backup.");
      }
      let profile = entry
        ? await api.call("profiles.get", {
            path: { profile: entry.profile_id },
          })
        : (matches[0] ??
          (await api.call("profiles.create", {
            body: { name: displayLabel, accounts: {}, idempotencyKey },
          })));
      if (profile.app !== app.id || profile.idempotencyKey !== idempotencyKey) {
        throw new Error("Host returned a mismatched profile.");
      }
      if (!entry) {
        entry = {
          id: principal.id,
          role: principal.role,
          profile_id: profile.id,
          credential_hash: hash,
        };
        mapping.principals.push(entry);
      }
      await writeJson(receipt("profiles"), mapping);
      if (!profile.accounts.identity) {
        let connection = entry.connection_id
          ? await api.call("accounts.connection", {
              path: { connection: entry.connection_id },
            })
          : null;
        if (
          !connection ||
          ["expired", "cancelled"].includes(connection.state.status)
        ) {
          connection = await api.call("accounts.connect", {
            body: {
              requirement: "identity",
              profile: profile.id,
              destination: { kind: "personal" },
            },
          });
          entry.connection_id = connection.id;
          await writeJson(receipt("profiles"), mapping);
        }
        if (
          connection.target.app !== app.id ||
          (connection.target.profile ?? connection.target.installation) !==
            profile.id ||
          connection.target.requirement !== "identity"
        ) {
          throw new Error("Host returned a mismatched account connection.");
        }
        if (connection.state.status === "pending") {
          await api.call("accounts.submit", {
            path: { connection: connection.id },
            body: {
              method: "credential",
              label: displayLabel,
              fields: { token },
            },
          });
        } else if (connection.state.status !== "completed") {
          throw new Error("Account connection is not ready.");
        }
        profile = await api.call("profiles.get", {
          path: { profile: profile.id },
        });
      }
      if (typeof profile.accounts.identity !== "string") {
        throw new Error("Profile did not select its credential account.");
      }
      entry.account_id = profile.accounts.identity;
      entry.status = profile.status;
      await writeJson(receipt("profiles"), mapping);
    }
    // Optional convenience only; never guess an app URL from a slug/domain.
    try {
      api.describe("appUi.location");
      const location = await api.call("appUi.location");
      const url = typeof location === "string" ? location : location?.url;
      if (url && new URL(url).protocol === "https:") {
        mapping.app_url = url;
        const reviewer = mapping.principals.find((p) => p.role === "reviewer");
        const reviewerUrl = new URL(url);
        reviewerUrl.searchParams.set("profile", reviewer.profile_id);
        mapping.reviewer_url = reviewerUrl.href;
        await writeJson(receipt("profiles"), mapping);
      }
    } catch {
      /* Location discovery varies by host; Open app remains available. */
    }
    return publicProfiles(mapping);
  }
  async function status() {
    await identity();
    const deployment = await readJson(receipt("deployment"), true);
    const mapping = await readJson(receipt("profiles"), true);
    return {
      installation: config.installation,
      deployment,
      profiles: mapping ? publicProfiles(mapping) : null,
    };
  }
  async function planPublication(original, organizationSlug) {
    const configFile = path.join(root, "app/config.ts");
    const { grants, projects } = await import(pathToFileURL(configFile).href);
    if (grants.length || Object.keys(projects).length) {
      throw new Error("The public app/config.ts must authorize nobody.");
    }
    const publicConfig = await readFile(configFile, "utf8");
    const installed = original.find((file) => file.path === "config.ts");
    if (!installed || installed.content === publicConfig) {
      throw new Error(
        "The working source has no installation grants in config.ts; deploy before publication."
      );
    }
    requireBareName(original);
    const name = `@${organizationSlug}.executor.community/${config.app.slug}`;
    const published = original.map((file) => {
      if (file.path === "config.ts") {
        return { ...file, content: publicConfig };
      }
      if (file.path === "package.json") {
        const manifest = { ...JSON.parse(file.content), name };
        return { ...file, content: `${JSON.stringify(manifest, null, 2)}\n` };
      }
      return file;
    });
    return { name, original, published };
  }
  // Executor lists a public app from one source commit. That commit gets the
  // scoped name and the public config; installation commits keep the bare name,
  // which Executor refuses to publish, so their grants never reach a listing.
  async function publication() {
    await identity();
    const app = await readJson(receipt("app"));
    const api = await apiFactory(config, app.id, cli);
    checkApp(app, config, api.context.organization);
    const pendingFile = receipt("publication-pending");
    const source = await readSource(app.id);
    // The pending plan keeps both snapshots until the restore succeeds, so a
    // rerun after a failure between the two commits replays the same plan.
    const plan =
      (await readJson(pendingFile, true)) ??
      (await planPublication(source.files, api.context.slug));
    await writeJson(pendingFile, plan);
    let { commit } = source.revision;
    if (sameSource(source.files, plan.original)) {
      commit = await commitSource(
        app.id,
        plan.published,
        commit,
        "Public source without installation grants"
      );
    } else if (!sameSource(source.files, plan.published)) {
      throw new Error(
        "The working source changed during publication. Inspect it, then remove publication-pending.json to start again."
      );
    }
    const restored = await commitSource(
      app.id,
      plan.original,
      commit,
      "Restore installation grants"
    );
    const result = { name: plan.name, commit, restored };
    await writeJson(receipt("publication"), result);
    await rm(pendingFile, { force: true });
    return result;
  }
  return { prepare, build, deploy, profiles, publication, status };
}
function publicProfiles(mapping) {
  return {
    host: mapping.host,
    organization: mapping.organization,
    app_id: mapping.app_id,
    app_url: mapping.app_url,
    reviewer_url: mapping.reviewer_url,
    principals: mapping.principals.map(
      ({ id, role, profile_id, account_id, status }) => ({
        id,
        role,
        profile_id,
        account_id,
        status,
      })
    ),
  };
}
