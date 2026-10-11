import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cloudApi } from "../scripts/lib/cloud-api.mjs";
import {
  configDigest,
  slugify,
  validateConfig,
} from "../scripts/lib/config.mjs";
import {
  collectSource,
  createInstaller,
  principalDisplayLabel,
} from "../scripts/lib/installer.mjs";
import { officialCli } from "../scripts/lib/process.mjs";
import {
  installationDirectory,
  loadIdentity,
  withLock,
  writeJson,
} from "../scripts/lib/state.mjs";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const example = JSON.parse(
  await readFile(new URL("../config.example.json", import.meta.url), "utf8")
);
function config(patch = {}) {
  return validateConfig({
    ...structuredClone(example),
    organization: organizationId,
    ...patch,
  });
}
async function fixture(t, configOverrides = {}, appId = "app_fixture") {
  const root = await mkdtemp(path.join(os.tmpdir(), "inbox-installer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["app", "scripts", "docs"]) {
    await mkdir(path.join(root, directory));
  }
  await writeJson(path.join(root, "app/package.json"), {
    name: "test-app",
    type: "module",
    dependencies: { apps: "0.0.1-beta.81" },
  });
  await writeFile(
    path.join(root, "app/pnpm-lock.yaml"),
    'lockfileVersion: "9.0"\n'
  );
  await writeFile(
    path.join(root, "app/pnpm-workspace.yaml"),
    "packages:\n  - .\n"
  );
  await writeFile(path.join(root, "app/index.ts"), "export default {};\n");
  await writeFile(
    path.join(root, "app/config.ts"),
    "export const grants = []; export const projects = {};\n"
  );
  for (const file of ["build-css.mjs", "build-ui.mjs"]) {
    await writeFile(path.join(root, "scripts", file), "// fixture");
  }
  await writeJson(path.join(root, "docs/ui-static-build-receipt.json"), {
    assets: [],
  });
  const cfg = config(configOverrides);
  const directory = await installationDirectory(root, cfg.installation);
  const calls = [],
    commands = [],
    apps = [],
    profiles = [],
    connections = [],
    uploads = [];
  let version = "0.0.1-beta.81",
    failCreate = false;
  const cli = async (args) => {
    calls.push(args);
    if (args[0] === "create" || args[0] === "commit") {
      const sourceFile = args[args.indexOf("--files") + 1];
      uploads.push({
        operation: args[0],
        files: JSON.parse(await readFile(sourceFile, "utf8")),
      });
    }
    switch (args[0]) {
      case "framework":
        return { version };
      case "list":
        return structuredClone(apps);
      case "create": {
        const app = {
          id: appId,
          owner: `organization:${organizationId}`,
          slug: cfg.app.slug,
        };
        apps.push(app);
        if (failCreate) {
          throw new Error("Lost create response");
        }
        return structuredClone(app);
      }
      case "source":
        return { revision: { commit: "before" } };
      case "commit":
        return { revision: { commit: "after" } };
      case "deploy":
        return { deployment: { id: "dpl_fixture" } };
      default:
        throw new Error(`Unexpected CLI ${args[0]}`);
    }
  };
  const api = {
    context: { organization: organizationId, slug: "test-org" },
    describe(name) {
      return { name };
    },
    async call(name, options = {}) {
      calls.push([`api:${name}`, options]);
      const { body, path: params } = options;
      if (name === "profiles.list") {
        return structuredClone(profiles);
      }
      if (name === "profiles.create") {
        // Match pinned host constraints, so fixture success cannot conceal an
        // overlong name or idempotency key rejected by real profile creation.
        assert(
          typeof body.name === "string" &&
            body.name.length > 0 &&
            body.name.length <= 128
        );
        assert(
          typeof body.idempotencyKey === "string" &&
            body.idempotencyKey.length > 0 &&
            body.idempotencyKey.length <= 128
        );
        const profile = {
          id: `ins_${profiles.length}`,
          app: appId,
          ...body,
          status: "ready",
        };
        profiles.push(profile);
        return structuredClone(profile);
      }
      if (name === "profiles.get") {
        return structuredClone(profiles.find((p) => p.id === params.profile));
      }
      if (name === "accounts.connect") {
        const connection = {
          id: `con_${connections.length}`,
          target: {
            app: appId,
            profile: body.profile,
            requirement: body.requirement,
          },
          state: { status: "pending" },
        };
        connections.push(connection);
        return structuredClone(connection);
      }
      if (name === "accounts.connection") {
        return structuredClone(
          connections.find((c) => c.id === params.connection)
        );
      }
      if (name === "accounts.submit") {
        // The pinned account connection schema has no maximum label length.
        assert(typeof body.label === "string" && body.label.length > 0);
        const connection = connections.find((c) => c.id === params.connection);
        connection.state.status = "completed";
        profiles.find(
          (p) => p.id === connection.target.profile
        ).accounts.identity = `acc_${connection.id}`;
        return null;
      }
      if (name === "appUi.location") {
        return { url: "https://inbox.example.test/" };
      }
      throw new Error(`Unexpected API ${name}`);
    },
  };
  let lockedFramework = "0.0.1-beta.81";
  const runner = async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === "pnpm" && args[0] === "list") {
      return JSON.stringify([
        { dependencies: { apps: { version: lockedFramework } } },
      ]);
    }
    if (command === "pnpm" && args[0] === "add") {
      lockedFramework = args.at(-1).slice("apps@".length);
    }
    return "";
  };
  const installer = createInstaller({
    root,
    directory,
    config: cfg,
    cli,
    runner,
    apiFactory: async () => api,
  });
  return {
    root,
    directory,
    config: cfg,
    calls,
    commands,
    apps,
    profiles,
    connections,
    uploads,
    installer,
    cli,
    runner,
    api,
    setVersion(value) {
      version = value;
    },
    setLockedFramework(value) {
      lockedFramework = value;
    },
    loseCreate() {
      failCreate = true;
    },
  };
}

test("config requires explicit authorization mapping and safe logical project roots", () => {
  assert.equal(config().app.slug, "plannotator-inbox-executor");
  for (const patch of [
    { host: "http://api.executor.sh" },
    { host: "https://api.executor.sh/path" },
    { host: "https://user:secret@api.executor.sh" },
    { organization: "YOUR_ORGANIZATION_ID" },
    { organization: "test-org" },
    { organization: "11111111-1111-4111-8111-11111111111Z" },
    { installation: "../escape" },
    { unknown: true },
    { app: { name: "Different name", slug: "plannotator-inbox-executor" } },
    { projects: [{ key: "my-project", name: "Project", root: "/etc/passwd" }] },
    {
      projects: [
        {
          key: "my-project",
          name: "Project",
          root: "executor-project://../etc",
        },
      ],
    },
    {
      principals: [
        {
          id: "agent",
          role: "agent",
          environments: ["machine"],
          projects: ["missing"],
        },
      ],
    },
  ]) {
    assert.throws(() => config(patch));
  }
  const duplicate = config();
  duplicate.principals.push({ ...duplicate.principals[0], id: "second" });
  assert.throws(() => validateConfig(duplicate), /environment/);
  const noReviewer = config();
  noReviewer.principals.pop();
  assert.throws(() => validateConfig(noReviewer), /reviewer/);
});

test("config hash ignores property ordering but retains identity/grant changes", () => {
  const first = config();
  assert.equal(
    configDigest(first),
    configDigest(Object.fromEntries(Object.entries(first).reverse()))
  );
  const second = structuredClone(first);
  second.principals[0].environments = ["different"];
  assert.notEqual(configDigest(first), configDigest(second));
});

test("app names follow the pinned Executor slug normalization and reserved-name contract", () => {
  const cases = [
    ["Plannotator Inbox Executor", "plannotator-inbox-executor"],
    ["Café Inbox", "cafe-inbox"],
    ["Cafe\u0301 Inbox", "cafe-inbox"],
    ["Ｆｕｌｌ Ｗｉｄｔｈ", "full-width"],
    ["ﬃ Inbox", "ffi-inbox"],
    ["日本語", "app"],
    ["---", "app"],
    ["Search", "app-search"],
    ["Constructor", "app-constructor"],
    ["Prototype", "app-prototype"],
    ["Then", "app-then"],
    ["a".repeat(120), "a".repeat(63)],
    [`${"a".repeat(62)} Boundary`, "a".repeat(62)],
  ];
  for (const [name, slug] of cases) {
    assert.equal(slugify(name), slug);
    assert.equal(config({ app: { name, slug } }).app.slug, slug);
  }
  for (const app of [
    { name: "Café Inbox", slug: "caf-inbox" },
    { name: "Search", slug: "search" },
    { name: "Name", slug: "name-" },
    { name: "a".repeat(121), slug: "a".repeat(63) },
    { name: "a".repeat(64), slug: "a".repeat(64) },
    { name: "", slug: "app" },
    { name: "   ", slug: "app" },
  ]) {
    assert.throws(() => config({ app }));
  }
});

test("official CLI receives the exact canonical organization ID for scoped commands", async () => {
  const calls = [];
  const cli = officialCli(config(), async (command, args, options) => {
    calls.push({ command, args, options });
    return args.includes("credential")
      ? "password=fixture-private-value"
      : '{"version":"0.0.1-beta.81"}';
  });
  await cli(["framework"]);
  assert.equal(calls[0].command, "pnpm");
  assert.deepEqual(calls[0].args.slice(0, 4), [
    "--package=executor@2.0.0-beta.14",
    "dlx",
    "executor",
    "apps",
  ]);
  assert.deepEqual(calls[0].args.slice(-4), [
    "--host",
    "https://api.executor.sh",
    "--organization",
    organizationId,
  ]);
  assert(calls[0].args.includes("--package=executor@2.0.0-beta.14"));
  await cli(["credential", "get"], {
    raw: true,
    input: "fixture-helper-input",
  });
  assert(!calls[1].args.includes("--organization"));
  assert.equal(calls[1].options.input, "fixture-helper-input");
});

test("identities survive repeated prepare, target changes and missing/changed credentials fail closed", async (t) => {
  const f = await fixture(t);
  await f.installer.prepare();
  const first = await readFile(
    path.join(f.directory, "credentials.json"),
    "utf8"
  );
  await f.installer.prepare();
  assert.equal(
    await readFile(path.join(f.directory, "credentials.json"), "utf8"),
    first
  );
  assert.equal(
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX file permissions are a bit mask.
    (await stat(path.join(f.directory, "credentials.json"))).mode & 0o777,
    0o600
  );
  await assert.rejects(
    loadIdentity(f.directory, config({ organization: otherOrganizationId })),
    /target or configuration changed/
  );
  const changed = JSON.parse(first);
  changed.principals[0].token = "f".repeat(64);
  await writeJson(path.join(f.directory, "credentials.json"), changed);
  await assert.rejects(f.installer.prepare(), /credentials changed/);
  await rm(path.join(f.directory, "credentials.json"));
  await assert.rejects(f.installer.prepare(), /Credentials are missing/);
});

test("a second named installation receives different credentials without affecting the first", async (t) => {
  const f = await fixture(t);
  await f.installer.prepare();
  const secondConfig = config({ installation: "second-inbox" });
  const secondDir = await installationDirectory(
    f.root,
    secondConfig.installation
  );
  const second = await loadIdentity(secondDir, secondConfig, { create: true });
  const first = await loadIdentity(f.directory, f.config);
  assert.notEqual(
    first.credentials.principals[0].token,
    second.credentials.principals[0].token
  );
});

test("preparation clears stale sources and never uploads plaintext credentials", async (t) => {
  const f = await fixture(t);
  await f.installer.prepare();
  await writeFile(path.join(f.directory, "staging/app/stale.ts"), "stale");
  await f.installer.prepare();
  const files = await collectSource(path.join(f.directory, "staging/app"));
  assert(!files.some((file) => file.path === "stale.ts"));
  const { credentials } = await loadIdentity(f.directory, f.config);
  for (const principal of credentials.principals) {
    assert(!JSON.stringify(files).includes(principal.token));
  }
  assert(
    files
      .find((file) => file.path === "config.ts")
      .content.includes("credentialHash")
  );
});

test("symlinked state/source and private-looking source files are rejected", async (t) => {
  const f = await fixture(t);
  await symlink("/tmp", path.join(f.root, ".runtime/installations/escape"));
  await assert.rejects(installationDirectory(f.root, "escape"), /symlinks/);
  await symlink("/etc/passwd", path.join(f.root, "app/leak.ts"));
  await assert.rejects(f.installer.prepare(), /symlink/);
  await rm(path.join(f.root, "app/leak.ts"));
  await writeFile(
    path.join(f.root, "app/credentials.json"),
    '{"token":"secret"}'
  );
  await assert.rejects(f.installer.prepare(), /sensitive-looking/);
});

test("installation lock excludes overlapping operations", async (t) => {
  const f = await fixture(t);
  await withLock(f.directory, async () =>
    assert.rejects(
      withLock(f.directory, async () => {
        /* Only lock acquisition and release are under test. */
      }),
      /Another installer/
    )
  );
  await withLock(f.directory, async () => {
    /* Only lock acquisition and release are under test. */
  });
});

test("framework drift requires explicit compatibility choice and deploy requires the built version", async (t) => {
  const f = await fixture(t);
  f.setVersion("0.0.1-beta.82");
  await assert.rejects(f.installer.prepare(), /allow-framework-change/);
  f.setVersion("0.0.1-beta.81");
  await f.installer.prepare();
  await f.installer.build();
  f.setVersion("0.0.1-beta.82");
  await assert.rejects(f.installer.deploy(), /Host framework changed/);
  assert(!f.calls.some((call) => call[0] === "create"));
});

test("pnpm lock inspection rejects a mismatched framework and explicit updates preserve a standalone lock", async (t) => {
  const f = await fixture(t);
  f.setLockedFramework("0.0.1-beta.80");
  await assert.rejects(f.installer.prepare(), /lockfile does not pin/);
  f.setVersion("0.0.1-beta.82");
  await f.installer.prepare({ allowFrameworkChange: true });
  const update = f.commands.find(
    (command) => command.command === "pnpm" && command.args[0] === "add"
  );
  assert.deepEqual(update.args, [
    "add",
    "--lockfile-only",
    "--ignore-scripts",
    "--save-exact",
    "apps@0.0.1-beta.82",
  ]);
  assert.equal(update.options.cwd, path.join(f.directory, "staging/app"));
  const stagedFiles = await collectSource(
    path.join(f.directory, "staging/app")
  );
  assert(stagedFiles.some((file) => file.path === "pnpm-lock.yaml"));
  assert(stagedFiles.some((file) => file.path === "pnpm-workspace.yaml"));
  assert(!stagedFiles.some((file) => file.path === "package-lock.json"));
});

test("deployment omits only the pnpm lock from uploads while retaining its build integrity check", async (t) => {
  const f = await fixture(t);
  await f.installer.prepare();
  await f.installer.build();
  const appDirectory = path.join(f.directory, "staging/app");
  const lockFile = path.join(appDirectory, "pnpm-lock.yaml");
  const originalLock = await readFile(lockFile, "utf8");
  const stagedFiles = await collectSource(appDirectory);

  await writeFile(lockFile, `${originalLock}# modified after build\n`);
  await assert.rejects(f.installer.deploy(), /source changed/);
  assert.equal(f.uploads.length, 0);

  await writeFile(lockFile, originalLock);
  await f.installer.deploy();
  assert.deepEqual(
    f.uploads.map((upload) => upload.operation),
    ["create", "commit"]
  );
  const expectedSource = stagedFiles.filter(
    (file) => file.path !== "pnpm-lock.yaml"
  );
  for (const upload of f.uploads) {
    assert.deepEqual(upload.files, expectedSource);
    assert(upload.files.some((file) => file.path === "pnpm-workspace.yaml"));
  }
  assert.equal(await readFile(lockFile, "utf8"), originalLock);
});

test("locked build is required; altered source and implicit existing-app adoption are refused", async (t) => {
  const f = await fixture(t);
  await f.installer.prepare();
  await f.installer.build();
  assert(
    f.commands.some(
      (command) =>
        command.command === "pnpm" &&
        JSON.stringify(command.args) ===
          JSON.stringify(["install", "--frozen-lockfile", "--ignore-scripts"])
    )
  );
  assert(
    f.commands.some((command) => command.args.includes("ui/tsconfig.json"))
  );
  await writeFile(path.join(f.directory, "staging/app/index.ts"), "changed");
  await assert.rejects(f.installer.deploy(), /source changed/);
  await f.installer.build();
  f.apps.push({
    id: "app_existing",
    owner: `organization:${organizationId}`,
    slug: f.config.app.slug,
  });
  await assert.rejects(f.installer.deploy(), /implicit adoption/);
  assert(!f.calls.some((call) => call[0] === "create"));
});

test("deployment resumes its own app and profile provisioning is idempotent and app-scoped", async (t) => {
  const f = await fixture(t);
  await f.installer.prepare();
  await f.installer.build();
  await f.installer.deploy();
  await f.installer.deploy();
  assert.equal(f.calls.filter((call) => call[0] === "create").length, 1);
  const first = await f.installer.profiles();
  const second = await f.installer.profiles();
  assert.deepEqual(second, first);
  assert.equal(f.profiles.length, f.config.principals.length);
  assert.equal(f.connections.length, f.config.principals.length);
  assert(
    f.profiles.every((profile) =>
      profile.idempotencyKey.includes("app_fixture")
    )
  );
  assert.equal(first.reviewer_url, "https://inbox.example.test/?profile=ins_1");
  const status = await f.installer.status();
  const { credentials } = await loadIdentity(f.directory, f.config);
  for (const principal of credentials.principals) {
    assert(!JSON.stringify(status).includes(principal.token));
  }
  assert(!JSON.stringify(status).includes("credential_hash"));
});

test("lost create response cannot create another app; explicit adoption safely resumes", async (t) => {
  const f = await fixture(t);
  await f.installer.prepare();
  await f.installer.build();
  f.loseCreate();
  await assert.rejects(f.installer.deploy(), /Lost create/);
  await assert.rejects(f.installer.deploy(), /implicit adoption/);
  await f.installer.deploy({ adoptApp: "app_fixture" });
  assert.equal(f.calls.filter((call) => call[0] === "create").length, 1);
});

test("maximum configured names provision bounded profile and account labels with full principal IDs", async (t) => {
  const name = "N".repeat(120);
  const principalId = "a".repeat(63);
  const principals = structuredClone(example.principals);
  principals[0].id = principalId;
  const syntheticAppId = `app_${randomUUID()}`;
  const f = await fixture(
    t,
    { app: { name, slug: "n".repeat(63) }, principals },
    syntheticAppId
  );
  await f.installer.prepare();
  await f.installer.build();
  await f.installer.deploy();
  await f.installer.profiles();
  const submittedLabels = f.calls
    .filter((call) => call[0] === "api:accounts.submit")
    .map((call) => call[1].body.label);
  assert.equal(f.profiles[0].name.length, 128);
  assert(f.profiles[0].name.endsWith(` · ${principalId}`));
  assert.equal(
    f.profiles[0].idempotencyKey.length,
    110,
    "actual app UUID plus maximum principal ID fits the 128-character key bound"
  );
  assert.deepEqual(
    submittedLabels,
    f.profiles.map((profile) => profile.name)
  );
  assert(submittedLabels.every((label) => label.length <= 128));
  const unicodeLabel = principalDisplayLabel("🚀".repeat(60), "b".repeat(62));
  assert(
    unicodeLabel.length <= 128 && unicodeLabel.endsWith(` · ${"b".repeat(62)}`)
  );
  assert.equal(
    Buffer.from(unicodeLabel).toString(),
    unicodeLabel,
    "truncation must preserve complete Unicode characters"
  );
});

test("adoption cannot target another organization", async (t) => {
  const f = await fixture(t);
  await f.installer.prepare();
  await f.installer.build();
  f.apps.push({
    id: "app_wrong",
    owner: `organization:${otherOrganizationId}`,
    slug: f.config.app.slug,
  });
  await assert.rejects(
    f.installer.deploy({ adoptApp: "app_wrong" }),
    /outside the selected organization/
  );
  assert(!f.calls.some((call) => call[0] === "commit"));
});

test("Cloud API uses approved helper in memory, verifies organization and blocks cross-app/origin", async () => {
  const requests = [],
    calls = [];
  const cfg = config();
  const cli = async (args, options) => {
    calls.push({ args, options });
    return args[0] === "git"
      ? `https://api.executor.sh/git/${organizationId}/app_fixture.git`
      : "username=executor\npassword=test-only-secret\n";
  };
  const fetcher = async (url, options) => {
    requests.push({ url: url.href, options });
    if (url.pathname === "/api/context") {
      return Response.json({ organization: organizationId, slug: "test-org" });
    }
    if (url.pathname === "/openapi.json") {
      return Response.json({
        paths: {
          "/api/organizations/{organization}/apps/{app}/profiles": {
            get: { operationId: "profiles.list" },
          },
          "https://evil.example/steal": {
            post: { operationId: "malicious.operation" },
          },
        },
      });
    }
    return Response.json([]);
  };
  const api = await cloudApi(cfg, "app_fixture", cli, fetcher);
  await api.call("profiles.list");
  assert.equal(
    requests[2].url,
    `https://api.executor.sh/api/organizations/${organizationId}/apps/app_fixture/profiles`
  );
  assert(
    requests.every(
      (request) =>
        request.options.redirect === "error" &&
        request.options.headers.Authorization === "Bearer test-only-secret"
    )
  );
  await assert.rejects(
    api.call("profiles.list", { path: { app: "app_other" } }),
    /Cross-app/
  );
  await assert.rejects(
    api.call("profiles.list", { path: { organization: otherOrganizationId } }),
    /Cross-organization/
  );
  await assert.rejects(
    api.call("profiles.list", { path: { organization: "test-org" } }),
    /Cross-organization/
  );
  await assert.rejects(api.call("malicious.operation"), /Cross-origin/);
  assert.equal(calls[1].args.join(" "), "credential get");
  await assert.rejects(
    cloudApi(
      config({ organization: otherOrganizationId }),
      "app_fixture",
      cli,
      fetcher
    ),
    /organization differs/
  );
  // Defense in depth if a caller bypasses validateConfig: matching the context
  // slug still must not authorize a different canonical organization value.
  await assert.rejects(
    cloudApi({ ...cfg, organization: "test-org" }, "app_fixture", cli, fetcher),
    /organization differs/
  );
});

test("credential submission errors never echo reflected response secrets", async () => {
  const cfg = config();
  const cli = async (args) =>
    args[0] === "git"
      ? `https://api.executor.sh/git/${organizationId}/app_fixture.git`
      : "password=secret";
  const fetcher = async (url) => {
    if (url.pathname === "/api/context") {
      return Response.json({ organization: organizationId, slug: "test-org" });
    }
    if (url.pathname === "/openapi.json") {
      return Response.json({
        paths: { "/submit": { post: { operationId: "accounts.submit" } } },
      });
    }
    return new Response("fixture-reflected-sensitive-token", { status: 400 });
  };
  const api = await cloudApi(cfg, "app_fixture", cli, fetcher);
  await assert.rejects(
    api.call("accounts.submit", {
      body: { token: "fixture-reflected-sensitive-token" },
    }),
    (error) =>
      !error.message.includes("fixture-reflected-sensitive-token") &&
      error.message.includes("HTTP 400")
  );
});
