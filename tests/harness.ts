import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { grants, projects } from "../app/config.ts";
import { hash } from "../app/lib/common.ts";
import { openStore } from "../app/lib/storage.ts";
import { invoke } from "../app/lib/tools.ts";
import { uiRead, uiWrite } from "../app/lib/ui.ts";
export const A = {
  id: "native-a",
  role: "agent",
  environments: ["native-env-a"],
  projects: ["shared-native", "a-only"],
  accountId: "account-a",
} as const;
export const B = {
  id: "native-b",
  role: "agent",
  environments: ["native-env-b"],
  projects: ["shared-native"],
  accountId: "account-b",
} as const;
export const R = {
  id: "native-reviewer",
  role: "reviewer",
  environments: [],
  projects: ["shared-native", "a-only"],
  accountId: "account-r",
} as const;
export const QUESTION =
  "Please review the token guard.\n\n:::question\nHow should empty tokens be handled?\n\n- [ ] Reject empty tokens\n- [ ] Allow empty tokens\n\nRecommended: Reject empty tokens\n:::";
// In-memory fixtures only: public app configuration remains unconfigured and
// denies every caller until an operator builds an installation-specific copy.
for (const { accountId, ...principal } of [A, B, R]) {
  grants.push({
    ...principal,
    credentialHash: hash(`fixture-only-${principal.id}`),
  });
}
Object.assign(projects, {
  "shared-native": {
    name: "Shared test project",
    root: "executor-project://shared-native",
  },
  "a-only": { name: "Private test project", root: "executor-project://a-only" },
});
export function harness(filename = ":memory:") {
  const db = new Database(filename);
  db.exec(
    readFileSync(
      new URL("../app/migrations/0001_native.sql", import.meta.url),
      "utf8"
    )
      .replaceAll("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ")
      .replaceAll("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ")
  );
  const sql: any = {
    exec(query: string, ...bindings: any[]) {
      const rows = db.query(query).all(...bindings) as any[];
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) {
            throw new Error("Expected one row");
          }
          return rows[0];
        },
        rowsWritten: db.query("SELECT changes() n").get().n,
        rowsRead: rows.length,
        columnNames: rows[0] ? Object.keys(rows[0]) : [],
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
    transaction: (work: () => any) => db.transaction(work)(),
  };
  const tx = (run: (s: ReturnType<typeof openStore>) => any) =>
    sql.transaction(() => run(openStore(sql)));
  return {
    db,
    sql,
    tx,
    call: (p: any, t: string, i: any) =>
      tx((store) => invoke(sql, store, p, t, i)),
    read: (p: any, path: string) => uiRead(sql, openStore(sql), p, path) as any,
    write: (p: any, path: string, body: any) =>
      tx((store) => uiWrite(sql, store, p, path, body)) as any,
    close: () => db.close(),
  };
}
export function setup(
  h: ReturnType<typeof harness>,
  p: any = A,
  thread = "t3-thread-a",
  project = "shared-native"
) {
  return h.call(p, "open_session", {
    environment_id: p.environments[0],
    thread_id: thread,
    project_key: project,
    source_path: "/remote/project",
    agent_name: p.id,
  }).structuredContent.session_id as string;
}
export const send = (
  h: ReturnType<typeof harness>,
  p: any,
  s: string,
  extra: any = {}
) =>
  h.call(p, "send_message", {
    session_id: s,
    body: QUESTION,
    idempotency_key: "send-once",
    ...extra,
  }).structuredContent;
