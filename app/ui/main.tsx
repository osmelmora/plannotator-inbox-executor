import React from 'react';
import { createRoot } from 'react-dom/client';
import { InboxApp } from '../vendor/inbox/index.js';
import { inboxApi } from '../vendor/inbox/api.js';
import styles from './styles.js';

const stylesheet = document.createElement('style');
stylesheet.dataset.plannotatorTheme = 'upstream';
stylesheet.textContent = styles;
document.head.appendChild(stylesheet);

// Persist the host-issued app origin for agent links using the authenticated
// reviewer mutation. Deliberately omit profile query parameters and thread hashes.
void inboxApi.registerLocation(`${window.location.origin}/`).catch(() => {
  const banner = document.getElementById('location-registration-failed');
  if (banner) banner.hidden = false;
  console.warn('Inbox location registration failed; agent links may be relative until the page reloads.');
});

// Executor rejects writes from a page built against an obsolete deployment.
// Ask the user to reload explicitly rather than silently discarding a draft.
window.addEventListener('executor:deployment-changed', () => {
  const banner = document.getElementById('deployment-changed');
  if (banner) banner.hidden = false;
});

class SurfaceBoundary extends React.Component<{ children: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : 'The Inbox could not render.' };
  }
  render() {
    return this.state.error
      ? <main style={{ padding: 32 }} role="alert">The Inbox could not render: {this.state.error}</main>
      : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<SurfaceBoundary><InboxApp /></SurfaceBoundary>);
