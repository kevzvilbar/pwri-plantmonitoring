import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HydraulicsPage } from './HydraulicsPage';

const mockSummaries = [
  {
    wellId: 'w1',
    wellName: 'Well 01 - North Field',
    plantId: 'p1',
    plantName: 'North Plant',
    drillingDepth: 120,
    latestSurvey: {
      id: 'pms1',
      date_gathered: '2026-05-10',
      drilling_depth_m: 120,
      static_water_level_m: 15.0,
      pumping_water_level_m: 35.0,
      pump_setting: '45m',
      motor_hp: 25,
      tds_ppm: 410,
      turbidity_ntu: 1.2,
      remarks: 'Stable pumping level',
    },
    previousSurvey: {
      id: 'pms0',
      date_gathered: '2026-02-10',
      static_water_level_m: 14.5,
      pumping_water_level_m: 33.5,
      tds_ppm: 390,
      turbidity_ntu: 1.0,
    },
    allSurveysCount: 2,
    daysSinceSurvey: 20,
    isSurveyDue: false,
    drawdown: 20.0,
    swl: 15.0,
    pwl: 35.0,
    pumpSetting: '45m',
    motorHp: 25,
    surveyTds: 410,
    surveyTurbidity: 1.2,
    surveyDate: '2026-05-10',
    missingCoreFields: [],
    status: 'ok' as const,
    statusMeta: {
      status: 'ok' as const,
      label: 'Up to Date',
      badgeClass: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/25',
      description: 'Hydraulic survey is complete and recent.',
    },
    delta: {
      swlDelta: 0.5,
      pwlDelta: 1.5,
      drawdownDelta: 1.0,
      tdsDelta: 20,
      turbidityDelta: 0.2,
    },
    livePressure: 42,
    livePressureDate: '2026-05-30T08:00:00Z',
    liveTds: 415,
    liveTdsDate: '2026-05-30T08:00:00Z',
  },
  {
    wellId: 'w2',
    wellName: 'Well 02 - South Field',
    plantId: 'p2',
    plantName: 'South Plant',
    drillingDepth: 95,
    latestSurvey: null,
    previousSurvey: null,
    allSurveysCount: 0,
    daysSinceSurvey: null,
    isSurveyDue: false,
    drawdown: null,
    swl: null,
    pwl: null,
    pumpSetting: null,
    motorHp: null,
    surveyTds: null,
    surveyTurbidity: null,
    surveyDate: null,
    missingCoreFields: [
      { key: 'drilling_depth_m', label: 'Drilling Depth' },
      { key: 'static_water_level_m', label: 'Static Level (SWL)' },
    ],
    status: 'no_survey' as const,
    statusMeta: {
      status: 'no_survey' as const,
      label: 'No Survey Logged',
      badgeClass: 'text-destructive bg-destructive/10 border-destructive/20',
      description: 'No hydraulic survey has been logged yet for this well.',
    },
    delta: {
      swlDelta: null,
      pwlDelta: null,
      drawdownDelta: null,
      tdsDelta: null,
      turbidityDelta: null,
    },
    livePressure: 38,
    livePressureDate: '2026-05-30T08:00:00Z',
    liveTds: 380,
    liveTdsDate: '2026-05-30T08:00:00Z',
  },
];

const mockRefetch = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    roles: ['Manager'],
    activeOperator: { id: 'op1' },
  }),
}));

vi.mock('@/hooks/useVisiblePlants', () => ({
  useVisiblePlants: () => ({
    plants: [
      { id: 'p1', name: 'North Plant' },
      { id: 'p2', name: 'South Plant' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/features/hydraulics/hooks/useHydraulicsFleet', () => ({
  useHydraulicsFleet: () => ({
    summaries: mockSummaries,
    allSummaries: mockSummaries,
    counts: {
      total: 2,
      ok: 1,
      overdue: 0,
      incomplete: 0,
      no_survey: 1,
    },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }),
}));

describe('HydraulicsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page header and fleet surveillance KPI summary cards', () => {
    render(
      <MemoryRouter>
        <HydraulicsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Well Fleet Hydraulics')).toBeInTheDocument();
    expect(screen.getByText('Total Wells')).toBeInTheDocument();
    expect(screen.getAllByText('Survey Due').length).toBeGreaterThan(0);
    expect(screen.getByText('Incomplete Data')).toBeInTheDocument();
    expect(screen.getAllByText('No Survey').length).toBeGreaterThan(0);
  });

  it('renders fleet comparison table rows with well data and badges', () => {
    render(
      <MemoryRouter>
        <HydraulicsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Well 01 - North Field')).toBeInTheDocument();
    expect(screen.getByText('Well 02 - South Field')).toBeInTheDocument();
    expect(screen.getByText('North Plant')).toBeInTheDocument();
    expect(screen.getByText('South Plant')).toBeInTheDocument();
    expect(screen.getAllByText('Up to Date').length).toBeGreaterThan(0);
    expect(screen.getByText('No Survey Logged')).toBeInTheDocument();
  });

  it('allows opening the quick-look drawer for a well', () => {
    render(
      <MemoryRouter>
        <HydraulicsPage />
      </MemoryRouter>,
    );

    const quickViewButtons = screen.getAllByTitle('Quick View Hydraulic Details');
    expect(quickViewButtons.length).toBe(2);

    fireEvent.click(quickViewButtons[0]);
    // Drawer opens and displays well name and detail action
    expect(screen.getByText('Open Well Detail')).toBeInTheDocument();
  });
});
