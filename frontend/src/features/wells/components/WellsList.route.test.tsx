import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom';

/** P5-3: a well's detail page is a route, not local state. This drives the real
 *  WellsList inside a real router; only its heavy children are stubbed. */

const list = vi.hoisted(() => ({
  state: {
    isAdmin: false, isManager: false, qc: { invalidateQueries: () => {} },
    wells: [{ id: 'w1', name: 'Well 1' }],
    latestWellReadings: [], latestByWellId: {}, wellCardRefs: { current: {} }, wellPulseId: null,
    wellOfflineTarget: null, wellOfflineBusy: false, blendingSet: new Set<string>(),
    selectedWell: null, selected: new Set<string>(),
    bulkDeleteOpen: false, bulkReason: '', bulkBusy: false,
    blendingBusy: new Set<string>(), powerBusy: new Set<string>(),
    adding: false, wellDeleteTarget: null, wellDeleteReason: '', wellDeleteBusy: false,
    editingWell: null, showWellCsv: false, meterCfg: {}, getWellElectricMode: () => 'none', plant: { name: 'P' },
    toggle: () => {}, toggleAll: () => {}, toggleWellStatus: () => {}, toggleWellElectric: () => {}, toggleBlending: () => {},
    doWellDelete: () => {}, doBulkDelete: () => {}, applyWellStatusChange: () => {},
    setSelectedWell: () => {}, setSelected: () => {}, setBulkDeleteOpen: () => {}, setBulkReason: () => {}, setBulkBusy: () => {},
    setWellOfflineTarget: () => {}, setWellOfflineBusy: () => {}, setAdding: () => {}, setEditingWell: () => {}, setShowWellCsv: () => {},
    setWellDeleteTarget: () => {}, setWellDeleteReason: () => {}, setWellDeleteBusy: () => {}, setBlendingBusy: () => {}, setPowerBusy: () => {},
  },
}));

vi.mock('./WellsList/useWellsList', () => ({ useWellsList: () => list.state, PAGE_SIZE: 20 }));
vi.mock('./WellsList/WellCard', () => ({
  WellCard: ({ w, onSetDetail, onNavigateOperations }: { w: { id: string; name: string }; onSetDetail: () => void; onNavigateOperations: () => void }) => (
    <>
      <button onClick={onSetDetail}>open {w.name}</button>
      <button onClick={onNavigateOperations}>readings {w.name}</button>
    </>
  ),
}));
vi.mock('./WellDetail', () => ({
  WellDetail: ({ wellId, plantId, onBack }: { wellId: string; plantId?: string; onBack: () => void }) => (
    <div>
      <span data-testid="detail">detail {wellId} in {plantId}</span>
      <button onClick={onBack}>Back to Wells</button>
    </div>
  ),
}));
vi.mock('./WellDialogs', () => ({
  AddWellDialog: () => null, EditWellDialog: () => null, EditElectricMeterDialog: () => null,
  EditHydraulicDialog: () => null, WellCsvImportDialog: () => null,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({}) }));
vi.mock('@/store/appStore', () => ({ useAppStore: () => ({}) }));
vi.mock('@/features/plants/components/locators/LocatorDialogs', () => ({ ReasonField: () => null }));
vi.mock('@/features/plants/components/charts/EntityHistoryChart/index', () => ({ EntityHistoryChart: () => null, MeterDetailButton: () => null }));
vi.mock('@/features/plants/shared', () => ({
  CollapsibleSection: () => null, GridPylonIcon: () => null, usePlantMeterConfig: () => ({}), logStatusChange: () => {},
}));
vi.mock('@/components/DeleteEntityMenu', () => ({ DeleteEntityMenu: () => null }));
vi.mock('@/components/ReasonDialog', () => ({ ReasonDialog: () => null }));

import { WellsList } from './WellsList';

let seenPath = '';
let seenSearch = '';
function Host() {
  const { id, wellId } = useParams();
  const l = useLocation();
  const nav = useNavigate();
  seenPath = l.pathname;
  seenSearch = l.search;
  return (
    <>
      <WellsList plantId={id!} activeWellId={wellId ?? null} />
      <button onClick={() => nav(-1)}>browser-back</button>
    </>
  );
}
function App({ entries, index }: { entries: string[]; index?: number }) {
  return (
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route path="/plants/:id" element={<Host />} />
        <Route path="/plants/:id/wells/:wellId" element={<Host />} />
        <Route path="/elsewhere" element={<Host />} />
        <Route path="/operations" element={<Host />} />
      </Routes>
    </MemoryRouter>
  );
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('WellsList route wiring (P5-3)', () => {
  it('the list shows wells and no detail on /plants/:id', () => {
    render(<App entries={['/plants/p1?tab=wells']} />);
    expect(screen.getByRole('button', { name: 'open Well 1' })).toBeTruthy();
    expect(screen.queryByTestId('detail')).toBeNull();
  });

  it('opening a well navigates to /plants/:id/wells/:wellId and shows its detail, scoped to the plant', () => {
    render(<App entries={['/plants/p1?tab=wells']} />);
    click('open Well 1');
    expect(seenPath).toBe('/plants/p1/wells/w1');
    expect(screen.getByTestId('detail').textContent).toBe('detail w1 in p1');
    expect(screen.queryByRole('button', { name: 'open Well 1' })).toBeNull();
  });

  it('browser Back from the detail returns to the wells list, not out of the plant (the bug this fixes)', () => {
    render(<App entries={['/elsewhere', '/plants/p1?tab=wells']} index={1} />);
    click('open Well 1');
    click('browser-back');
    expect(seenPath).toBe('/plants/p1');
    expect(seenSearch).toBe('?tab=wells');
    expect(screen.getByRole('button', { name: 'open Well 1' })).toBeTruthy();
  });

  it('"Back to Wells" returns to the list', () => {
    render(<App entries={['/elsewhere', '/plants/p1?tab=wells']} index={1} />);
    click('open Well 1');
    click('Back to Wells');
    expect(seenPath).toBe('/plants/p1');
    expect(screen.getByRole('button', { name: 'open Well 1' })).toBeTruthy();
  });

  it('a deep link renders the detail directly (linkable and reloadable)', () => {
    render(<App entries={['/plants/p1/wells/w9']} />);
    expect(screen.getByTestId('detail').textContent).toBe('detail w9 in p1');
  });

  it('a deep link\'s "Back to Wells" lands on the list URL', () => {
    render(<App entries={['/elsewhere', '/plants/p1/wells/w9']} index={1} />);
    click('Back to Wells');
    expect(seenPath).toBe('/plants/p1');
    expect(seenSearch).toBe('?tab=wells');
    expect(screen.getByRole('button', { name: 'open Well 1' })).toBeTruthy();
  });
});

describe('WellsList link to Daily Readings (P5-7)', () => {
  it('the Daily Readings pill on a well card opens that well\'s row', () => {
    render(<App entries={['/plants/p1?tab=wells']} />);
    click('readings Well 1');
    expect(seenPath).toBe('/operations');
    expect(seenSearch).toBe('?tab=well&highlight=w1');
  });
});
