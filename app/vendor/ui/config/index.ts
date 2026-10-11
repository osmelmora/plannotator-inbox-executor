/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
export { configStore } from "./configStore.js";
export type { ServerSyncFn } from "./configStore.js";
export { useConfigValue } from "./useConfig.js";
export {
  setReviewPanelView,
  setReviewDefaultDiffType,
  getPersistedReviewPanelView,
  setReviewAutoViewed,
  needsAutoViewedNotice,
  markAutoViewedNoticeSeen,
  type ReviewDefaultDiffType,
} from "./reviewView.js";
