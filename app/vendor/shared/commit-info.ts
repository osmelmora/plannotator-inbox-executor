/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
/** Type-only excerpt from upstream packages/shared/commit-history.ts. */
export interface CommitDiffInfo {
  sha: string;
  shortSha: string;
  subject: string;
  /** Full message body (everything after the subject), "" when absent.
   * Rendered as markdown client-side. */
  body: string;
  author: string;
  authorEmail: string;
  /** Committer time, epoch milliseconds. Clients format it themselves —
   * git's `%cr` relative strings are locale-dependent (gettext), so a
   * pre-formatted string couldn't be compacted reliably. */
  committedAt: number;
  /** Author profile image (server-enriched via commit-avatars). */
  avatarUrl?: string;
}
