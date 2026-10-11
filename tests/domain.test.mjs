import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { InboxStore } from '../app/domain/store.ts';
import { InboxError } from '../app/domain/schema.ts';
import { recordAgentDecision, recordDecisionsForReply, replaceDecision, retireDecision, setQuestionDecision } from '../app/domain/decisions.ts';
import { GUIDE_BRIEF_EXAMPLE, checkInboxGuide, describeInboxGuide, inboxGuideInputHash } from '../app/domain/guides.ts';
import { canonicalJson } from '../app/domain/canonical-json.ts';
import { inboxAttachmentId } from '../app/vendor/core/inbox-attachments.ts';
import { FIXTURE_V1_PR } from '../app/vendor/core/guide-format-fixtures.ts';

// Exercise the port with real SQLite transactions and a new store on each call.
function database() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE records (seq INTEGER PRIMARY KEY, line TEXT NOT NULL)');
  let failAt = null;
  const persistence = {
    load: () => db.query('SELECT line FROM records ORDER BY seq').all().map(({ line }) => JSON.parse(line)),
    append(line) {
      if (line.seq === failAt) throw new Error('injected append failure');
      db.query('INSERT INTO records(seq,line) VALUES (?,?)').run(line.seq, JSON.stringify(line));
    },
  };
  const fresh = () => InboxStore.open(persistence);
  return {
    db, persistence, fresh,
    transaction: (f) => db.transaction(() => f(fresh()))(),
    failAt: (seq) => { failAt = seq; },
    close: () => db.close(),
  };
}
const author = (session = 'session-a') => ({ kind: 'agent', host: 'test', session, name: null });
const QUESTION = 'Choose the guard.\n\n:::question\nHow should empty tokens be handled?\n\n- [ ] Reject empty tokens\n- [ ] Allow empty tokens\n:::';
function setup(d, body = QUESTION, extra = {}) {
  return d.transaction((s) => {
    const project = s.ensureProject({ name: 'shared', root: 'project:explicit-shared-mapping' });
    const sent = s.sendMessage({ project_id: project.id, author: author(), body, ...extra });
    return { project, message: sent.message };
  });
}
function entry(question, choice = 0) {
  return { key: question.key, revision: question.revision, answer: {
    v: 1, key: question.key, kind: question.kind, prompt: question.prompt,
    selected: [question.choices[choice].label],
  } };
}
function attachment(kind = 'markdown', path = 'snapshot:owned/docs/review.md') {
  return { id: inboxAttachmentId(), path, named_path: null, name: path.split('/').at(-1), kind,
    sent_sha256: 'a'.repeat(64), size: 42, sent_at: '2026-10-11T00:00:00.000Z', sent_mtime: '2026-10-10T00:00:00.000Z' };
}
function code(error, expected) { expect(error).toBeInstanceOf(InboxError); expect(error.code).toBe(expected); }
function refuses(fn, expected) {
  let failed = false;
  try { fn(); } catch (error) { code(error, expected); failed = true; }
  expect(failed).toBe(true);
}

describe('Executor persistence-neutral Inbox domain', () => {
  test('question picks, Send, sent status and reply survive separate store executions', () => {
    const d = database();
    try {
      const { message } = setup(d);
      const q = d.fresh().questionsOf(message.id)[0];
      expect(q.state).toBe('open');
      d.transaction((s) => s.savePicks(message.id, [entry(q)]));
      const picked = d.fresh().questionsOf(message.id)[0];
      expect(picked.state).toBe('picked');
      expect(picked.revision).toBe(q.revision + 1);
      const reply = d.transaction((s) => s.sendReply(message.id, {
        idempotency_key: 'human-send', questions: [{ key: picked.key, revision: picked.revision }], words: 'Keep the guard explicit.',
      }));
      const reopened = d.fresh();
      expect(reopened.questionsOf(message.id)[0].state).toBe('sent');
      expect(reopened.thread(message.thread_id).messages.at(-1).body).toContain('Reject empty tokens');
      expect(reopened.thread(message.thread_id).messages.at(-1).body).toContain('Keep the guard explicit.');
      expect(reopened.pendingReplies('session-a').map((m) => m.id)).toEqual([reply.reply.id]);
      expect(reopened.pendingReplies('session-b')).toEqual([]);
      expect(reopened.listRow(message.thread_id).section).toBe('sent');
      d.transaction((s) => s.markAgentChecked(message.thread_id));
      expect(d.fresh().listRow(message.thread_id).section).toBe('quiet');
    } finally { d.close(); }
  });

  test('stale revisions and malformed batches write no lines', () => {
    const d = database();
    try {
      const { message } = setup(d);
      const q = d.fresh().questionsOf(message.id)[0];
      const cursor = d.fresh().cursor();
      refuses(() => d.transaction((s) => s.savePicks(message.id, [entry(q), entry(q)])), 'validation_error');
      expect(d.fresh().cursor()).toBe(cursor);
      d.transaction((s) => s.savePicks(message.id, [entry(q)]));
      refuses(() => d.transaction((s) => s.savePicks(message.id, [entry(q)])), 'question_revision_conflict');
      expect(d.fresh().cursor()).toBe(cursor + 1);
    } finally { d.close(); }
  });

  test('agent and human replay remain stable after reload and resolution', () => {
    const d = database();
    try {
      const { message, project } = setup(d, QUESTION, { idempotency_key: 'agent-request' });
      const reply = d.transaction((s) => s.sendReply(message.id, { words: 'Proceed.', idempotency_key: 'reply-request' }));
      d.transaction((s) => s.resolveThread(message.id, true));
      const cursor = d.fresh().cursor();
      const retry = d.transaction((s) => s.sendMessage({ project_id: project.id, author: author(), body: QUESTION, idempotency_key: 'agent-request' }));
      expect(retry.replayed).toBe(true);
      expect(retry.message.id).toBe(message.id);
      const replyRetry = d.transaction((s) => s.sendReply(message.id, { words: 'Proceed.', idempotency_key: 'reply-request' }));
      expect(replyRetry.replayed).toBe(true);
      expect(replyRetry.reply.id).toBe(reply.reply.id);
      expect(d.fresh().cursor()).toBe(cursor);
      refuses(() => d.transaction((s) => s.sendMessage({ project_id: project.id, author: author(), body: 'Changed input', idempotency_key: 'agent-request' })), 'idempotency_key_reused');
    } finally { d.close(); }
  });

  test('named threads can reopen older IDs: caller authorization must use the actual routed ID', () => {
    const d = database();
    try {
      const { message, project } = setup(d, 'first', { thread: '  shared   review ' });
      d.transaction((s) => s.resolveThread(message.id, true));
      const second = d.transaction((s) => s.sendMessage({ project_id: project.id, author: author('session-b'), body: 'second', thread: 'SHARED REVIEW' }));
      expect(second.message.thread_id).not.toBe(message.id);
      d.transaction((s) => { s.resolveThread(second.message.id, true); s.resolveThread(message.id, false); });
      const third = d.transaction((s) => s.sendMessage({ project_id: project.id, author: author('session-c'), body: 'third', thread: 'shared review' }));
      expect(third.message.thread_id).toBe(message.id);
      expect(d.fresh().thread(message.id).messages).toHaveLength(2);
    } finally { d.close(); }
  });

  test('default threads remain distinct per session and explicitly addressed messages stay scoped', () => {
    const d = database();
    try {
      const { message, project } = setup(d, 'A');
      const other = d.transaction((s) => s.sendMessage({ project_id: project.id, author: author('session-b'), body: 'B' })).message;
      expect(other.thread_id).not.toBe(message.thread_id);
      d.transaction((s) => s.sendMessage({ project_id: project.id, author: author('session-b'), reply_to: message.id, body: 'B joins deliberately' }));
      const addressed = d.transaction((s) => s.sendNewMessage(message.id, { body: 'Only A', to: { host: 'test', session: 'session-a' }, idempotency_key: 'addressed' }));
      expect(d.fresh().pendingReplies('session-a').map((m) => m.id)).toEqual([addressed.message.id]);
      expect(d.fresh().pendingReplies('session-b')).toEqual([]);
      refuses(() => d.transaction((s) => s.recordDelivery(addressed.message.id, { host: 'test', session: 'session-b' })), 'validation_error');
      d.transaction((s) => s.recordDelivery(addressed.message.id, { host: 'test', session: 'session-a' }));
      expect(d.fresh().pendingReplies('session-a')).toEqual([]);
    } finally { d.close(); }
  });

  test('Markdown annotations persist, return with replies, and code annotation fails honestly', () => {
    const d = database();
    try {
      const doc = attachment(); const codeFile = attachment('code', 'snapshot:owned/src/auth.ts');
      const { message } = setup(d, 'Review attachments.', { attachments: [doc, codeFile] });
      const annotation = { id: 'annotation-1', type: 'global', text: 'Use the shared AuthError type.' };
      d.transaction((s) => s.saveAnnotation({ attachment_id: doc.id, version: doc.sent_sha256, annotation }));
      expect(d.fresh().pendingAnnotations(message.id)[0].annotation).toEqual(annotation);
      refuses(() => d.transaction((s) => s.saveAnnotation({ attachment_id: codeFile.id, version: 'current', annotation: { ...annotation, id: 'code-annotation' } })), 'validation_error');
      refuses(() => d.transaction((s) => s.saveAnnotation({ attachment_id: doc.id, version: 'b'.repeat(64), annotation: { ...annotation, id: 'wrong-version' } })), 'validation_error');
      const sent = d.transaction((s) => s.sendReply(message.id, { idempotency_key: 'annotation-send', feedback: annotation.text, annotation_ids: [annotation.id] }));
      expect(sent.reply.body).toContain('AuthError');
      expect(d.fresh().pendingAnnotations(message.id)).toEqual([]);
      refuses(() => d.transaction((s) => s.removeAnnotation(annotation.id)), 'annotation_closed');
    } finally { d.close(); }
  });

  test('decision recording, replacement and retirement remain durable and versioned', () => {
    const d = database();
    try {
      const { message, project } = setup(d);
      const q = d.fresh().questionsOf(message.id)[0];
      d.transaction((s) => setQuestionDecision(s, message.id, { key: q.key, recording: true }));
      const { reply } = d.transaction((s) => s.sendReply(message.id, { idempotency_key: 'decision-reply', questions: [entry(q)] }));
      const recorded = d.transaction((s) => recordDecisionsForReply(s, reply.id));
      expect(recorded.refused).toEqual([]);
      expect(recorded.recorded).toHaveLength(1);
      expect(d.transaction((s) => recordDecisionsForReply(s, reply.id)).recorded).toEqual([]);
      const original = recorded.recorded[0];
      const changed = d.transaction((s) => replaceDecision(s, original.id, { version: original.version, text: 'Use an explicit shared error.', reason: 'Consistency' }));
      expect(d.fresh().decision(original.id).state).toBe('replaced');
      expect(changed.decision.replaces_id).toBe(original.id);
      refuses(() => d.transaction((s) => retireDecision(s, changed.decision.id, 0)), 'decision_version_conflict');
      d.transaction((s) => retireDecision(s, changed.decision.id, 1));
      expect(d.fresh().decision(changed.decision.id).state).toBe('retired');
      const input = { project_id: project.id, agent: author(), text: 'Keep snapshots immutable.', idempotency_key: 'decision-agent' };
      const agent = d.transaction((s) => recordAgentDecision(s, input));
      expect(d.transaction((s) => recordAgentDecision(s, input))).toEqual({ decision: agent.decision, replayed: true });
    } finally { d.close(); }
  });

  test('a failed multi-record Send rolls back durably with transaction and succeeds on retry', () => {
    const d = database();
    try {
      const { message } = setup(d);
      const q = d.fresh().questionsOf(message.id)[0];
      const before = d.fresh().cursor();
      d.failAt(before + 2); // fail the reply after persisting its sent-question record
      expect(() => d.transaction((s) => s.sendReply(message.id, { idempotency_key: 'failed-send', questions: [entry(q)] }))).toThrow('injected append failure');
      expect(d.fresh().cursor()).toBe(before);
      expect(d.fresh().questionsOf(message.id)[0].state).toBe('open');
      expect(d.fresh().thread(message.id).messages).toHaveLength(1);
      d.failAt(null);
      d.transaction((s) => s.sendReply(message.id, { idempotency_key: 'failed-send', questions: [entry(q)] }));
      expect(d.fresh().questionsOf(message.id)[0].state).toBe('sent');
      expect(d.fresh().cursor()).toBe(before + 2);
    } finally { d.close(); }
  });

  test('legacy orphan sent-question recovery remains compatible with partial old logs', () => {
    const d = database();
    try {
      const { message } = setup(d);
      const q = d.fresh().questionsOf(message.id)[0];
      d.transaction((s) => s.savePicks(message.id, [entry(q)]));
      const s = d.fresh();
      d.failAt(s.cursor() + 2);
      expect(() => s.sendReply(message.id, { idempotency_key: 'legacy-partial', questions: [{ key: q.key, revision: q.revision + 1 }] })).toThrow();
      expect(d.fresh().questionsOf(message.id)[0].state).toBe('picked');
      expect(d.fresh().pendingReplies('session-a')).toEqual([]);
    } finally { d.close(); }
  });

  test('cursors use durable global sequence, latest changes are ordered, and deletes refuse without mutation', () => {
    const d = database();
    try {
      const { message, project } = setup(d, 'First 😀');
      for (let i = 0; i < 25; i++) d.transaction((s) => s.sendMessage({ project_id: project.id, author: author(i % 2 ? 'session-b' : 'session-a'), body: `message ${i}` }));
      const s = d.fresh(); const before = s.cursor();
      const seqs = d.persistence.load().map((line) => line.seq);
      expect(seqs).toEqual(Array.from({ length: before }, (_, i) => i + 1));
      expect(s.changesSince(0).map((line) => line.seq)).toEqual([...new Set(s.changesSince(0).map((line) => line.seq))].sort((a, b) => a - b));
      refuses(() => d.transaction((s) => s.deleteThread(message.id)), 'unsupported_operation');
      refuses(() => d.transaction((s) => s.deleteProject(project.id)), 'unsupported_operation');
      expect(d.fresh().cursor()).toBe(before);
      const bytes = d.persistence.load().reduce((n, line) => n + new TextEncoder().encode(JSON.stringify(line) + '\n').byteLength, 0);
      expect(s.diskUsage().bytes).toBe(bytes);
      expect(s.diskUsage().dir).toContain('excludes uploads');
    } finally { d.close(); }
  });
});

describe('strict upstream guided reviews', () => {
  test('adapted brief example creates an immutable portable snapshot and accurate byte/hash metadata', () => {
    const checked = checkInboxGuide(GUIDE_BRIEF_EXAMPLE, 'mapping:shared');
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.snapshot.review.rawPatch).toBe(GUIDE_BRIEF_EXAMPLE.patch);
    const described = describeInboxGuide(checked.snapshot, inboxGuideInputHash(GUIDE_BRIEF_EXAMPLE));
    expect(described.ref.files).toBe(2);
    expect(described.ref.bytes).toBe(new TextEncoder().encode(described.text).byteLength);
    expect(described.ref.sha256).toBe(createHash('sha256').update(described.text).digest('hex'));
    expect(checked.snapshot.source).toEqual(GUIDE_BRIEF_EXAMPLE.guide.source);
  });

  test('rejects absent provenance, unknown patch files, duplicate placement and missing patches', () => {
    const noSource = structuredClone(GUIDE_BRIEF_EXAMPLE);
    delete noSource.guide.source;
    expect(checkInboxGuide(noSource, '/would-have-been-host-cwd').error).toContain('explicit guide provenance');
    const unknown = structuredClone(GUIDE_BRIEF_EXAMPLE);
    unknown.guide.sections[0].diffs[0].file = 'not-in-the-patch.ts';
    expect(checkInboxGuide(unknown, 'unused').error).toContain('not-in-the-patch.ts');
    const duplicate = structuredClone(GUIDE_BRIEF_EXAMPLE);
    duplicate.guide.sections.push(structuredClone(duplicate.guide.sections[0]));
    expect(checkInboxGuide(duplicate, 'unused').error).toContain('placed twice');
    expect(checkInboxGuide({ guide: GUIDE_BRIEF_EXAMPLE.guide }, 'unused').ok).toBe(false);
    expect(checkInboxGuide({ ...GUIDE_BRIEF_EXAMPLE, snapshot: {} }, 'unused').ok).toBe(false);
  });

  test('complete historical snapshot keeps its exact patch, time, reviewed state and provenance', () => {
    const checked = checkInboxGuide({ snapshot: FIXTURE_V1_PR }, 'unused');
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.snapshot).toEqual(FIXTURE_V1_PR);
  });

  test('rejects unsupported authored fields and malformed metadata before the upstream builder can strip them', () => {
    for (const mutate of [
      (g) => { g.extra = 'cannot persist'; },
      (g) => { g.sections[0].extra = 'cannot persist'; },
      (g) => { g.sections[0].diffs[0].extra = 'cannot persist'; },
      (g) => { g.review = 3; },
      (g) => { g.review.base = 3; },
      (g) => { g.generator.model = 3; },
      (g) => { g.generator.extra = 'cannot persist'; },
      (g) => { g.source.extra = 'cannot persist'; },
      (g) => { g.source = null; },
    ]) {
      const input = structuredClone(GUIDE_BRIEF_EXAMPLE); mutate(input.guide);
      expect(checkInboxGuide(input, 'unused').ok).toBe(false);
    }
  });

  test('canonical retry hashing ignores object insertion order and preserves meaningful array order', () => {
    const a = { guide: { title: 'T', sections: [{ a: 1, b: 2 }, { c: 3 }], source: { kind: 'local', repo: 'x' } }, patch: 'diff' };
    const b = { patch: 'diff', guide: { source: { repo: 'x', kind: 'local' }, sections: [{ b: 2, a: 1 }, { c: 3 }], title: 'T' } };
    expect(inboxGuideInputHash(a)).toBe(inboxGuideInputHash(b));
    const reordered = structuredClone(b); reordered.guide.sections.reverse();
    expect(inboxGuideInputHash(a)).not.toBe(inboxGuideInputHash(reordered));
    expect(canonicalJson({ a: ['2', '1'], z: null })).toBe('{"a":["2","1"],"z":null}');
  });
});
