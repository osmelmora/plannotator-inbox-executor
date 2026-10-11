import { expect, test } from 'bun:test';
import { harness, A, B, R, send, setup } from './harness.ts';
import { Effect } from '../app/node_modules/effect/dist/index.js';
import app from '../app/index.ts';
import { grants } from '../app/config.ts';
import { hash } from '../app/lib/common.ts';

test('reviewer reply receipt retries preserve upstream replay marker after resolution without writing', () => {
  const h = harness();
  try {
    const session = setup(h);
    const sent = send(h, A, session);
    const path = `/api/inbox/messages/${sent.message_id}/reply`;
    const request = { words: 'Reviewed and accepted.', questions: [], idempotency_key: 'reviewer-retry' };
    const first = h.write(R, path, request);
    expect(first.replayed).toBe(false);
    h.write(R, `/api/inbox/messages/${sent.message_id}/resolve`, { resolved: true });
    const cursor = h.tx(store => store.cursor());
    const retried = h.write(R, path, { ...request, questions: [] });
    expect(retried.reply.id).toBe(first.reply.id);
    expect(retried.replayed).toBe(true);
    expect(h.tx(store => store.cursor())).toBe(cursor);
    expect(() => h.write(R, path, { ...request, words: 'Changed answer.' })).toThrow('Same retry key has different arguments.');
    expect(h.tx(store => store.cursor())).toBe(cursor);
  } finally { h.close(); }
});

test('same-path same-hash annotations remain owned by their original durable thread', () => {
  const h = harness();
  try {
    const messages = [A, B].map(principal => {
      const session = setup(h, principal, `annotation-thread-${principal.id}`);
      const snapshot = h.call(principal, 'upload_snapshot', {
        session_id: session,
        files: [{ path: 'docs/review.md', encoding: 'utf8', content: '# Identical immutable bytes' }],
      }).structuredContent;
      return send(h, principal, session, { snapshot_id: snapshot.snapshot_id, attachments: ['docs/review.md'] });
    });
    const [a, b] = messages;
    const fileA = h.read(R, `/api/inbox/attachments/${a.attachments[0].id}/view`).attachment;
    const fileB = h.read(R, `/api/inbox/attachments/${b.attachments[0].id}/view`).attachment;
    expect(fileA.path).toBe('docs/review.md');
    expect(fileA.sent_sha256).toHaveLength(64);
    expect(fileA.path).toBe(fileB.path);
    expect(fileA.sent_sha256).toBe(fileB.sent_sha256);
    const annotation = { id: 'review-owned-annotation', type: 'global_comment', text: 'Only this thread.' };
    h.write(R, '/api/inbox/annotations', { attachment_id: fileA.id, version: fileA.sent_sha256, annotation });
    const before = h.tx(store => store.cursor());
    expect(() => h.write(R, '/api/inbox/annotations', { attachment_id: fileB.id, version: fileB.sent_sha256, annotation })).toThrow('already used on another file or version');
    expect(() => h.write(R, `/api/inbox/messages/${b.message_id}/reply`, {
      words: 'Do not carry a foreign annotation.', annotation_ids: [annotation.id], idempotency_key: 'foreign-annotation',
    })).toThrow('no such annotation in this thread');
    expect(h.tx(store => store.cursor())).toBe(before);
    expect(h.read(R, `/api/inbox/threads/${a.thread_id}/attachments`).annotations.map((r: any) => r.id)).toEqual([annotation.id]);
    expect(h.read(R, `/api/inbox/threads/${b.thread_id}/attachments`).annotations).toEqual([]);
  } finally { h.close(); }
});

test('actual UI operation wrappers retain upstream statuses and deny agent enumeration before lookup', async () => {
  const h = harness();
  const reviewer = grants.find(g => g.role === 'reviewer')! as unknown as { credentialHash: string; projects: string[] };
  const agent = grants.find(g => g.id === A.id)! as unknown as { credentialHash: string };
  const savedReviewer = reviewer.credentialHash;
  const savedAgent = agent.credentialHash;
  const savedProjects = reviewer.projects;
  const token = 'test-only-reviewer-wrapper';
  const agentToken = 'agent-wrapper-test-only';
  reviewer.credentialHash = hash(token);
  agent.credentialHash = hash(agentToken);
  try {
    const session = setup(h);
    const sent = send(h, A, session);
    const privateSession = setup(h, A, 'ui-review-private', 'a-only');
    const privateSent = send(h, A, privateSession);
    const definition = await app.evaluate({});
    const router = (definition.tools as any)[Object.getOwnPropertySymbols(definition.tools)[0]!];
    const context = (credential: string) => ({ sql: h.sql, accounts: { identity: { id: 'test-ui-account', fields: { token: credential } } }, signal: new AbortController().signal });
    const run = (name: string, input: object, credential = token): Promise<any> => Effect.runPromise(router.children[name].run(context(credential), input));
    const missing = '/api/inbox/threads/msg_missing_review_case';
    const absent = await run('inboxQuery', { path: missing });
    expect(absent.status).toBe(404);
    expect(JSON.parse(absent.bodyJson).code).toBe('message_not_found');
    for (const path of [missing, `/api/inbox/threads/${sent.thread_id}`]) {
      const denied = await run('inboxQuery', { path }, agentToken);
      expect(denied.status).toBe(403);
      expect(JSON.parse(denied.bodyJson).code).toBe('forbidden');
    }
    reviewer.projects = ['shared-native'];
    const foreign = await run('inboxQuery', { path: `/api/inbox/threads/${privateSent.thread_id}` });
    expect(foreign.status).toBe(403);
    expect(JSON.parse(foreign.bodyJson)).toEqual({ code: 'forbidden', error: 'Project is not authorized for this reviewer.' });
    const q = h.read(R, `/api/inbox/threads/${sent.thread_id}`).thread.messages[0].questions[0];
    const before = h.tx(store => store.cursor());
    const stale = await run('inboxMutate', { path: `/api/inbox/messages/${sent.message_id}/picks`, bodyJson: JSON.stringify({ questions: [{ key: q.key, revision: q.revision + 1, answer: null }] }) });
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.bodyJson).code).toBe('question_revision_conflict');
    expect(h.tx(store => store.cursor())).toBe(before);
    const unsupported = await run('inboxMutate', { path: '/api/inbox/restart', bodyJson: '{}' });
    expect(unsupported.status).toBe(501);
    const malformed = await run('inboxMutate', { path: '/api/inbox/settings', bodyJson: '{' });
    expect(malformed.status).toBe(422);
    expect(JSON.parse(malformed.bodyJson).code).toBe('validation_error');
  } finally {
    reviewer.credentialHash = savedReviewer;
    reviewer.projects = savedProjects;
    agent.credentialHash = savedAgent;
    h.close();
  }
});
