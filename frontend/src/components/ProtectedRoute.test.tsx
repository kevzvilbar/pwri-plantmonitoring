import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1' }, loading: false,
    profile: { profile_complete: true, confirmed: true, designation: 'Operator' },
    roles: ['Operator'],
  }),
}));
vi.mock('@/components/AppLoading', () => ({ AppLoading: () => null }));
vi.mock('@/components/DesignationCombobox', () => ({ OPERATOR_DESIGNATION: 'Operator' }));
import { ProtectedRoute } from '@/components/ProtectedRoute';

const Where = () => <span data-testid="p">{useLocation().pathname}</span>;
const App = ({ start }: { start: string }) => (
  <MemoryRouter initialEntries={[start]}>
    <Routes>
      <Route element={<ProtectedRoute><Where /></ProtectedRoute>}>
        <Route path="*" element={null} />
      </Route>
    </Routes>
  </MemoryRouter>
);

describe('ProtectedRoute (operator)', () => {
  beforeEach(() => toastError.mockClear());
  it('redirects a forbidden path to / with exactly one toast', () => {
    render(<App start="/data-corrections" />);
    expect(screen.getByTestId('p').textContent).toBe('/');
    expect(toastError).toHaveBeenCalledTimes(1);
  });
  it('under StrictMode (effects run twice) every toast shares one id, so sonner shows a single toast', () => {
    render(<StrictMode><App start="/data-corrections" /></StrictMode>);
    expect(screen.getByTestId('p').textContent).toBe('/');
    expect(toastError).toHaveBeenCalled();
    for (const call of toastError.mock.calls) {
      expect(call[1]).toMatchObject({ id: 'access-denied' });
    }
  });
  it('leaves allowed paths alone', () => {
    render(<App start="/incidents" />);
    expect(screen.getByTestId('p').textContent).toBe('/incidents');
    expect(toastError).not.toHaveBeenCalled();
  });
});
