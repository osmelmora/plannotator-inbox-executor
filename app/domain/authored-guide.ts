/** Forked from Plannotator at 177c34099258fa380c6b90c6f3e9411c13f6f463.
 * Copyright Plannotator contributors; MIT OR Apache-2.0. See LICENSE-MIT and LICENSE-APACHE.
 * Executor adaptation inventory: README.md.
 */
import { buildGuideSnapshot, listGuidePatchFiles, parseGuideSnapshot,
  type GuideSnapshot, type GuideSnapshotGenerator, type GuideSnapshotSource } from "../vendor/core/guide-format.js";
import { validateGuideOutput } from "../vendor/core/guide-prompt.js";

export interface AuthoredGuideOptions {
  /** Routing metadata only: never a filesystem location and never read. */
  readonly cwd: string;
  readonly stdin?: string;
  /** Injected for deterministic tests. */
  readonly now?: string;
  readonly source?: GuideSnapshotSource;
}

/** Refuse fields the authored adapter cannot carry instead of dropping them. */
function unsupportedFields(value: Record<string, unknown>, allowed: readonly string[], path: string): string | null {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  return extra.length ? `${path}: unsupported field${extra.length === 1 ? "" : "s"} ${extra.join(", ")}.` : null;
}

/**
 * Turn an authored guide (`--guide`) plus its patch (`--patch`) into a
 * snapshot. Strict where the in-app validator is lenient: a file the guide
 * names that is not in the patch is an error naming the file and the files
 * that ARE in the patch, so the author can fix the guide instead of silently
 * losing a chapter. Files the guide leaves out land in "Everything else".
 */
export function buildAuthoredGuideSnapshot(
  guideJson: string,
  rawPatch: string,
  opts: AuthoredGuideOptions,
): { ok: true; snapshot: GuideSnapshot } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(guideJson);
  } catch (e) {
    return { ok: false, error: `Guide file is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Guide file must be a JSON object." };
  const g = raw as Record<string, unknown>;
  const unsupported = unsupportedFields(g, ["title", "intent", "sections", "unplacedFiles", "review", "source", "generator"], "guide");
  if (unsupported) return { ok: false, error: unsupported };
  for (const [field, keys] of [
    ["review", ["gitRef", "base"]],
    ["generator", ["engine", "model", "generatedAt", "customInstructions"]],
  ] as const) {
    if (g[field] === undefined) continue;
    if (!g[field] || typeof g[field] !== "object" || Array.isArray(g[field])) return { ok: false, error: `${field}: must be an object.` };
    const metadata = g[field] as Record<string, unknown>;
    const extra = unsupportedFields(metadata, keys, field);
    if (extra) return { ok: false, error: extra };
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value !== "string") return { ok: false, error: `${field}.${key}: must be a string.` };
    }
  }
  if (g.source !== undefined && (!g.source || typeof g.source !== "object" || Array.isArray(g.source))) {
    return { ok: false, error: "source: must be an object." };
  }

  const patchFiles = listGuidePatchFiles(rawPatch).map((f) => f.path);
  if (patchFiles.length === 0) return { ok: false, error: "The patch contains no file diffs. Expected unified diff output, e.g. `git diff <base>...HEAD`." };

  const problems: string[] = [];
  if (typeof g.title !== "string" || g.title.trim() === "") problems.push("`title` must be a non-empty string.");
  if (typeof g.intent !== "string" || g.intent.trim() === "") problems.push("`intent` must be a non-empty string.");
  if (!Array.isArray(g.sections) || g.sections.length === 0) {
    problems.push("`sections` must be a non-empty array.");
  } else {
    const patchSet = new Set(patchFiles);
    const seen = new Map<string, number>();
    const unknown = new Set<string>();
    g.sections.forEach((section, i) => {
      if (!section || typeof section !== "object") { problems.push(`sections[${i}] must be an object.`); return; }
      const sec = section as Record<string, unknown>;
      const extra = unsupportedFields(sec, ["title", "overview", "diffs"], `sections[${i}]`);
      if (extra) problems.push(extra);
      if (typeof sec.title !== "string" || sec.title.trim() === "") problems.push(`sections[${i}].title must be a non-empty string.`);
      if (typeof sec.overview !== "string" || sec.overview.trim() === "") problems.push(`sections[${i}].overview must be a non-empty string.`);
      if (sec.diffs !== undefined && !Array.isArray(sec.diffs)) { problems.push(`sections[${i}].diffs must be an array of { file, summary }.`); return; }
      for (const [j, ref] of ((sec.diffs as unknown[] | undefined) ?? []).entries()) {
        const r = (ref && typeof ref === "object" ? ref : {}) as Record<string, unknown>;
        const extra = unsupportedFields(r, ["file", "summary"], `sections[${i}].diffs[${j}]`);
        if (extra) problems.push(extra);
        if (typeof r.file !== "string" || r.file === "") { problems.push(`sections[${i}].diffs[${j}].file must be a path from the patch.`); continue; }
        if (typeof r.summary !== "string") problems.push(`sections[${i}].diffs[${j}].summary must be a string.`);
        if (!patchSet.has(r.file)) unknown.add(r.file);
        const first = seen.get(r.file);
        if (first !== undefined) problems.push(`${r.file} is placed twice (sections[${first}] and sections[${i}]); a file belongs to one section.`);
        else seen.set(r.file, i);
      }
    });
    if (unknown.size > 0) {
      problems.push(
        `These files are not in the patch: ${[...unknown].join(", ")}.\nFiles in the patch:\n  ${patchFiles.join("\n  ")}`,
      );
    }
    if (g.unplacedFiles !== undefined) {
      if (!Array.isArray(g.unplacedFiles) || g.unplacedFiles.some((f) => typeof f !== "string")) problems.push("`unplacedFiles` must be an array of paths.");
      else {
        const bad = (g.unplacedFiles as string[]).filter((f) => !patchSet.has(f));
        if (bad.length > 0) problems.push(`unplacedFiles not in the patch: ${bad.join(", ")}.`);
      }
    }
  }
  if (problems.length > 0) return { ok: false, error: `Guide is not valid:\n- ${problems.join("\n- ")}` };

  const validated = validateGuideOutput(
    { title: g.title, intent: g.intent, sections: g.sections, unplacedFiles: g.unplacedFiles },
    patchFiles,
  );
  if ("error" in validated) return { ok: false, error: `Guide is not valid: ${validated.error}` };

  const review = (g.review && typeof g.review === "object" ? g.review : {}) as Record<string, unknown>;
  const gitRef = typeof review.gitRef === "string" && review.gitRef.trim() ? review.gitRef.trim() : "HEAD";
  const base = typeof review.base === "string" && review.base.trim() ? review.base.trim() : undefined;
  // Executor has no remote checkout to inspect. Require caller provenance using
  // the upstream field, rather than inventing origin/branch/head from host state.
  if (!opts.source && (!g.source || typeof g.source !== "object" || Array.isArray(g.source))) {
    return { ok: false, error: "source: explicit guide provenance is required in Executor; no local repository is read." };
  }
  const source = { ...opts.source, ...((g.source as Partial<GuideSnapshotSource> | undefined) ?? {}) } as GuideSnapshotSource;
  const generator: GuideSnapshotGenerator = {
    generatedAt: opts.now ?? new Date().toISOString(),
    ...((g.generator as GuideSnapshotGenerator | undefined) ?? {}),
  };

  const snapshot = buildGuideSnapshot({
    guide: validated.guide,
    reviewed: [],
    review: { rawPatch, gitRef, ...(base && { base }), source },
    generator,
    exportedAt: opts.now,
  });
  // The strict format parser is the authority on user-supplied `source` /
  // `generator` / `review` shapes — round-trip so a bad field fails here, not
  // in someone's browser.
  const parsed = parseGuideSnapshot(JSON.parse(JSON.stringify(snapshot)));
  if (!parsed.ok) return { ok: false, error: `Guide is not valid (${parsed.error.path}): ${parsed.error.message}` };
  return { ok: true, snapshot: parsed.value };
}

