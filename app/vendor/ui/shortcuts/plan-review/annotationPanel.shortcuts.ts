/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import { defineShortcutScope } from "../core.js";
import { createShortcutScopeHook } from "../runtime.js";

export const annotationPanelShortcuts = defineShortcutScope({
  id: 'annotation-panel',
  title: 'Annotation Panel',
  shortcuts: {
    saveEdit: {
      description: 'Save annotation edit',
      bindings: ['Mod+Enter'],
      section: 'Annotations',
      hint: 'Available while editing an annotation in the side panel.',
      displayOrder: 50,
    },
    cancelEdit: {
      description: 'Cancel annotation edit',
      bindings: ['Escape'],
      section: 'Annotations',
      hint: 'Available while editing an annotation in the side panel.',
      displayOrder: 60,
    },
  },
});

export const useAnnotationPanelShortcuts = createShortcutScopeHook(annotationPanelShortcuts);
