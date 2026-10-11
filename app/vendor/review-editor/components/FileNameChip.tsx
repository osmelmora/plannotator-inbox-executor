/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import React from 'react';
import { fileBasename } from "../utils/fileName.js";

/**
 * Compact chip showing a file's name (basename) with the full path on hover.
 * Shared label for file-scoped annotations across the comment banner, sidebar,
 * and AI tab so the "which file" marker stays visually consistent everywhere.
 */
export const FileNameChip: React.FC<{ path: string }> = ({ path }) => (
  <span
    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary truncate max-w-[180px]"
    title={path}
  >
    {fileBasename(path)}
  </span>
);
