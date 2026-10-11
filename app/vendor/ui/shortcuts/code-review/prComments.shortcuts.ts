/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import { defineShortcutScope } from "../core.js";
import { createShortcutScopeHook } from "../runtime.js";

export const reviewPrCommentsShortcuts = defineShortcutScope({
  id: 'review-pr-comments',
  title: 'PR Comments',
  shortcuts: {
    focusSearch: {
      description: 'Focus PR comments search',
      bindings: ['Mod+Shift+F'],
      section: 'PR Comments',
      hint: 'Available while the PR Comments tab is open in the review sidebar.',
      displayOrder: 10,
    },
  },
});

export const useReviewPrCommentsShortcuts = createShortcutScopeHook(reviewPrCommentsShortcuts);
