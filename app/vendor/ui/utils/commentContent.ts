/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import type { ImageAttachment } from "../types.js";

export function hasUnsavedCommentContent(
  text: string,
  images: readonly ImageAttachment[] = [],
): boolean {
  return text.trim().length > 0 || images.length > 0;
}
