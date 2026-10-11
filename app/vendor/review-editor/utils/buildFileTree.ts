/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
/**
 * The review's file-tree builder now lives in @plannotator/ui so hosts can embed
 * the same tree (`@plannotator/ui/components/DiffFileTree`). This module keeps
 * the review's historical names and binds the node type to the review's
 * DiffFile, so every review call site is unchanged.
 */
import type { DiffFile } from "../types.js";
import type { DiffFileTreeNode } from "../../ui/utils/diffFileTree.js";

export {
  buildDiffFileTree as buildFileTree,
  getAncestorPaths,
  getVisualFileOrder,
  getAllFolderPaths,
} from "../../ui/utils/diffFileTree.js";

export type FileTreeNode = DiffFileTreeNode<DiffFile>;
