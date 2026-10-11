/** Small host-compiled entry: credentials/context stay in Executor's supported client. */
import { executorInboxRequest } from './executor-transport.js';

declare global {
  interface Window {
    executorNativeInboxRequest: typeof executorInboxRequest;
  }
}
window.executorNativeInboxRequest = executorInboxRequest;
// This relative resource is an app-owned public asset, emitted reproducibly
// from the retained upstream React source by scripts/build-ui.mjs.
const moduleUrl = new URL('inbox-bundle.js', document.baseURI).href;
import(/* @vite-ignore */ moduleUrl).catch(error => {
  const root = document.getElementById('root');
  if (root) { root.setAttribute('role', 'alert'); root.textContent = `The Inbox UI could not load: ${String(error)}`; }
});
