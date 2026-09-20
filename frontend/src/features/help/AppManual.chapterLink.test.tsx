import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// "Copy chapter link" in the reader produces /help?chapter=<id>. The reader
// used to be the only thing that wrote that parameter and nothing read it, so
// a shared link just opened the plain page. AppManual now opens the book at
// that chapter. BookReader is stubbed to expose the props it receives.
vi.mock('@/components/manual/BookReader', () => ({
  BookReader: ({ open, initialChapterId }: { open: boolean; initialChapterId?: string }) => (
    <div data-testid="reader" data-open={String(open)} data-chapter={initialChapterId ?? ''} />
  ),
}));

import { AppManual } from './AppManual';

const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><AppManual /></MemoryRouter>);

describe('AppManual ?chapter= deep link', () => {
  it('opens the book at the linked chapter', () => {
    renderAt('/help?chapter=alerts-triage');
    const reader = screen.getByTestId('reader');
    expect(reader.dataset.open).toBe('true');
    expect(reader.dataset.chapter).toBe('alerts-triage');
  });

  it('ignores an unknown chapter id and leaves the book closed', () => {
    renderAt('/help?chapter=not-a-chapter');
    expect(screen.getByTestId('reader').dataset.open).toBe('false');
  });

  it('with no ?chapter= the page opens closed, as before', () => {
    renderAt('/help');
    expect(screen.getByTestId('reader').dataset.open).toBe('false');
  });
});
