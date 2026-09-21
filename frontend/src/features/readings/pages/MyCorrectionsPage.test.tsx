import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { MyCorrectionRequest } from '@/shared/myCorrections';

/** P5-6: the operator's side of a correction request. */

const state = vi.hoisted(() => ({
  canView: true,
  query: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => state.canView }));
vi.mock('../hooks/useMyCorrections', () => ({ useMyCorrections: () => state.query }));

import MyCorrectionsPage from './MyCorrectionsPage';

const req = (over: Partial<MyCorrectionRequest> = {}): MyCorrectionRequest => ({
  id: 'r1', status: 'pending', rawStatus: 'pending',
  title: 'Well 3', subtitle: 'Well · North Plant', readingAt: '2026-09-20T06:00:00Z',
  originalValue: 1234, proposedValue: 1243, reason: 'Meter misread', note: null,
  createdAt: '2026-09-20T08:00:00Z', resolvedAt: null, resolvedByName: null, resolutionNote: null,
  ...over,
});

const PENDING = req({ id: 'p', title: 'Well 3' });
const APPROVED = req({
  id: 'a', status: 'approved', rawStatus: 'approved', title: 'Locator 7',
  resolvedByName: '@maria', resolvedAt: '2026-09-20T10:00:00Z', resolutionNote: 'Checked against the log sheet.',
});
const REJECTED = req({
  id: 'x', status: 'rejected', rawStatus: 'rejected', title: 'Train 2', note: 'Photo attached to the log.',
  resolvedByName: '@maria', resolvedAt: '2026-09-20T03:00:00Z', resolutionNote: 'The meter was re-read and the original value is right.',
});

function setQuery(over: Record<string, unknown>) {
  state.query = { data: [], isLoading: false, isError: false, isFetching: false, refetch: state.refetch, ...over };
}

let search = '';
function Probe() { search = useLocation().search; return null; }
const renderPage = (url = '/my-corrections') =>
  render(<MemoryRouter initialEntries={[url]}><MyCorrectionsPage /><Probe /></MemoryRouter>);
const cards = () => screen.queryAllByTestId('correction-request');
const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('MyCorrectionsPage (P5-6)', () => {
  beforeEach(() => { state.canView = true; state.refetch.mockClear(); search = ''; setQuery({}); });

  describe('states', () => {
    it('shows a busy placeholder while loading, and no list or empty message', () => {
      setQuery({ isLoading: true, data: undefined });
      renderPage();
      expect(screen.getByLabelText(/loading your requests/i).getAttribute('aria-busy')).toBe('true');
      expect(cards()).toHaveLength(0);
      expect(screen.queryByTestId('no-requests')).toBeNull();
    });

    it('shows an error with a working retry, not an empty list', () => {
      setQuery({ isError: true, data: undefined });
      renderPage();
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.t load your requests/i);
      expect(screen.queryByTestId('no-requests')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(state.refetch).toHaveBeenCalledTimes(1);
    });

    it('tells a user with no requests how to make one, accurately (Fix, older than two hours)', () => {
      renderPage();
      const empty = screen.getByTestId('no-requests');
      expect(empty.textContent).toMatch(/haven.t asked for any corrections/i);
      expect(empty.textContent).toMatch(/Fix/);
      expect(empty.textContent).toMatch(/two hours/i);
      expect(screen.queryByRole('group', { name: /filter by status/i })).toBeNull();
    });

    it('shows no content at all to a role that may not view it', () => {
      state.canView = false;
      setQuery({ data: [PENDING] });
      renderPage();
      expect(screen.getByText(/access denied/i)).toBeTruthy();
      expect(cards()).toHaveLength(0);
    });
  });

  describe('a request', () => {
    it('shows what was asked: the item, the plant, the reading time, the change and the reason', () => {
      setQuery({ data: [PENDING] });
      renderPage();
      const card = cards()[0];
      expect(within(card).getByText('Well 3')).toBeTruthy();
      expect(card.textContent).toContain('Well · North Plant');
      expect(card.textContent).toMatch(/reading of 20 Sep 26/);
      expect(within(card).getByLabelText(/change from 1,234\.00 to 1,243\.00, \+9\.00/i)).toBeTruthy();
      expect(card.textContent).toContain('Reason: Meter misread');
    });

    it('shows the operator their own note when there is one', () => {
      setQuery({ data: [REJECTED] });
      renderPage();
      expect(cards()[0].textContent).toContain('Your note: Photo attached to the log.');
    });

    it('a pending request says it is waiting and shows no verdict box', () => {
      setQuery({ data: [PENDING] });
      renderPage();
      const card = cards()[0];
      expect(card.textContent).toContain('Pending');
      expect(card.textContent).toMatch(/waiting for a supervisor/i);
      expect(within(card).queryByRole('note')).toBeNull();
    });

    it('a rejection shows who, when and, above all, WHY', () => {
      setQuery({ data: [REJECTED] });
      renderPage();
      const note = within(cards()[0]).getByRole('note');
      expect(note.textContent).toContain('Rejected by @maria');
      expect(note.textContent).toContain('20 Sep 26 11:00');
      expect(note.textContent).toContain('The meter was re-read and the original value is right.');
    });

    it('a rejection with no reason says so instead of leaving a blank', () => {
      setQuery({ data: [{ ...REJECTED, resolutionNote: null }] });
      renderPage();
      expect(within(cards()[0]).getByRole('note').textContent).toMatch(/no reason was given/i);
    });

    it('an approval shows the reviewer and their note', () => {
      setQuery({ data: [APPROVED] });
      renderPage();
      const note = within(cards()[0]).getByRole('note');
      expect(note.textContent).toContain('Approved by @maria');
      expect(note.textContent).toContain('Checked against the log sheet.');
    });

    it('does not invent a reviewer when the name could not be looked up', () => {
      setQuery({ data: [{ ...APPROVED, resolvedByName: null }] });
      renderPage();
      const note = within(cards()[0]).getByRole('note');
      expect(note.textContent).toMatch(/^Approved · /);
      expect(note.textContent).not.toMatch(/ by /);
    });

    it('a decrease is shown with a minus sign', () => {
      setQuery({ data: [req({ originalValue: 50, proposedValue: 41.5 })] });
      renderPage();
      expect(within(cards()[0]).getByLabelText(/-8\.50/)).toBeTruthy();
    });
  });

  describe('filtering', () => {
    beforeEach(() => setQuery({ data: [PENDING, APPROVED, REJECTED, req({ id: 'p2', title: 'Well 9' })] }));

    it('lists everything by default, with a count on each chip', () => {
      renderPage();
      expect(cards()).toHaveLength(4);
      expect(chip('All').textContent).toContain('4');
      expect(chip('Pending').textContent).toContain('2');
      expect(chip('Approved').textContent).toContain('1');
      expect(chip('Rejected').textContent).toContain('1');
      expect(chip('All').getAttribute('aria-pressed')).toBe('true');
    });

    it('picking a status narrows the list and records it in the URL', () => {
      renderPage();
      fireEvent.click(chip('Rejected'));
      expect(cards()).toHaveLength(1);
      expect(cards()[0].getAttribute('data-status')).toBe('rejected');
      expect(chip('Rejected').getAttribute('aria-pressed')).toBe('true');
      expect(chip('All').getAttribute('aria-pressed')).toBe('false');
      expect(search).toBe('?status=rejected');
    });

    it('honours a filter in the link (e.g. from a notification): /my-corrections?status=pending', () => {
      renderPage('/my-corrections?status=pending');
      expect(cards().map((c) => c.getAttribute('data-status'))).toEqual(['pending', 'pending']);
      expect(chip('Pending').getAttribute('aria-pressed')).toBe('true');
    });

    it('an unknown ?status= falls back to showing everything, never an empty page', () => {
      renderPage('/my-corrections?status=bogus');
      expect(cards()).toHaveLength(4);
      expect(chip('All').getAttribute('aria-pressed')).toBe('true');
    });

    it('says so when a filter matches nothing', () => {
      setQuery({ data: [PENDING] });
      renderPage('/my-corrections?status=approved');
      expect(cards()).toHaveLength(0);
      expect(screen.getByRole('status').textContent).toMatch(/no approved requests/i);
    });

    it('withdrawn or unrecognised requests stay visible under All, not silently dropped', () => {
      setQuery({ data: [PENDING, req({ id: 'w', status: 'withdrawn', rawStatus: 'withdrawn' }), req({ id: 'u', status: 'unknown', rawStatus: 'escalated' })] });
      renderPage();
      expect(cards()).toHaveLength(3);
      expect(chip('All').textContent).toContain('3');
    });
  });

  describe('refresh and limits', () => {
    it('Refresh refetches, and is disabled while a fetch is in flight', () => {
      setQuery({ data: [PENDING] });
      const { unmount } = renderPage();
      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      expect(state.refetch).toHaveBeenCalledTimes(1);
      unmount();

      setQuery({ data: [PENDING], isFetching: true });
      renderPage();
      expect((screen.getByRole('button', { name: /refresh/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('tells the user when only the latest 100 are shown', () => {
      setQuery({ data: Array.from({ length: 100 }, (_, i) => req({ id: `r${i}` })) });
      renderPage();
      expect(screen.getByText(/showing your latest 100 requests/i)).toBeTruthy();
    });

    it('does not show that note for a shorter list', () => {
      setQuery({ data: [PENDING] });
      renderPage();
      expect(screen.queryByText(/showing your latest/i)).toBeNull();
    });
  });
});
