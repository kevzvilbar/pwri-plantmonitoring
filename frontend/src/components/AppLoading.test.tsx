import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AppLoading } from './AppLoading';

const originalWidth = window.innerWidth;
afterEach(() => {
  cleanup();
  window.innerWidth = originalWidth;
});

describe('AppLoading', () => {
  it('shows the static logo and readable loading status on mobile', () => {
    window.innerWidth = 390;
    const { container, unmount } = render(<AppLoading className="min-h-screen" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.getByRole('status')).toHaveClass('min-h-screen');
    const img = screen.getByAltText('PWRI Monitoring');
    expect(img).toBeInTheDocument();
    expect(img.tagName.toLowerCase()).toBe('img');
    expect(img).toHaveAttribute('src', expect.stringContaining('pwri-logo.png'));
    unmount();
    expect(container.querySelector('img')).toBeNull();
  });

  it.each([768, 1280])('keeps desktop loading text-only at %ipx', (width) => {
    window.innerWidth = width;
    const { container } = render(<AppLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(container.querySelector('img')).toBeNull();
  });

  it('includes the last pixel of the mobile breakpoint', () => {
    window.innerWidth = 767;
    const { container } = render(<AppLoading />);
    expect(container.querySelector('img')).not.toBeNull();
  });
});
