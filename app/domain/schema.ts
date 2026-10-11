/** Forked from Plannotator at 177c34099258fa380c6b90c6f3e9411c13f6f463.
 * Copyright Plannotator contributors; MIT OR Apache-2.0. See LICENSE-MIT and LICENSE-APACHE.
 * Executor adaptation inventory: README.md.
 */
import type { InboxLine, InboxRecordKind } from "../vendor/core/inbox-types.js";

const KINDS: ReadonlySet<InboxRecordKind> = new Set(["project", "message", "question", "decision", "annotation"]);

/**
 * One line of a store file, or null when it is not a line this reader can
 * use: not JSON, no numeric `v`, no positive integer `seq`, an unknown kind, or
 * a record whose id is not the line's id.
 */
export function parseInboxLine(text: string): InboxLine | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const line = value as Record<string, unknown>;
  if (typeof line.v !== "number") return null;
  if (typeof line.seq !== "number" || !Number.isSafeInteger(line.seq) || line.seq < 1) return null;
  if (typeof line.at !== "string") return null;
  if (typeof line.kind !== "string" || !KINDS.has(line.kind as InboxRecordKind)) return null;
  if (typeof line.id !== "string" || !line.id) return null;
  const record = line.record;
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  if ((record as Record<string, unknown>).id !== line.id) return null;
  return value as InboxLine;
}

/** An expected refusal from a store operation, with a stable snake_case code. */
export class InboxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "InboxError";
  }
}
