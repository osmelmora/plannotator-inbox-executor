/** Authenticated Executor UI transport. The host selects the reviewer profile. */
import { createAppClient, type OperationReference } from 'apps/client';
import { number, object, string } from 'apps';

type Envelope = { status: number; bodyJson: string };
const output = object({ status: number(), bodyJson: string() });
const query: OperationReference<{ path: string }, Envelope, 'query'> = { name: 'inboxQuery', kind: 'query' };
const mutate: OperationReference<{ path: string; bodyJson: string }, Envelope, 'mutation'> = { name: 'inboxMutate', kind: 'mutation' };
let client: ReturnType<typeof createAppClient> | undefined;

/** No browser credential, profile ID, endpoint, or local machine identity is accepted. */
export async function executorInboxRequest(path: string, body?: Record<string, unknown>): Promise<Envelope> {
  if (!path.startsWith('/api/inbox/')) throw new Error('Unsupported Inbox operation.');
  client ??= createAppClient();
  return body === undefined
    ? client.query(query, { path }, output)
    : client.mutate(mutate, { path, bodyJson: JSON.stringify(body) }, output);
}
