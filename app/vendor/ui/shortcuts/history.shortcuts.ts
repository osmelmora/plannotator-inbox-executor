/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import { defineShortcutScope } from "./core.js";
import { createShortcutScopeHook } from "./runtime.js";

export const historyShortcuts = defineShortcutScope({
  id: 'history',
  title: 'History',
  shortcuts: {
    undo: {
      description: 'Undo annotation change',
      bindings: ['Mod+Z'],
      section: 'History',
      preventDefault: true,
      displayOrder: 10,
    },
    redo: {
      description: 'Redo annotation change',
      bindings: ['Mod+Shift+Z', 'Mod+Y'],
      section: 'History',
      preventDefault: true,
      displayOrder: 20,
    },
  },
});

export const useHistoryShortcuts = createShortcutScopeHook(historyShortcuts);
