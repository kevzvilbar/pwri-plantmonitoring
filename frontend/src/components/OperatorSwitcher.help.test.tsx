import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => mockNavigate }));
vi.mock('@/hooks/useAuth', () => {
  const me = { first_name: 'Ana', last_name: 'Cruz', designation: 'Manager', plant_assignments: [] };
  return { useAuth: () => ({ user: { id: 'u1' }, profile: me, activeOperator: me, signOut: vi.fn() }) };
});
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { OperatorSwitcher } from './OperatorSwitcher';
import { OPERATOR_ALLOWED_PATHS } from './ProtectedRoute';

describe('avatar menu: Help & Manual (P5-5)', () => {
  it('has a Help & Manual item that opens /help', async () => {
    render(<MemoryRouter><OperatorSwitcher /></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Help & Manual'));
    expect(mockNavigate).toHaveBeenCalledWith('/help');
  });

  it('every page the avatar menu links to is open to Operators, so no menu item ends in "Access restricted"', () => {
    for (const path of ['/profile', '/help']) {
      expect(OPERATOR_ALLOWED_PATHS.some((p) => (p === '/' ? path === '/' : path.startsWith(p))), path).toBe(true);
    }
  });
});
