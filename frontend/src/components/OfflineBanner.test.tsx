import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OfflineBanner } from './OfflineBanner';

afterEach(() => cleanup());

function renderBanner() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
    </QueryClientProvider>
  );
}

describe('OfflineBanner', () => {
  it('renders nothing when navigator.onLine is true', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders the offline message when navigator.onLine is false', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    renderBanner();
    expect(screen.getByText(/Offline Mode Active/i)).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('reacts to the offline/online window events after mount', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();

    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText(/Offline Mode Active/i)).toBeTruthy();

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.queryByText(/Offline Mode Active/i)).toBeNull();
  });
});
