import { expect, test } from "bun:test";
import type {
  InboxAnnotationRecord,
  InboxAttachmentState,
} from "../app/vendor/core/inbox-types.js";
import {
  attachmentBlocks,
  attachmentFeedback,
  CODE_HIGHLIGHT_MAX_CHARS,
} from "../app/vendor/inbox/attachments.js";

test("raw code stays one literal code block even when it contains Markdown syntax", () => {
  const code = '#!/bin/sh\n# A script comment\nprintf "```markdown"\n';
  const blocks = attachmentBlocks("code", code, "replay.sh");
  expect(blocks).toHaveLength(1);
  expect(blocks[0].type).toBe("code");
  expect(blocks[0].language).toBe("sh");
  expect(blocks[0].content).toBe(code.trimEnd());
  // The same bytes deliberately produce several Markdown blocks in a text attachment.
  expect(
    attachmentBlocks("markdown", "# Heading\n\nParagraph.", "plan.md").map(
      (block) => block.type
    )
  ).toEqual(["heading", "paragraph"]);
});

test("large source files bypass synchronous highlighting at the upstream bound", () => {
  expect(
    attachmentBlocks("code", "x".repeat(CODE_HIGHLIGHT_MAX_CHARS), "app.ts")[0]
      .language
  ).toBe("ts");
  expect(
    attachmentBlocks(
      "code",
      "x".repeat(CODE_HIGHLIGHT_MAX_CHARS + 1),
      "app.ts"
    )[0].language
  ).toBeUndefined();
});

test("annotation feedback identifies immutable sent versions and never drops their filename", () => {
  const attachment = {
    id: "att_one",
    path: "/project/docs/plan.md",
    name: "plan.md",
    kind: "markdown",
  } as InboxAttachmentState;
  const version = "a".repeat(64);
  const annotation = {
    id: "ann_one",
    type: "COMMENT",
    blockId: "block-0",
    originalText: "First draft",
    text: "Keep this immutable.",
    createdAt: Date.now(),
  };
  const record = {
    id: annotation.id,
    attachment_id: attachment.id,
    path: attachment.path,
    version,
    annotation,
  } as unknown as InboxAnnotationRecord;
  const feedback = attachmentFeedback(
    [record],
    [attachment],
    new Map([[`${attachment.id}\0${version}`, "# First draft"]]),
    "/project"
  );
  expect(feedback).toContain("docs/plan.md");
  expect(feedback).toContain("the version you sent");
  expect(feedback).toContain("Keep this immutable.");
});
