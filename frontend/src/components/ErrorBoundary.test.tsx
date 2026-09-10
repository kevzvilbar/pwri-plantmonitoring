import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';

// Silence console.error during deliberate error throwing in tests
const originalConsoleError = console.error;

beforeEach(() => {
  console.error = vi.fn();
});

afterEach(() => {
  console.error = originalConsoleError;
  cleanup();
});

function Bomb({ shouldThrow, message = 'Crash!' }: { shouldThrow: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div>Healthy Child Content</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Healthy Child Content')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('catches render error and displays fallback UI with error message', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} message="Database explosion" />
      </ErrorBoundary>
    );

    expect(screen.queryByText('Healthy Child Content')).toBeNull();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Database explosion')).toBeTruthy();
  });

  it('displays custom fallbackTitle if provided', () => {
    render(
      <ErrorBoundary fallbackTitle="Module crashed">
        <Bomb shouldThrow={true} message="Out of bounds" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Module crashed')).toBeTruthy();
    expect(screen.getByText('Out of bounds')).toBeTruthy();
  });

  it('resets error state when resetKey changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/operations">
        <Bomb shouldThrow={true} message="Route error" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // Navigate to a new route (/plants) where the component does not crash
    rerender(
      <ErrorBoundary resetKey="/plants">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByText('Healthy Child Content')).toBeTruthy();
  });

  it('resets error state when retry button is clicked and child recovers', () => {
    let shouldThrow = true;
    function DynamicBomb() {
      if (shouldThrow) {
        throw new Error('Temporary failure');
      }
      return <div>Recovered Content</div>;
    }

    render(
      <ErrorBoundary>
        <DynamicBomb />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // Now fix the underlying condition and click retry
    shouldThrow = false;
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByText('Recovered Content')).toBeTruthy();
  });
});
