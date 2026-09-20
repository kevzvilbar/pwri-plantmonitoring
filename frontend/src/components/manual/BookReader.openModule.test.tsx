import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The manual's "Open module" (desktop) and "Open screen" (mobile) buttons used
// to be offered for every chapter, so an Operator reading the Data Corrections
// chapter was one click from an "Access restricted" toast. Real BookReader,
// real permission matrix; only auth, navigation and toasts are mocked.

const mockNavigate = vi.fn();
let mockRoles: string[] = ['Manager'];

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: mockRoles }),
}));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { BookReader } from './BookReader';

function renderReader(roles: string[], chapterId: string, onOpenChange = vi.fn()) {
  mockRoles = roles;
  render(
    <MemoryRouter>
      <BookReader open onOpenChange={onOpenChange} initialChapterId={chapterId} />
    </MemoryRouter>,
  );
  return onOpenChange;
}

describe('BookReader route buttons', () => {
  beforeEach(() => mockNavigate.mockClear());

  it.each(['data-corrections', 'admin-console', 'costs', 'exports'])(
    'hides both buttons from an Operator on the %s chapter',
    (chapter) => {
      renderReader(['Operator'], chapter);
      expect(screen.queryByText('Open module')).toBeNull();
      expect(screen.queryByText('Open screen')).toBeNull();
    },
  );

  it('still offers an Operator the pages they can open (Daily Readings)', () => {
    renderReader(['Operator'], 'operations');
    expect(screen.getByText('Open module')).toBeInTheDocument();
    expect(screen.getByText('Open screen')).toBeInTheDocument();
  });

  it('gives a Manager the Data Corrections button, which closes the book and navigates', () => {
    const onOpenChange = renderReader(['Manager'], 'data-corrections');
    fireEvent.click(screen.getByText('Open module'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/data-corrections');
  });
});

describe('BookReader "Copy chapter link"', () => {
  it('copies a /help link for the open chapter, not an /employees link', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderReader(['Manager'], 'alerts-triage');
    fireEvent.click(screen.getByTitle('Copy chapter link'));

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.pathname.endsWith('/help')).toBe(true);
    expect(url.searchParams.get('chapter')).toBe('alerts-triage');
    expect(url.pathname).not.toContain('employees');
  });
});
