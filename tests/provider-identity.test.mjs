import { expect, test } from "bun:test";
import app from "../app/index.ts";

// Resolve the public host API from the app's own pinned framework dependency.
const { createAppHandler, hostContext } = await import(
  import.meta.resolve(
    "apps/host",
    new URL("../app/index.ts", import.meta.url).href
  )
);

test("published account provider retains its original content-addressed identity", async () => {
  const response = await createAppHandler(app)(
    new Request("https://fixture.example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "requirements" }),
    }),
    hostContext({})
  );
  expect(response.status).toBe(200);
  const requirements = await response.json();
  expect(requirements.ok).toBe(true);
  // Executor fingerprints the entire declaration, including its display labels.
  expect(requirements.value.accounts).toEqual({
    identity: {
      definition: {
        name: "Native Inbox credential",
        auth: {
          credential: {
            type: "secrets",
            label: "Scoped native Inbox credential",
            fields: {
              type: "object",
              properties: { token: { type: "string", minLength: 32 } },
              required: ["token"],
              additionalProperties: true,
              $defs: {},
              $schema: "https://json-schema.org/draft/2020-12/schema",
            },
          },
        },
      },
      cardinality: "one",
    },
  });
});
