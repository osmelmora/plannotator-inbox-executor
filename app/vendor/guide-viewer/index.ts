/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
export type { DiffFile, DiffFileStatus } from "./types.js";
export { parseDiffToFiles } from "./diffParser.js";
export { renderInlineMarkdown } from "./renderInlineMarkdown.js";
export { renderMarkdownProse } from "./renderMarkdownProse.js";
export {
  GuideHostProvider,
  useGuideHost,
  type GuideHostValue,
  type GuideDiffRendererProps,
  type GuideDiffRendererContext,
  type GuideRevealTarget,
  type GuideActiveSearchMatch,
} from "./host.js";
export { GuideView, resolveGuideSectionFiles } from "./GuideView.js";
export { GuideSectionCard } from "./GuideSectionCard.js";
export { GuideFileCard, estimateDiffHeight } from "./GuideFileCard.js";
export { GuideViewportProvider, useGuideFileWindow, GUIDE_MAX_MOUNTED_CODE_VIEWS } from "./GuideViewportManager.js";
export { GuideSectionSkeleton } from "./GuideSkeleton.js";
export { GuideViewer, type GuideViewerProps } from "./GuideViewer.js";
