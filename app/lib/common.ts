import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { InboxError } from "../domain/schema.js";

// biome-ignore lint/performance/noBarrelFile: Shared worker adapters retain the same Buffer and InboxError module identities.
export { Buffer } from "node:buffer";
export { InboxError } from "../domain/schema.js";
// biome-ignore lint/suspicious/noExplicitAny: Schemas and strict() validate the dynamic upstream tool payloads at runtime.
export type Input = Record<string, any>;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical((value as Input)[k])}`)
        .join(",") +
      "}"
    );
  }
  // biome-ignore lint/suspicious/noUnnecessaryConditions: JSON.stringify(undefined) returns undefined even though its library overload says string.
  return JSON.stringify(value) ?? "null";
}
export const hash = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export function refuse(code: string, message: string): never {
  throw new InboxError(code, message);
}
export function strict(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = []
): asserts value is Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refuse("validation_error", "Expected an object.");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      refuse("validation_error", `Unsupported field: ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      refuse("validation_error", `Missing field: ${key}`);
    }
  }
}
export const ok = (text: string, structuredContent: Input) => ({
  content: [{ type: "text" as const, text }],
  structuredContent,
});
export const fail = (error: unknown) => ({
  content: [
    {
      type: "text" as const,
      text:
        error instanceof InboxError
          ? `${error.code}: ${error.message}`
          : "internal_error: Native Inbox operation failed.",
    },
  ],
  isError: true,
});
export function jsonSize(value: unknown, max = 512 * 1024) {
  if (Buffer.byteLength(JSON.stringify(value)) > max) {
    refuse("size_limit", `Record exceeds ${max} bytes.`);
  }
}
