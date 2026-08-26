import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import { OfflineBanner } from './OfflineBanner';

afterEach(() => cleanup());

describe('OfflineBanner', () => {
  it('renders nothing when navigator.onLine is true', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the offline message when navigator.onLine is false', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    render(<OfflineBanner />);
    expect(screen.getByText(/won't save until you reconnect/i)).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('reacts to the offline/online window events after mount', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();

    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText(/won't save until you reconnect/i)).toBeTruthy();

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.queryByText(/won't save until you reconnect/i)).toBeNull();
  });
});
