/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
export * from "./core.js";
export * from "./runtime.js";
export { historyShortcuts, useHistoryShortcuts } from "./history.shortcuts.js";
export { decisionControlShortcuts } from "./decisionControl.shortcuts.js";

// plan-review scopes
export { annotationModeShortcuts, useAnnotationModeShortcuts } from "./plan-review/annotationMode.shortcuts.js";
export { annotationToolbarShortcuts, useAnnotationToolbarShortcuts } from "./plan-review/annotationToolbar.shortcuts.js";
export { annotationPanelShortcuts, useAnnotationPanelShortcuts } from "./plan-review/annotationPanel.shortcuts.js";
export { commentPopoverShortcuts } from "./plan-review/commentPopover.shortcuts.js";
export { imageAnnotatorShortcuts, useImageAnnotatorShortcuts } from "./plan-review/imageAnnotator.shortcuts.js";
export { inputMethodShortcuts } from "./plan-review/inputMethod.shortcuts.js";
export { htmlAnnotateShortcuts, useHtmlAnnotateShortcuts } from "./plan-review/htmlAnnotate.shortcuts.js";
export { viewerShortcuts, useViewerShortcuts } from "./plan-review/viewer.shortcuts.js";
export { documentViewShortcuts, useDocumentViewShortcuts } from "./plan-review/documentView.shortcuts.js";
export {
  describeVimSelectionAction,
  isVimSelectionActionId,
  vimSelectionShortcuts,
  useVimSelectionShortcuts,
} from "./plan-review/vimSelection.shortcuts.js";
export type {
  VimSelectionActionId,
  VimSelectionHudContext,
} from "./plan-review/vimSelection.shortcuts.js";
export { goalSetupShortcuts, useGoalSetupShortcuts } from "./plan-review/goalSetup.shortcuts.js";
export { annotateSidebarShortcuts, useAnnotateSidebarShortcuts } from "./plan-review/sidebar.shortcuts.js";

// code-review scopes
export { reviewAnnotationToolbarShortcuts, useReviewAnnotationToolbarShortcuts } from "./code-review/annotationToolbar.shortcuts.js";
export { reviewFileTreeShortcuts, useReviewFileTreeShortcuts } from "./code-review/fileTree.shortcuts.js";
export { reviewPrCommentsShortcuts, useReviewPrCommentsShortcuts } from "./code-review/prComments.shortcuts.js";
export { reviewAllFilesDiffShortcuts, useReviewAllFilesDiffShortcuts } from "./code-review/allFilesDiff.shortcuts.js";
export { reviewAiShortcuts, useReviewAiShortcuts } from "./code-review/ai.shortcuts.js";
export { reviewSuggestionModalShortcuts, useReviewSuggestionModalShortcuts } from "./code-review/suggestionModal.shortcuts.js";
export { reviewTourDialogShortcuts, useReviewTourDialogShortcuts } from "./code-review/tourDialog.shortcuts.js";
