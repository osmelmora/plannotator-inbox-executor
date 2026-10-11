import type { SqlReader } from "apps";
import {
  type InboxAttachment,
  inboxAttachmentId,
  inboxAttachmentKind,
  inboxAttachmentNameRefusal,
  isInboxTextBytes,
} from "../vendor/core/inbox-types.js";
import type { Session } from "./auth.js";
import {
  Buffer,
  canonical,
  hash,
  type Input,
  refuse,
  strict,
} from "./common.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: Upload paths must reject every ASCII control character.
const UNSAFE_PATH_CHARACTER = /[\\:\x00-\x1f\x7f]/;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const LIMITS = {
  files: 50,
  fileBytes: 1024 * 1024,
  snapshotBytes: 2 * 1024 * 1024,
  manifestBytes: 2880 * 1024,
  chunkBytes: 24 * 1024,
  chunks: 120,
} as const;
export function safePath(path: unknown): string {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 500 ||
    path.startsWith("/") ||
    UNSAFE_PATH_CHARACTER.test(path) ||
    path
      .split("/")
      .some(
        (p) =>
          !p || p === "." || p === ".." || p.endsWith(".") || p.endsWith(" ")
      )
  ) {
    refuse(
      "validation_error",
      "File paths must be safe relative paths (no traversal, backslashes, absolute paths or empty segments)."
    );
  }
  return path;
}
export function base64(text: unknown): Buffer {
  if (typeof text !== "string" || !CANONICAL_BASE64.test(text)) {
    refuse("validation_error", "Invalid canonical base64.");
  }
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) {
    refuse("validation_error", "Invalid canonical base64.");
  }
  return bytes;
}
export function writeBlob(sql: SqlReader, bytes: Uint8Array): string {
  if (bytes.byteLength > LIMITS.fileBytes) {
    refuse(
      "size_limit",
      `One stored blob is limited to ${LIMITS.fileBytes} decoded bytes.`
    );
  }
  const sha = hash(bytes);
  sql.exec(
    "INSERT OR IGNORE INTO blobs(sha256,content_base64,size) VALUES(?,?,?)",
    sha,
    Buffer.from(bytes).toString("base64"),
    bytes.byteLength
  );
  return sha;
}
export function readBlob(sql: SqlReader, sha: string): Buffer {
  const [row] = sql
    .exec<{
      content_base64: string;
    }>("SELECT content_base64 FROM blobs WHERE sha256=?", sha)
    .toArray();
  if (!row) {
    refuse("snapshot_missing", "Stored bytes are unavailable.");
  }
  return Buffer.from(row.content_base64, "base64");
}
function snapshotOf(sql: SqlReader, s: Session, id: string) {
  const [row] = sql
    .exec<{
      id: string;
      session_id: string;
      revision_json: string;
      created_at: string;
      manifest_hash: string;
    }>("SELECT * FROM snapshots WHERE id=? AND session_id=?", id, s.id)
    .toArray();
  if (!row) {
    refuse("forbidden", "Snapshot is not owned by this session.");
  }
  return row;
}
export function upload(sql: SqlReader, s: Session, input: Input) {
  const manifest = {
    files: input.files,
    ...(input.revision === undefined ? {} : { revision: input.revision }),
  };
  if (Buffer.byteLength(canonical(manifest)) > LIMITS.manifestBytes) {
    refuse("size_limit", "Serialized snapshot manifest exceeds 2880 KiB.");
  }
  if (
    !Array.isArray(input.files) ||
    input.files.length < 1 ||
    input.files.length > LIMITS.files
  ) {
    refuse("size_limit", "A snapshot contains 1–50 files.");
  }
  const revision = input.revision === undefined ? {} : input.revision;
  strict(revision, ["repository", "base", "head", "branch", "dirty"]);
  for (const [key, value] of Object.entries(revision)) {
    if (
      key === "dirty"
        ? typeof value !== "boolean"
        : typeof value !== "string" || value.length > 4096
    ) {
      refuse("validation_error", `Invalid revision.${key}`);
    }
  }
  const names = new Set<string>();
  let total = 0;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep the ordered snapshot validation and size accounting together.
  const files = input.files.map((f: unknown) => {
    strict(
      f,
      ["path", "content", "encoding", "sha256", "mtime"],
      ["path", "content", "encoding"]
    );
    const path = safePath(f.path);
    const normalized = path.normalize("NFKC").toLowerCase();
    if (names.has(normalized)) {
      refuse("validation_error", "Duplicate or case-fold-colliding file path.");
    }
    names.add(normalized);
    if (
      typeof f.content !== "string" ||
      !["utf8", "base64"].includes(f.encoding)
    ) {
      refuse("validation_error", "Files require utf8 text or base64 bytes.");
    }
    const bytes =
      f.encoding === "utf8"
        ? Buffer.from(f.content, "utf8")
        : base64(f.content);
    if (f.encoding === "utf8" && bytes.toString("utf8") !== f.content) {
      refuse("validation_error", "Text has invalid Unicode.");
    }
    total += bytes.length;
    if (bytes.length > LIMITS.fileBytes || total > LIMITS.snapshotBytes) {
      refuse("size_limit", "Snapshot limits: 1 MiB/file, 2 MiB total.");
    }
    const sha = hash(bytes);
    if (f.sha256 !== undefined && f.sha256 !== sha) {
      refuse("hash_mismatch", "File SHA-256 does not match bytes.");
    }
    if (
      f.mtime !== undefined &&
      (typeof f.mtime !== "string" || !Number.isFinite(Date.parse(f.mtime)))
    ) {
      refuse("validation_error", "mtime must be an ISO timestamp.");
    }
    return {
      path,
      encoding: f.encoding,
      sha256: sha,
      size: bytes.length,
      mtime: f.mtime ?? null,
      bytes,
    };
  });
  const digest = hash(
    canonical({ files: files.map(({ bytes, ...f }) => f), revision })
  );
  const [prior] = sql
    .exec<{
      id: string;
    }>(
      "SELECT id FROM snapshots WHERE session_id=? AND manifest_hash=?",
      s.id,
      digest
    )
    .toArray();
  if (prior) {
    return readSnapshot(sql, s, { snapshot_id: prior.id });
  }
  const id = `snap_${crypto.randomUUID().replaceAll("-", "")}`;
  sql.exec(
    "INSERT INTO snapshots(id,session_id,manifest_hash,revision_json,created_at) VALUES(?,?,?,?,?)",
    id,
    s.id,
    digest,
    canonical(revision),
    new Date().toISOString()
  );
  for (const f of files) {
    writeBlob(sql, f.bytes);
    sql.exec(
      "INSERT INTO snapshot_files(snapshot_id,path,encoding,sha256,size,mtime) VALUES(?,?,?,?,?,?)",
      id,
      f.path,
      f.encoding,
      f.sha256,
      f.size,
      f.mtime
    );
  }
  return readSnapshot(sql, s, { snapshot_id: id });
}
export function readSnapshot(sql: SqlReader, s: Session, input: Input) {
  const snap = snapshotOf(sql, s, input.snapshot_id);
  const files = sql
    .exec<{
      path: string;
      encoding: string;
      sha256: string;
      size: number;
      mtime: string | null;
    }>(
      "SELECT path,encoding,sha256,size,mtime FROM snapshot_files WHERE snapshot_id=? ORDER BY path",
      snap.id
    )
    .toArray();
  if (input.path !== undefined) {
    const f = files.find((file) => file.path === safePath(input.path));
    if (!f) {
      refuse("file_not_found", "Path is not in this snapshot.");
    }
    return {
      snapshot_id: snap.id,
      revision: JSON.parse(snap.revision_json),
      file: {
        ...f,
        content: readBlob(sql, f.sha256).toString(
          f.encoding === "utf8" ? "utf8" : "base64"
        ),
      },
    };
  }
  return {
    snapshot_id: snap.id,
    manifest_sha256: snap.manifest_hash,
    revision: JSON.parse(snap.revision_json),
    files,
    created_at: snap.created_at,
  };
}
export function uploadChunk(sql: SqlReader, s: Session, input: Input) {
  const bytes = base64(input.content_base64);
  if (
    !bytes.length ||
    bytes.length > LIMITS.chunkBytes ||
    !Number.isInteger(input.index) ||
    input.index < 0 ||
    input.index >= LIMITS.chunks ||
    typeof input.upload_id !== "string" ||
    input.upload_id.length > 200
  ) {
    refuse(
      "size_limit",
      "Chunk must be 1–24 KiB, index 0–119 and upload_id at most 200 characters."
    );
  }
  const [old] = sql
    .exec<{
      content_base64: string;
    }>(
      "SELECT content_base64 FROM upload_chunks WHERE session_id=? AND upload_id=? AND part=?",
      s.id,
      input.upload_id,
      input.index
    )
    .toArray();
  if (old && old.content_base64 !== input.content_base64) {
    refuse(
      "idempotency_key_reused",
      "Chunk index already has different bytes."
    );
  }
  sql.exec(
    "INSERT OR IGNORE INTO upload_chunks(session_id,upload_id,part,content_base64) VALUES(?,?,?,?)",
    s.id,
    input.upload_id,
    input.index,
    input.content_base64
  );
  return {
    upload_id: input.upload_id,
    index: input.index,
    bytes: bytes.length,
    replayed: !!old,
  };
}
export function commitUpload(sql: SqlReader, s: Session, input: Input) {
  if (
    !Number.isInteger(input.chunk_count) ||
    input.chunk_count < 1 ||
    input.chunk_count > LIMITS.chunks
  ) {
    refuse("size_limit", "chunk_count must be 1–120.");
  }
  const chunks = sql
    .exec<{
      part: number;
      content_base64: string;
    }>(
      "SELECT part,content_base64 FROM upload_chunks WHERE session_id=? AND upload_id=? ORDER BY part",
      s.id,
      input.upload_id
    )
    .toArray();
  if (
    chunks.length !== input.chunk_count ||
    chunks.some((c, i) => c.part !== i)
  ) {
    refuse("missing_chunk", "Upload chunks must exactly cover declared count.");
  }
  const bytes = Buffer.concat(
    chunks.map((c) => Buffer.from(c.content_base64, "base64"))
  );
  if (bytes.length > LIMITS.manifestBytes) {
    refuse("size_limit", "Serialized manifest exceeds 2880 KiB.");
  }
  if (hash(bytes) !== input.sha256) {
    refuse("hash_mismatch", "Manifest SHA-256 mismatch.");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
  } catch {
    refuse("validation_error", "Manifest must be UTF-8 JSON.");
  }
  strict(manifest, ["files", "revision"], ["files"]);
  return upload(sql, s, manifest);
}
export function attachments(
  sql: SqlReader,
  s: Session,
  snapshotId: string | undefined,
  paths: string[] | undefined
): InboxAttachment[] {
  if (!paths?.length) {
    return [];
  }
  if (!snapshotId) {
    refuse(
      "validation_error",
      "attachments require snapshot_id; remote paths are never read."
    );
  }
  snapshotOf(sql, s, snapshotId);
  if (paths.length > LIMITS.files) {
    refuse("size_limit", "Too many attachments.");
  }
  const names = new Set<string>();
  return paths.map((path) => {
    safePath(path);
    if (names.has(path)) {
      refuse("validation_error", "Duplicate attachment path.");
    }
    names.add(path);
    const [row] = sql
      .exec<{
        sha256: string;
        size: number;
        mtime: string | null;
      }>(
        "SELECT sha256,size,mtime FROM snapshot_files WHERE snapshot_id=? AND path=?",
        snapshotId,
        path
      )
      .toArray();
    if (!row) {
      refuse("file_not_found", "Attachment is not in the owned snapshot.");
    }
    const error = inboxAttachmentNameRefusal(path);
    if (error) {
      refuse("unsupported_attachment", error);
    }
    const kind = inboxAttachmentKind(path);
    if (!["markdown", "text", "code"].includes(kind)) {
      refuse(
        "unsupported_attachment",
        `${kind} is not enabled in the native prototype; upload bytes remain readable by read_snapshot.`
      );
    }
    if (!isInboxTextBytes(readBlob(sql, row.sha256))) {
      refuse(
        "unsupported_attachment",
        "Attachment must be valid UTF-8 without NUL bytes. Binary bytes remain in the snapshot."
      );
    }
    const at = new Date().toISOString();
    return {
      id: inboxAttachmentId(),
      path,
      named_path: null,
      name: path.slice(path.lastIndexOf("/") + 1),
      kind,
      sent_sha256: row.sha256,
      size: row.size,
      sent_at: at,
      sent_mtime: row.mtime ?? at,
    };
  });
}
