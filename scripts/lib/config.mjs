import { createHash } from "node:crypto";

const identifier = /^[a-z0-9][a-z0-9-]{0,62}$/;
const organizationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in operator-provided display names.
const controlCharacterPattern = /[\x00-\x1f]/;
const projectRootPattern = /^executor-project:\/\/[a-z0-9][a-z0-9-]{0,62}$/;
const reservedAppSlugs = new Set([
  "search",
  "constructor",
  "prototype",
  "then",
]);
const appSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
function object(value, keys, label) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object.`
  );
  assert(
    Object.keys(value).every((key) => keys.includes(key)),
    `${label} has unsupported fields.`
  );
}
function ids(value, label, { empty = false } = {}) {
  assert(
    Array.isArray(value) &&
      (empty || value.length > 0) &&
      value.every((item) => typeof item === "string" && identifier.test(item)),
    `${label} must contain stable lowercase identifiers.`
  );
  assert(new Set(value).size === value.length, `${label} contains duplicates.`);
}
/** Match the AppSlug/appSlug contract shipped with executor@2.0.0-beta.14. */
export function slugify(value) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let slug = normalized;
  if (normalized.length === 0) {
    slug = "app";
  } else if (reservedAppSlugs.has(normalized)) {
    slug = `app-${normalized}`;
  }
  return slug.slice(0, 63).replace(/-+$/g, "");
}
export function validateConfig(input) {
  object(
    input,
    [
      "version",
      "installation",
      "host",
      "organization",
      "app",
      "projects",
      "principals",
    ],
    "Config"
  );
  assert(input.version === 1, "Config version must be 1.");
  ids([input.installation], "Installation");
  let host;
  try {
    host = new URL(input.host);
  } catch {
    // biome-ignore lint/style/useErrorCause: URL parse errors can reflect embedded credentials; report only the safe validation message.
    throw new Error("Host must be an explicit HTTPS origin.");
  }
  assert(
    host.protocol === "https:" &&
      host.origin === input.host &&
      !host.username &&
      !host.password,
    "Host must be an explicit HTTPS origin without paths or credentials."
  );
  assert(
    typeof input.organization === "string" &&
      organizationIdPattern.test(input.organization),
    "Set the canonical organization UUID in lowercase. The pinned Executor CLI does not accept an organization slug after login."
  );
  object(input.app, ["name", "slug"], "App");
  assert(
    typeof input.app.name === "string" &&
      input.app.name.length > 0 &&
      input.app.name.length <= 120 &&
      input.app.name.trim() === input.app.name &&
      !controlCharacterPattern.test(input.app.name),
    "App name must contain 1–120 characters without surrounding whitespace or control characters."
  );
  assert(
    typeof input.app.slug === "string" &&
      appSlugPattern.test(input.app.slug) &&
      !reservedAppSlugs.has(input.app.slug),
    "App slug must contain 1–63 lowercase letters, digits or internal hyphens and must not be reserved."
  );
  assert(
    slugify(input.app.name) === input.app.slug,
    "The Executor CLI derives the slug from the app name; those must match."
  );
  assert(
    Array.isArray(input.projects) && input.projects.length > 0,
    "Configure at least one project."
  );
  for (const project of input.projects) {
    object(project, ["key", "name", "root"], "Project");
    ids([project.key], "Project key");
    assert(
      typeof project.name === "string" &&
        project.name.trim().length > 0 &&
        project.name.length <= 160 &&
        !controlCharacterPattern.test(project.name),
      "Project name is invalid."
    );
    assert(
      typeof project.root === "string" && projectRootPattern.test(project.root),
      "Project root must be a stable logical executor-project:// identifier, never a server path."
    );
  }
  ids(
    input.projects.map((project) => project.key),
    "Project keys"
  );
  assert(
    new Set(input.projects.map((project) => project.root)).size ===
      input.projects.length,
    "Project roots must be distinct."
  );
  assert(
    Array.isArray(input.principals) && input.principals.length > 0,
    "Configure principals."
  );
  const environments = new Set();
  for (const principal of input.principals) {
    object(principal, ["id", "role", "environments", "projects"], "Principal");
    ids([principal.id], "Principal ID");
    assert(
      ["agent", "reviewer"].includes(principal.role),
      "Principal role must be agent or reviewer."
    );
    ids(principal.environments, "Principal environments", {
      empty: principal.role === "reviewer",
    });
    assert(
      principal.role !== "reviewer" || principal.environments.length === 0,
      "Reviewers do not own agent environments."
    );
    ids(principal.projects, "Principal project grants");
    assert(
      principal.projects.every((key) =>
        input.projects.some((project) => project.key === key)
      ),
      "Principal grants reference an unknown project."
    );
    for (const environment of principal.environments) {
      assert(
        !environments.has(environment),
        "Each agent environment must belong to exactly one principal."
      );
      environments.add(environment);
    }
  }
  ids(
    input.principals.map((principal) => principal.id),
    "Principal IDs"
  );
  assert(
    input.principals.some((principal) => principal.role === "agent") &&
      input.principals.some((principal) => principal.role === "reviewer"),
    "Configure at least one agent and one reviewer."
  );
  assert(
    input.projects.every((project) =>
      input.principals.some(
        (principal) =>
          principal.role === "reviewer" &&
          principal.projects.includes(project.key)
      )
    ),
    "Each project needs a reviewer grant."
  );
  return structuredClone(input);
}
export function configDigest(config) {
  function canonical(value) {
    if (Array.isArray(value)) {
      return value.map(canonical);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])])
      );
    }
    return value;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(config)))
    .digest("hex");
}
export function credentialHash(token) {
  return createHash("sha256").update(token).digest("hex");
}
