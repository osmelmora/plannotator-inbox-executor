/** Forked from Plannotator at 177c34099258fa380c6b90c6f3e9411c13f6f463.
 * Copyright Plannotator contributors; MIT OR Apache-2.0. See LICENSE-MIT and LICENSE-APACHE.
 * Executor adaptation inventory: README.md.
 */
import { createHash } from "node:crypto";
import { parseDiffToFiles } from "../vendor/core/diff-files.js";
import { GUIDE_REVIEW_PROMPT, GUIDE_SCHEMA_JSON as UPSTREAM_GUIDE_SCHEMA_JSON } from "../vendor/core/guide-prompt.js";
import { parseGuideSnapshot, parseGuideSnapshotJson, type GuideSnapshot } from "../vendor/core/guide-format.js";
import type { InboxGuideRef } from "../vendor/core/inbox-types.js";
import { buildAuthoredGuideSnapshot } from "./authored-guide.js";
import { canonicalJson } from "./canonical-json.js";

export { GUIDE_REVIEW_PROMPT, UPSTREAM_GUIDE_SCHEMA_JSON, buildAuthoredGuideSnapshot };

// The upstream brief describes generated guide text, not the CLI authored
// envelope: it forbids review/source/generator although its own example includes
// two of those fields. Publish the complete authored shape required here.
const authoredSchema = JSON.parse(UPSTREAM_GUIDE_SCHEMA_JSON) as Record<string, any>;
const strings = (names: string[]) => Object.fromEntries(names.map((name) => [name, { type: "string" }]));
authoredSchema.required = ["title", "intent", "sections", "source"];
authoredSchema.properties.source = {
  type: "object", required: ["kind"], additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["local", "pr", "workspace", "commit"] },
    ...strings(["repo", "branch", "headSha", "commitSha"]),
    pr: { type: "object", required: ["url"], additionalProperties: false,
      properties: { ...strings(["url", "title"]), number: { type: "integer", minimum: 1 }, platform: { type: "string", enum: ["github", "gitlab"] } },
    },
  },
};
authoredSchema.properties.review = { type: "object", additionalProperties: false, properties: strings(["gitRef", "base"]) };
authoredSchema.properties.generator = { type: "object", additionalProperties: false, properties: strings(["engine", "model", "generatedAt", "customInstructions"]) };
export const GUIDE_SCHEMA_JSON = JSON.stringify(authoredSchema);

/** How to read the diff to send as `patch` (Workspaces' local-diff steps, for this machine). */
export const GUIDE_DIFF_STEPS =
  "In the project folder: find the base with `git merge-base <base branch> HEAD` and read the diff with `git diff <merge-base>` (it includes uncommitted edits; `git add -N <path>` first puts a new untracked file in it). Send that exact diff as `patch`. The Inbox keeps the diff as sent and never reads your working tree again.";

export const GUIDE_RULES = [
  "Executor requires explicit guide.source (at least kind); repository/branch/revision metadata is caller-supplied. No filesystem or Git checkout is read.",
  "Every `diffs[].file` is a path from the patch, copied exactly.",
  "A file belongs to one section: never place it twice.",
  "Files you leave out show in a trailing \"Everything else\" chapter; list them in `unplacedFiles`.",
  "Code diffs only: `patch` is unified diff output (`git diff`).",
  "Instead of `guide` and `patch`, `snapshot` takes a complete Plannotator guide snapshot (`kind: \"plannotator-guided-review\"`, the JSON inside an exported guide); the same checks apply.",
];

/**
 * The brief's worked example: the AUTHORED fixture of guide-cli.test.ts (the
 * `plannotator-guide` skill's worked example) and its two-file patch, as one
 * submit_guide call. The browser proof submits exactly this.
 */
export const GUIDE_BRIEF_EXAMPLE = {
  body: "I wrote a guided review of the token refresh change.",
  guide: {
    source: { kind: "local", repo: "example/token-refresh", branch: "feature/refresh" },
    title: "Token refresh",
    intent: "Refresh tokens before they expire.",
    sections: [{ title: "The guard", overview: "Where the refresh happens.", diffs: [{ file: "src/auth.ts", summary: "Adds the refresh guard." }] }],
    review: { gitRef: "origin/main...HEAD", base: "origin/main" },
    generator: { engine: "claude-code", model: "claude-opus-5" },
  },
  patch:
    "diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new\n" +
    "diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-{}\n+{ }\n",
};

export const GET_GUIDE_BRIEF_DESCRIPTION =
  "Get what you need to write a guided review of a code change for the person: Plannotator's method, the JSON shape of the guide, how to read the diff, the rules, and a worked submit_guide call. Read the diff in your checkout, write the guide on your own model, then call submit_guide with the guide and that exact patch.";

export const SUBMIT_GUIDE_DESCRIPTION =
  "Send the person a guided review of a code change. It lands in the Plannotator Inbox as a message with a \"Guided review\" card that opens in Plannotator's guide viewer. Pass `guide` (the shape get_guide_brief gives) and `patch` (the exact unified diff it describes), or `snapshot` (a complete Plannotator guide snapshot). Every file a section names must be in the patch, in one section only; a refusal names the file. Files you leave out show under \"Everything else\". `body` is your note above the card (default: the guide's intent). thread, reply_to and idempotency_key work as in send_message; the person's answer comes back through wait_for_reply.\n\nExample: get_guide_brief's `example` is a call that works as it is.";

export type InboxGuideCheck = { ok: true; snapshot: GuideSnapshot } | { ok: false; error: string };

/**
 * A guide as an agent sent it, checked by the upstream strict validation.
 * `cwd` remains accepted as routing metadata for call compatibility; no path is
 * read. Authored guides carry their own source provenance.
 */
export function checkInboxGuide(input: { snapshot?: unknown; guide?: unknown; patch?: string }, cwd: string): InboxGuideCheck {
  const hasSnapshot = input.snapshot !== undefined;
  if (hasSnapshot === (input.guide !== undefined || input.patch !== undefined)) {
    return { ok: false, error: "Send either `snapshot`, or `guide` with `patch`." };
  }
  if (hasSnapshot) {
    const parsed = typeof input.snapshot === "string" ? parseGuideSnapshotJson(input.snapshot) : parseGuideSnapshot(input.snapshot);
    if (!parsed.ok) return { ok: false, error: `Invalid guide snapshot (${parsed.error.path}): ${parsed.error.message}` };
    const snapshot = parsed.value;
    // The strict placement checks, on the snapshot's own guide and patch. The
    // snapshot format lets a file reference omit its summary (a shipped
    // fixture does); the authored form wants a string, so an absent one is "".
    const { reviewed: _reviewed, ...content } = snapshot.guide;
    const strict = buildAuthoredGuideSnapshot(
      JSON.stringify({
        ...content,
        sections: content.sections.map((section) => ({ ...section, diffs: section.diffs.map((ref) => ({ file: ref.file, summary: ref.summary ?? "" })) })),
      }),
      snapshot.review.rawPatch,
      { cwd, source: snapshot.source, now: snapshot.exportedAt },
    );
    return strict.ok ? { ok: true, snapshot } : { ok: false, error: strict.error };
  }
  if (input.guide === undefined || typeof input.patch !== "string") return { ok: false, error: "`guide` and `patch` go together." };
  const built = buildAuthoredGuideSnapshot(typeof input.guide === "string" ? input.guide : JSON.stringify(input.guide), input.patch, { cwd });
  return built.ok ? { ok: true, snapshot: built.snapshot } : { ok: false, error: built.error };
}

/**
 * The hash of what the agent sent: structured objects use canonical key order;
 * string payloads and array order remain exact. The built snapshot is not a
 * stable retry input, because
 * `buildAuthoredGuideSnapshot` stamps the time it ran.
 */
export function inboxGuideInputHash(input: { snapshot?: unknown; guide?: unknown; patch?: string }): string {
  const text = (value: unknown) => (typeof value === "string" ? value : canonicalJson(value ?? null));
  const sent = input.snapshot !== undefined ? ["snapshot", text(input.snapshot)] : ["guide", text(input.guide), input.patch ?? ""];
  return createHash("sha256").update(sent.join("\0")).digest("hex");
}

/** A checked snapshot as it will be stored (`text`, the blob) and the record the message carries. */
export function describeInboxGuide(snapshot: GuideSnapshot, inputSha256: string): { text: string; ref: InboxGuideRef } {
  const text = JSON.stringify(snapshot);
  const files = parseDiffToFiles(snapshot.review.rawPatch);
  const ref: InboxGuideRef = {
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    input_sha256: inputSha256,
    bytes: new TextEncoder().encode(text).byteLength,
    title: snapshot.guide.title,
    sections: snapshot.guide.sections.length,
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
  return { text, ref };
}

