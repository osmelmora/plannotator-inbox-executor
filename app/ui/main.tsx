import React from "react";
import { createRoot } from "react-dom/client";
import { inboxApi } from "../vendor/inbox/api.js";
import { InboxApp } from "../vendor/inbox/index.js";
import styles from "./styles.js";

const stylesheet = document.createElement("style");
stylesheet.dataset.plannotatorTheme = "upstream";
stylesheet.textContent = styles;
document.head.appendChild(stylesheet);

// Persist the host-issued app origin for agent links using the authenticated
// reviewer mutation. Deliberately omit profile query parameters and thread hashes.
inboxApi.registerLocation(`${window.location.origin}/`).catch(() => {
  const banner = document.getElementById("location-registration-failed");
  if (banner) {
    banner.hidden = false;
  }
  console.warn(
    "Inbox location registration failed; agent links may be relative until the page reloads."
  );
});

// Executor rejects writes from a page built against an obsolete deployment.
// Ask the user to reload explicitly rather than silently discarding a draft.
window.addEventListener("executor:deployment-changed", () => {
  const banner = document.getElementById("deployment-changed");
  if (banner) {
    banner.hidden = false;
  }
});

// biome-ignore lint/style/useReactFunctionComponents: React error boundaries require getDerivedStateFromError on a class component.
class SurfaceBoundary extends React.Component<
  { children: React.ReactNode },
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    return {
      error:
        error instanceof Error ? error.message : "The Inbox could not render.",
    };
  }
  render() {
    return this.state.error ? (
      <main role="alert" style={{ padding: 32 }}>
        The Inbox could not render: {this.state.error}
      </main>
    ) : (
      this.props.children
    );
  }
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("The Inbox root element is missing.");
}
createRoot(root).render(
  <SurfaceBoundary>
    <InboxApp />
  </SurfaceBoundary>
);
