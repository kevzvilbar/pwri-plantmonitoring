import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

type Props = { children: React.ReactNode };
type State = { error: Error | null; didAutoReload: boolean };

// Detects the "Failed to fetch dynamically imported module" error that
// GitHub Pages throws after a new deployment replaces chunk filenames.
function isChunkLoadError(err: Error): boolean {
  const msg = err?.message ?? '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading') ||
    msg.includes('dynamically imported module')
  );
}

// Session-storage key so we only auto-reload ONCE per chunk error.
// Without this guard, a genuine bug would trigger an infinite reload loop.
const RELOAD_FLAG = 'pwri_chunk_reload_attempted';

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, didAutoReload: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);

    if (isChunkLoadError(error)) {
      const alreadyTried = sessionStorage.getItem(RELOAD_FLAG) === '1';
      if (!alreadyTried) {
        // Mark that we tried so we don't loop on a genuine missing file.
        sessionStorage.setItem(RELOAD_FLAG, '1');
        // Hard reload fetches the new index.html and correct chunk filenames.
        window.location.reload();
      } else {
        this.setState({ didAutoReload: true });
      }
    }
  }

  handleRetry = () => {
    const { error } = this.state;
    if (error && isChunkLoadError(error)) {
      // For chunk errors, clear the flag and force a hard reload.
      sessionStorage.removeItem(RELOAD_FLAG);
      window.location.reload();
    } else {
      // For other errors, just reset the boundary and let React re-render.
      this.setState({ error: null, didAutoReload: false });
    }
  };

  handleDashboard = () => {
    sessionStorage.removeItem(RELOAD_FLAG);
    window.location.href = '/pwri-plantmonitoring/';
  };

  render() {
    const { error, didAutoReload } = this.state;
    if (!error) return this.props.children;

    const isChunk = isChunkLoadError(error);

    return (
      <div className="min-h-[50vh] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-rose-100 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-rose-600" />
          </div>
          <h2 className="text-lg font-semibold">Something went wrong</h2>

          {isChunk ? (
            <p className="text-sm text-muted-foreground">
              {didAutoReload
                ? 'This page could not be loaded even after a refresh. Check your internet connection and try again.'
                : 'A new version of the app was deployed. The page needs to reload to get the latest files.'}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground break-words">
              {error.message || 'An unexpected error occurred.'}
            </p>
          )}

          <div className="flex gap-2 justify-center">
            <button
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              onClick={this.handleRetry}
            >
              <RefreshCcw className="h-4 w-4" />
              {isChunk ? 'Reload page' : 'Retry'}
            </button>
            <button
              className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90"
              onClick={this.handleDashboard}
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
