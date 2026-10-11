import type { SqlReader } from "apps";
import { canonical, hash, jsonSize, refuse } from "./common.js";
export function cached<T>(
  sql: SqlReader,
  principal: string,
  scope: string,
  operation: string,
  key: string,
  payload: unknown,
  run: () => T
): T {
  if (typeof key !== "string" || !key || key.length > 200) {
    refuse("validation_error", "idempotency_key must be 1–200 characters.");
  }
  const digest = hash(canonical(payload));
  const [previous] = sql
    .exec<{
      payload_hash: string;
      result_json: string;
    }>(
      "SELECT payload_hash,result_json FROM requests WHERE principal_id=? AND scope=? AND operation=? AND request_key=?",
      principal,
      scope,
      operation,
      key
    )
    .toArray();
  if (previous) {
    if (previous.payload_hash !== digest) {
      refuse(
        "idempotency_key_reused",
        "Same retry key has different arguments."
      );
    }
    const result = JSON.parse(previous.result_json);
    if (result?.structuredContent && "replayed" in result.structuredContent) {
      result.structuredContent.replayed = true;
    }
    // The reused upstream UI API returns its envelope directly, unlike MCP.
    if (typeof result?.replayed === "boolean") {
      result.replayed = true;
    }
    return result as T;
  }
  const result = run();
  jsonSize(result, 1_500_000);
  sql.exec(
    "INSERT INTO requests(principal_id,scope,operation,request_key,payload_hash,result_json) VALUES(?,?,?,?,?,?)",
    principal,
    scope,
    operation,
    key,
    digest,
    JSON.stringify(result)
  );
  return result;
}

/** Side-effect-free receipt lookup, used before active wait polling. */
export function lookupRequest(
  sql: SqlReader,
  principal: string,
  scope: string,
  operation: string,
  key: string,
  payload: unknown
): { found: false } | { found: true; value: unknown } {
  if (typeof key !== "string" || !key || key.length > 200) {
    refuse("validation_error", "request_id must be 1–200 characters.");
  }
  const [old] = sql
    .exec<{
      payload_hash: string;
      result_json: string;
    }>(
      "SELECT payload_hash,result_json FROM requests WHERE principal_id=? AND scope=? AND operation=? AND request_key=?",
      principal,
      scope,
      operation,
      key
    )
    .toArray();
  if (!old) {
    return { found: false };
  }
  if (old.payload_hash !== hash(canonical(payload))) {
    refuse("idempotency_key_reused", "Same retry key has different arguments.");
  }
  return { found: true, value: JSON.parse(old.result_json) };
}
