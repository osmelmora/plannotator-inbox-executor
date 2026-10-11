/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import { defineShortcutScope } from "../core.js";
import { createShortcutScopeHook } from "../runtime.js";

export const goalSetupShortcuts = defineShortcutScope({
  id: 'goal-setup-surface',
  title: 'Goal Setup',
  shortcuts: {},
});

export const useGoalSetupShortcuts = createShortcutScopeHook(goalSetupShortcuts);
