/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
export {
  DEFAULT_BRIDGE_READY_TIMEOUT_MS,
  HtmlViewer,
  formatBridgeUnavailableMessage,
  type BridgeUnavailableInfo,
  type HtmlViewerProps,
} from "./HtmlViewer.js";
export { BRIDGE_PROTOCOL_VERSION } from "./bridge-script.js";
export {
  checkBridgeProtocolVersion,
  formatBridgeProtocolWarning,
  type BridgeProtocolVerdict,
} from "./useHtmlAnnotation.js";
export {
  buildPersistedHtmlAnchor,
  projectHostThreads,
  type BuildPersistedHtmlAnchorOptions,
  type HostThread,
  type PersistedHtmlAnchor,
  type PersistedHtmlAnchorResult,
  type ProjectHostThreadsOptions,
} from "./hostThreads.js";
