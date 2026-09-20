import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('./useIncidentsData', () => ({ useIncidentsData: () => ({ openIncidents: [], criticalHighCount: 0 }) }));
vi.mock('./OpenList', () => ({ OpenList: () => <div data-testid="open-body" /> }));
vi.mock('./ReportForm', () => ({ ReportForm: () => <div data-testid="report-body" />, REPORT_INITIAL: {} }));
vi.mock('./IncidentHistory', () => ({ IncidentHistory: () => <div data-testid="history-body" /> }));

import Incidents from './Incidents';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><Incidents /><Where /></MemoryRouter>);

beforeEach(() => sessionStorage.clear());

/** Incidents, Maintenance and Compliance moved from sessionStorage to the URL the same way. */
describe('Incidents tab lives in the URL (P5-4)', () => {
  it('opens Open Incidents by default', () => {
    renderAt('/incidents');
    expect(screen.getByTestId('open-body')).toBeInTheDocument();
  });

  it('can be linked to: ?tab=history', () => {
    renderAt('/incidents?tab=history');
    expect(screen.getByTestId('history-body')).toBeInTheDocument();
  });

  it('no longer reads the tab a previous visit left in sessionStorage', () => {
    sessionStorage.setItem('tab:incidents', 'report');
    renderAt('/incidents');
    expect(screen.getByTestId('open-body')).toBeInTheDocument();
  });

  it('picking a tab writes it to the URL', () => {
    renderAt('/incidents');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /report incident/i }), { button: 0 });
    expect(screen.getByTestId('where').textContent).toBe('/incidents?tab=report');
    expect(screen.getByTestId('report-body')).toBeInTheDocument();
  });

  it('falls back to Open Incidents for an unknown tab', () => {
    renderAt('/incidents?tab=bogus');
    expect(screen.getByTestId('open-body')).toBeInTheDocument();
  });
});
