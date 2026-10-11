/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import { defineShortcutScope } from "../core.js";
import { createShortcutScopeHook } from "../runtime.js";

export const reviewSuggestionModalShortcuts = defineShortcutScope({
  id: 'review-suggestion-modal',
  title: 'Suggestion Editor',
  shortcuts: {
    indent: {
      description: 'Indent (insert spaces)',
      bindings: ['Tab'],
      section: 'Suggestion Editor',
      hint: 'Available in the expanded suggestion editor.',
      displayOrder: 10,
    },
    close: {
      description: 'Close suggestion editor',
      bindings: ['Escape'],
      section: 'Suggestion Editor',
      hint: 'Closes the modal; suggestion text is preserved on the underlying comment.',
      displayOrder: 20,
    },
  },
});

export const useReviewSuggestionModalShortcuts = createShortcutScopeHook(reviewSuggestionModalShortcuts);
