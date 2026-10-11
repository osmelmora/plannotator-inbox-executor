/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import { defineShortcutScope } from "../core.js";
import { createShortcutScopeHook } from "../runtime.js";

export const reviewTourDialogShortcuts = defineShortcutScope({
  id: 'review-tour-dialog',
  title: 'Tour Dialog',
  shortcuts: {
    close: {
      description: 'Close tour',
      bindings: ['Escape'],
      section: 'Tour',
      hint: 'Available while the code tour dialog is open.',
      displayOrder: 10,
    },
  },
});

export const useReviewTourDialogShortcuts = createShortcutScopeHook(reviewTourDialogShortcuts);
