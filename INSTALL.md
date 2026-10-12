# Install Plannotator Inbox Executor

This installs a new Inbox in your Executor Cloud organization from source. It does not migrate another installation's messages or reuse its identities. Once deployed, the app runs entirely in Executor; the setup machine can go offline.

If you want another T3 machine to use your existing Inbox, configure its authorized identity and scoped connection instead of creating another app. See [agent setup](docs/agent-setup.md).

## 1. Get the source and sign in

Install [mise](https://mise.jdx.dev/getting-started.html), clone the repository, and inspect its configuration before trusting it. Set up the pinned toolchain and both dependency trees:

```sh
git clone https://github.com/osmelmora/plannotator-inbox-executor.git
cd plannotator-inbox-executor
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile --ignore-scripts
mise exec -- pnpm --dir app install --frozen-lockfile --ignore-scripts
mise exec -- pnpm verify
```

[`mise.toml`](mise.toml) pins Node.js 24.21.0, pnpm 12.11.2, and Bun 1.4.2. Root dependencies provide development checks; the app has its own lockfile so the installer can build it independently. Bun runs tests locally and is not required in Executor's runtime. These instructions use `mise exec --` so shell activation is optional; an activated mise shell can omit that prefix.

Sign in with the pinned Executor CLI:

```sh
mise exec -- pnpm --package=executor@2.0.0-beta.14 dlx executor apps login --host https://api.executor.sh
```

Complete Executor's normal device/browser sign-in with an account authorized to create apps, profiles, and accounts in the destination organization. Do not paste credentials into source files or chat. The installer uses this official CLI login and always addresses the organization configured below.

## 2. Configure your installation

```sh
mise exec -- node scripts/install.mjs init --config inbox.config.json
```

This copies [`config.example.json`](config.example.json) and refuses to overwrite an existing file. Edit `inbox.config.json` before preparing the installation:

```json
{
  "version": 1,
  "installation": "my-inbox",
  "host": "https://api.executor.sh",
  "organization": "YOUR_ORGANIZATION_ID",
  "app": {
    "name": "Plannotator Inbox Executor",
    "slug": "plannotator-inbox-executor"
  },
  "projects": [
    {
      "key": "my-project",
      "name": "My project",
      "root": "executor-project://my-project"
    }
  ],
  "principals": [
    {
      "id": "machine-a",
      "role": "agent",
      "environments": ["t3-machine-a"],
      "projects": ["my-project"]
    },
    {
      "id": "reviewer",
      "role": "reviewer",
      "environments": [],
      "projects": ["my-project"]
    }
  ]
}
```

Replace `YOUR_ORGANIZATION_ID` with the destination organization's canonical UUID in lowercase. The pinned Executor CLI compares this value directly with the organization ID saved at login; a human-readable organization slug is not accepted.

If your organization already contains an app, the official CLI can report its owner using the current approved login:

```sh
mise exec -- pnpm --package=executor@2.0.0-beta.14 dlx executor apps list --host https://api.executor.sh
```

Use the UUID from that app's `owner` value, `organization:<UUID>`, after checking it belongs to the intended organization. For an empty organization, UUID discovery is a manual prerequisite: obtain the `organization` field from Executor's authenticated `/api/context` response for that organization. This is the same context endpoint used by CLI login; its `slug` field and the login message's `@namespace` are different values. The pinned CLI has no `context`, `whoami`, or `status` command and this installer does not automate that initial lookup. If your authenticated dashboard/API access does not expose the ID, ask the organization administrator or Executor support for it before continuing. No access token belongs in this config.

`installation` names the local operator state directory, not an agent or Inbox thread. Keep the default app name/slug unless you need a separate installation in the same organization; a customized name must produce its configured slug.

Names may contain up to 120 characters. Slug derivation matches the pinned Executor contract: normalize Unicode accents, lowercase, replace punctuation with hyphens, limit to 63 characters, and trim edge hyphens. Names without ASCII letters/digits use `app`. Reserved names `search`, `constructor`, `prototype`, and `then` gain an `app-` prefix. For example, `Café Inbox` requires `cafe-inbox`; `Search` requires `app-search`. The installer rejects mismatches before creating an app.

Add one agent principal for each independent T3 environment you intend to connect. For a two-machine test, add a second agent with `id: "machine-b"`, `environments: ["t3-machine-b"]`, and the same `projects: ["my-project"]`. One principal can own many conversation sessions; do not create an account per thread.

Map each repository to one logical project key/root. Checkouts on different machines may have different physical paths but use the same configured project. The reviewer should be granted every project they need to review.

**Finalize this configuration before the first `prepare` or `install`.** The installer freezes it when credentials are prepared and refuses later changes. Grant additions, rotation, and existing installation migration currently require deliberate operator work; there is no automated identity migration command.

## 3. Build, deploy, and provision profiles

```sh
mise exec -- node scripts/install.mjs install --config inbox.config.json
mise exec -- node scripts/install.mjs status --config inbox.config.json
```

The installer discovers the target host's exact `apps` framework version, creates fresh per-principal credentials, stages source with only credential hashes/grants, installs the staged app with its frozen pnpm lockfile, builds assets, type-checks server and UI, deploys the app, and provisions its accounts/profiles. [Executor requires an exact host-compatible framework pin](https://executor.sh/docs/author-an-app).

The source uploaded to Executor holds only the files the host loads: every file `index.ts` and `ui/index.html` import, type-only imports included, the prebuilt assets in `ui/public`, `package.json`, migrations, skills, and license and provenance files, including the repository's `LICENSE` and `NOTICE`. The vendored UI source, generated styles, and pnpm lockfile remain in local staging and the build integrity check. Keeping these build inputs out of the upload holds the app within Executor's public listing limits of 512 files and 4 MB of source.

You can run the same stages individually when investigating a failure:

```sh
mise exec -- node scripts/install.mjs prepare --config inbox.config.json
mise exec -- node scripts/install.mjs build --config inbox.config.json
mise exec -- node scripts/install.mjs deploy --config inbox.config.json
mise exec -- node scripts/install.mjs profiles --config inbox.config.json
```

Stages can resume from this installation's saved state. If the host framework differs from the source pin, preparation stops. Inspect compatibility first; `prepare` and `install` accept `--allow-framework-change` to explicitly try that version and update the staging pnpm lockfile. This opt-in does not mark the new version as verified. Do not bypass a build failure. Review the reported host, organization, and app before continuing if anything differs from your intended target.

A fresh installation refuses to overwrite an existing app with the same slug. `deploy --adopt-app <app-id>` is an explicit operator escape hatch for intentional adoption, not the normal install path. Do not use it on an Inbox with existing identities/data without planning the corresponding credential and grant migration.

## 4. Open your Inbox

`status` reports installation IDs and the reviewer URL when the host provides one. You can also open it from the dashboard:

1. Open **Apps → Plannotator Inbox Executor**.
2. Select **Plannotator Inbox Executor · reviewer** in the profile dropdown (or your configured app/principal names).
3. Click **Open app** and bookmark the URL Executor opens.

Use the reviewer profile for the UI. Agent profiles intentionally lack human-review privileges. Keep the app private; publishing this repository is separate from publicly sharing your running Inbox.

## 5. Connect agents and verify a reply

Create one scoped MCP connection for each agent profile, with the explicit 16-tool list in [agent setup](docs/agent-setup.md). Add each generated URL to the corresponding T3 environment and complete normal OAuth sign-in. The installer provisions profiles/accounts; it does **not** create these scoped connections.

Then follow [the round-trip walkthrough](docs/round-trip.md): open a durable session, upload a small snapshot, send a question, answer it in the real Inbox UI, and retrieve the reply through Executor. Repeat with a second agent to check distinct threads within the shared project.

## Preserve state when updating

Keep `inbox.config.json` and `.runtime/installations/<installation>/` private and backed up together. That directory contains generated credentials, app/profile receipts, and staging state. It is operator state, not a backup of the hosted Inbox database. Normal agents do not need a copy.

To update source, preserve those files, fetch/review the changes, and rerun `install` with the same configuration. The saved receipt identifies the existing app; the installer retains its credentials. Check [the changelog](CHANGELOG.md) and any migration requirements first. Applied database migrations must be extended rather than rewritten.

Preserve the [account provider declaration](docs/compatibility.md#account-provider-identity), including its labels and credential schema. Executor uses that declaration to bind existing accounts; cosmetic app branding changes must not rename the provider.

To make an independent installation, use a separate source checkout and a new config/state directory. Do not copy `.runtime/` or another installation's credentials. Losing operator state is not a safe reason to regenerate identities over an existing app.

## Tested scope

The original app passed a real Executor Cloud MCP/UI round trip and redeployment check. The reusable installer is prepared for fresh source installs; **a second organization's complete installation has not yet been verified**. See [verification](docs/verification.md).

The installer has an explicit HTTPS host setting, but another self-hosted Executor is not a verified installation target. Host API/authentication compatibility and framework support must be checked there. This repository is not a one-click catalog package and does not copy existing Inbox data automatically.
