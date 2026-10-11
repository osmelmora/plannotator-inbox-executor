/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import type { CodeNavRequest } from "../../shared/code-nav.js";
import type { DiffTokenEventBaseProps } from '@pierre/diffs';
import { detectLanguage } from "./detectLanguage.js";
import { stitchTokenIdentifier } from "./stitchTokenIdentifier.js";

export function buildCodeNavRequest(
  props: DiffTokenEventBaseProps,
  filePath: string,
): CodeNavRequest {
  return {
    symbol: props.tokenText,
    filePath,
    line: props.lineNumber,
    charStart: props.lineCharStart,
    side: props.side === 'additions' ? 'new' : 'old',
    language: detectLanguage(filePath),
  };
}

/**
 * The hover variant. Cmd+click resolves the token the user aimed at; hover has
 * no such aim, so it stitches the fragmented spans back into one identifier
 * first and declines (null) for anything that is not a symbol worth searching.
 */
export function buildTokenHoverRequest(
  props: DiffTokenEventBaseProps,
  filePath: string,
): CodeNavRequest | null {
  const stitched = stitchTokenIdentifier(props.tokenElement);
  if (!stitched) return null;
  return {
    ...buildCodeNavRequest(props, filePath),
    symbol: stitched.symbol,
    charStart: stitched.charStart,
  };
}
