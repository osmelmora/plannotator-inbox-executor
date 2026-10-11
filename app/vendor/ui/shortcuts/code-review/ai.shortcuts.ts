/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import { defineShortcutScope } from "../core.js";
import { createShortcutScopeHook } from "../runtime.js";

export const reviewAiShortcuts = defineShortcutScope({
  id: 'review-ai',
  title: 'AI Assistant',
  shortcuts: {
    submit: {
      description: 'Send message',
      bindings: ['Mod+Enter'],
      section: 'AI Assistant',
      hint: 'Available in the AI tab and the Ask AI inline input.',
      displayOrder: 10,
    },
    cancel: {
      description: 'Cancel inline AI input',
      bindings: ['Escape'],
      section: 'AI Assistant',
      hint: 'Available in the Ask AI inline input.',
      displayOrder: 20,
    },
  },
});

export const useReviewAiShortcuts = createShortcutScopeHook(reviewAiShortcuts);
