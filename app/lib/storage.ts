import type { SqlReader } from "apps";
import { InboxStore, type StorePersistence } from "../domain/store.js";
import type { InboxLine } from "../vendor/core/inbox-types.js";
import { jsonSize, refuse } from "./common.js";
export function openStore(sql: SqlReader): InboxStore {
  const persistence: StorePersistence = {
    load() {
      const { n } = sql
        .exec<{ n: number }>("SELECT count(*) n FROM inbox_events")
        .one();
      if (n > 20_000) {
        refuse(
          "capacity_limit",
          "Prototype event limit exceeded; archival/migration is required."
        );
      }
      return sql
        .exec<{ line: string }>("SELECT line FROM inbox_events ORDER BY seq")
        .toArray()
        .map((r) => JSON.parse(r.line) as InboxLine);
    },
    append(line) {
      jsonSize(line);
      if (line.seq > 20_000) {
        refuse("capacity_limit", "Prototype limit: 20,000 durable events.");
      }
      const r = line.record;
      sql.exec(
        "INSERT INTO inbox_events(seq,kind,record_id,project_id,line) VALUES(?,?,?,?,?)",
        line.seq,
        line.kind,
        line.id,
        "project_id" in r ? r.project_id : r.id,
        JSON.stringify(line)
      );
    },
  };
  return InboxStore.open(persistence);
}
