import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WellUnavailable } from './WellUnavailable';

describe('WellUnavailable (P5-3)', () => {
  it('not-found: says so, offers Back to Wells, and no retry (retrying cannot help)', () => {
    const onBack = vi.fn();
    render(<WellUnavailable kind="not-found" onBack={onBack} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/well not found/i);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /back to wells/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('error: offers a retry as well as Back', () => {
    const onRetry = vi.fn();
    render(<WellUnavailable kind="error" onBack={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't load this well/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
