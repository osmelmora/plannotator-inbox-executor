# Synthetic review material

These files demonstrate the small review flow exercised on the original Cloud deployment. They contain no live session, account, project, or deployment identifiers.

- `snapshot.json`: input for `upload_snapshot`, including the exact text files and a five-byte binary example.
- `message.json`: input for `send_message`, attaching the document and code to a choice question.
- `guide.json`: input for `submit_guide`, referring to the uploaded exact patch.
- `review/`: readable source material used in the snapshot.

Replace `REPLACE_SESSION_ID`, `REPLACE_SNAPSHOT_ID`, and `REPLACE_MESSAGE_ID` with values returned by **your** installation. `fixture-before` and `fixture-after` are deliberately synthetic revision labels, not Git commits; agents reviewing real code should capture real revision metadata and current uncommitted bytes.

Read [the walkthrough](../docs/round-trip.md) for tool discovery, human interaction, replies, cursors, deduplication, and isolation checks. Inspect the live tool schemas before calling them.
