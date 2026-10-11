import { test, expect } from 'bun:test';
import { Effect } from '../app/node_modules/effect/dist/index.js';
import app from '../app/index.ts';
import { grants } from '../app/config.ts';
import { hash } from '../app/lib/common.ts';
import { toolInputSchema } from '../app/schemas.ts';
import { GUIDE_SCHEMA_JSON, GUIDE_BRIEF_EXAMPLE } from '../app/domain/guides.ts';
import { harness, A, B, R, setup, send } from './harness.ts';

function reply(h, id, body, key) {
  return h.write(R, `/api/inbox/messages/${id}/reply`, { words: body, idempotency_key: key, questions: [] });
}

test('actual bounded-wait wrapper replays a cached receipt without changing later reply state', async () => {
  const h = harness();
  const saved = grants[0].credentialHash;
  // Test-only in-memory grant; no credential files or production settings change.
  const testToken = 'test-only-credential-'.repeat(5);
  grants[0].credentialHash = hash(testToken);
  try {
    const a = setup(h); const asked = send(h, A, a);
    reply(h, asked.message_id, 'First answer', 'human-first');
    const definition = await app.evaluate({});
    const router = definition.tools[Object.getOwnPropertySymbols(definition.tools)[0]];
    const wait = router.children.wait_for_reply;
    const ctx = { sql: h.sql, accounts: { identity: { id: 'unit-test-account', fields: { token: testToken } } }, signal: new AbortController().signal };
    const request = { session_id: a, request_id: 'receipt-old', timeout_seconds: 1 };
    const first = await Effect.runPromise(wait.run(ctx, request));
    expect(first.structuredContent.reply.body).toContain('First answer');
    h.call(A, 'wait_for_reply', { session_id: a, cursor: first.structuredContent.cursor });
    reply(h, asked.message_id, 'Second unread answer', 'human-second');
    const before = h.sql.exec('SELECT max(seq) n FROM inbox_events').one().n;
    const beforeCursor = h.call(A, 'get_reply_cursor', { session_id: a }).structuredContent;
    const retried = await Effect.runPromise(wait.run(ctx, request));
    expect(retried.structuredContent.reply.message_id).toBe(first.structuredContent.reply.message_id);
    expect(h.sql.exec('SELECT max(seq) n FROM inbox_events').one().n).toBe(before);
    expect(h.call(A, 'get_reply_cursor', { session_id: a }).structuredContent).toEqual(beforeCursor);
    expect(h.call(A, 'wait_for_reply', { session_id: a }).structuredContent.reply.body).toContain('Second unread answer');
  } finally {
    grants[0].credentialHash = saved;
    h.close();
  }
});

test('a joined caller cannot read another session addressed human message', () => {
  const h = harness();
  try {
    const a = setup(h); const b = setup(h, B, 'b-join'); const asked = send(h, A, a);
    const invite = h.call(A, 'create_join_token', { session_id: a, thread_id: asked.thread_id, idempotency_key: 'invite-review' }).structuredContent;
    h.call(B, 'join_thread', { session_id: b, join_token: invite.join_token });
    h.tx((store) => store.sendNewMessage(asked.thread_id, { body: 'Addressed only to A', idempotency_key: 'addressed-review', to: { host: 't3', session: a } }));
    const aThread = h.call(A, 'read_thread', { session_id: a, thread_id: asked.thread_id }).structuredContent.thread;
    const bThread = h.call(B, 'read_thread', { session_id: b, thread_id: asked.thread_id }).structuredContent.thread;
    expect(aThread.messages.some((message) => message.body === 'Addressed only to A')).toBe(true);
    expect(bThread.messages.some((message) => message.body === 'Addressed only to A')).toBe(false);
  } finally { h.close(); }
});

test('reviewer UI read and writes enforce project grants independently of agent membership', () => {
  const h = harness();
  try {
    const a = setup(h, A, 'private-review', 'a-only'); const asked = send(h, A, a);
    const sharedReviewer = { ...R, id: 'reviewer-shared-only', projects: ['shared-native'] };
    expect(() => h.read(sharedReviewer, `/api/inbox/threads/${asked.thread_id}`)).toThrow();
    expect(() => h.write(sharedReviewer, `/api/inbox/messages/${asked.message_id}/reply`, { idempotency_key: 'deny-reviewer', words: 'Forbidden' })).toThrow();
    expect(h.read(sharedReviewer, '/api/inbox/events?cursor=0').events).toEqual([]);
    expect(h.read(sharedReviewer, '/api/inbox/threads').projects).toEqual([]);
  } finally { h.close(); }
});

test('settings storage summary reports actual permitted event bytes rather than zero', () => {
  const h = harness();
  try {
    const privateSession = setup(h, A, 'storage-private', 'a-only'); send(h, A, privateSession);
    const sharedSession = setup(h, A, 'storage-shared'); send(h, A, sharedSession);
    const sharedReviewer = { ...R, id: 'reviewer-shared-only', projects: ['shared-native'] };
    const storage = h.read(sharedReviewer, '/api/inbox/settings').store;
    expect(storage.bytes).toBeGreaterThan(0);
    expect(storage.projects).toHaveLength(1);
    expect(storage.projects[0].root).toBe('executor-project://shared-native');
    expect(storage.dir).toContain('excludes');
  } finally { h.close(); }
});

test('the actual Executor JSON-schema validator accepts the adapted guide brief example', () => {
  const schema = toolInputSchema({ inputSchema: JSON.parse(GUIDE_SCHEMA_JSON) });
  expect(schema.parse(GUIDE_BRIEF_EXAMPLE.guide)).toEqual(GUIDE_BRIEF_EXAMPLE.guide);
  expect(() => schema.parse({ ...GUIDE_BRIEF_EXAMPLE.guide, source: null })).toThrow();
  expect(() => schema.parse({ ...GUIDE_BRIEF_EXAMPLE.guide, forged_metadata: 'ignored?' })).toThrow();
});

test('chunked uploads reject explicit null revision exactly as the direct tool schema does', () => {
  const h = harness();
  try {
    const a = setup(h);
    const bytes = Buffer.from(JSON.stringify({ files: [{ path: 'readme.md', encoding: 'utf8', content: '# Plan' }], revision: null }));
    h.call(A, 'upload_snapshot_chunk', { session_id: a, upload_id: 'null-revision', index: 0, content_base64: bytes.toString('base64') });
    expect(() => h.call(A, 'commit_snapshot_upload', { session_id: a, upload_id: 'null-revision', chunk_count: 1, sha256: hash(bytes) })).toThrow();
    expect(h.sql.exec('SELECT count(*) n FROM snapshots').one().n).toBe(0);
    expect(h.sql.exec('SELECT count(*) n FROM blobs').one().n).toBe(0);
  } finally { h.close(); }
});
