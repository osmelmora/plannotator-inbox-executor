import type { SqlReader } from "apps";
import { grants, projects } from "../config.js";
import type { InboxStore } from "../domain/store.js";
import { hash, type Input, refuse } from "./common.js";
export interface Principal {
  accountId: string;
  environments: readonly string[];
  id: string;
  projects: readonly string[];
  role: "agent" | "reviewer";
}
// biome-ignore lint/style/useConsistentTypeDefinitions: Executor SQL rows require the implicit index signature of a type alias.
export type Session = {
  agent_name: string | null;
  created_at: string;
  environment_id: string;
  id: string;
  origin_thread: string;
  principal_id: string;
  project_id: string;
  project_key: string;
  source_path: string;
};
export function authenticate(account: {
  id: string;
  fields: { token: string };
}): Principal {
  const match = grants.find(
    (g) => g.credentialHash === hash(account.fields.token)
  );
  if (!match) {
    refuse(
      "unauthorized",
      "Selected Executor account has no native Inbox grant."
    );
  }
  return { ...match, accountId: account.id };
}
export function requireAgent(p: Principal) {
  if (p.role !== "agent") {
    refuse("forbidden", "This operation requires an agent profile.");
  }
}
export function requireReviewer(p: Principal) {
  if (p.role !== "reviewer") {
    refuse("forbidden", "Human UI actions require a reviewer profile.");
  }
}
export function sessionOf(sql: SqlReader, p: Principal, id: string): Session {
  requireAgent(p);
  const [s] = sql
    .exec<Session>(
      "SELECT * FROM sessions WHERE id=? AND principal_id=?",
      id,
      p.id
    )
    .toArray();
  if (
    !(
      s &&
      p.environments.includes(s.environment_id) &&
      p.projects.includes(s.project_key)
    )
  ) {
    refuse("forbidden", "Session is not authorized for this credential.");
  }
  return s;
}
export function checkMetadata(s: Session, input: Input) {
  if (
    input.project_path !== undefined &&
    input.project_path !== s.source_path
  ) {
    refuse(
      "validation_error",
      "project_path must match registered source_path."
    );
  }
  if (
    input.agent_session !== undefined &&
    input.agent_session !== s.origin_thread
  ) {
    refuse(
      "validation_error",
      "agent_session must match registered originating T3 thread."
    );
  }
}
export function member(
  sql: SqlReader,
  store: InboxStore,
  s: Session,
  id: string
): string {
  const m = store.message(id);
  if (!m) {
    refuse("forbidden", "Thread or message is not authorized.");
  }
  if (
    m.project_id !== s.project_id ||
    !sql
      .exec(
        "SELECT 1 FROM memberships WHERE session_id=? AND thread_id=?",
        s.id,
        m.thread_id
      )
      .toArray().length
  ) {
    refuse("forbidden", "Thread or message is not authorized.");
  }
  return m.thread_id;
}
export function reviewerProject(
  p: Principal,
  store: InboxStore,
  projectId: string
) {
  requireReviewer(p);
  const project = store.project(projectId);
  if (
    !(
      project &&
      p.projects.some(
        (k) => projects[k as keyof typeof projects]?.root === project.root
      )
    )
  ) {
    refuse("forbidden", "Project is not authorized for this reviewer.");
  }
}
export function reviewerMessage(p: Principal, store: InboxStore, id: string) {
  const m = store.message(id);
  if (!m) {
    refuse("message_not_found", "No such message.");
  }
  reviewerProject(p, store, m.project_id);
  return m;
}
