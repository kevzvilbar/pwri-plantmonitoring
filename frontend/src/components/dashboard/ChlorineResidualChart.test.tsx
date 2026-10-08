import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChlorineResidualChart } from './ChlorineResidualChart';

// Mock recharts ResponsiveContainer so it renders in jsdom
vi.mock('recharts', async () => {
  const original = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 800, height: 400 }}>
        {children}
      </div>
    ),
  };
});

vi.mock('@/components/CorrectionRequestDialog', () => ({
  CorrectionRequestDialog: ({ target, onClose }: { target: { entityName: string; currentReading: number }; onClose: () => void }) => (
    <div data-testid="correction-request-dialog">
      <span>Correction: {target.entityName}</span>
      <span>Value: {target.currentReading}</span>
      <button type="button" onClick={onClose}>Close Dialog</button>
    </div>
  ),
}));

describe('ChlorineResidualChart', () => {
  const mockReadings = [
    {
      id: 'r1',
      train_id: 'train-1',
      train_name: 'RO Train 1',
      reading_datetime: '2026-10-01T08:00:00Z',
      chlorine_residual_mg_l: 0.85,
    },
    {
      id: 'r2',
      train_id: 'train-1',
      train_name: 'RO Train 1',
      reading_datetime: '2026-10-01T09:00:00Z',
      chlorine_residual_mg_l: 0.25, // below min
    },
    {
      id: 'r3',
      train_id: 'train-1',
      train_name: 'RO Train 1',
      reading_datetime: '2026-10-01T15:00:00Z', // 6 hour gap
      chlorine_residual_mg_l: 1.80, // above max
    },
    {
      id: 'r4',
      train_id: 'train-1',
      train_name: 'RO Train 1',
      reading_datetime: '2026-10-01T16:00:00Z',
      chlorine_residual_mg_l: 4.50, // suspect outlier
    },
    {
      id: 'r5',
      train_id: 'train-2',
      train_name: 'RO Train 2',
      reading_datetime: '2026-10-01T08:00:00Z',
      chlorine_residual_mg_l: 1.10,
    },
  ];

  const mockTrainEntities = [
    { id: 'train-1', label: 'RO Train 1', color: '#0ea5e9' },
    { id: 'train-2', label: 'RO Train 2', color: '#10b981' },
  ];

  it('renders without crashing on empty readings', () => {
    render(<ChlorineResidualChart roReadings={[]} />);
    expect(screen.getByText('Free Chlorine Residual')).toBeInTheDocument();
    expect(screen.getByText('No Chlorine Residual readings for the selected range')).toBeInTheDocument();
  });

  it('renders KPI summary chips with calculated statistics', () => {
    render(
      <ChlorineResidualChart
        roReadings={mockReadings}
        roTrainEntities={mockTrainEntities}
      />,
    );

    // Valid readings count (excludes suspect 4.50): 4 readings
    expect(screen.getByText('Valid Readings')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();

    // Compliance %, Below Min, Above Max, Suspect
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Below 0.3 mg/L')).toBeInTheDocument();
    expect(screen.getByText('Above 1.5 mg/L')).toBeInTheDocument();
    expect(screen.getAllByText(/Suspect \(>3\.0\)/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders view mode toggle buttons and allows switching gap sensitivity', () => {
    render(
      <ChlorineResidualChart
        roReadings={mockReadings}
        roTrainEntities={mockTrainEntities}
      />,
    );

    const operatorBtn = screen.getByRole('button', { name: /Operator \(2h Gaps\)/i });
    const mgmtBtn = screen.getByRole('button', { name: /Management \(4h Gaps\)/i });

    expect(operatorBtn).toBeInTheDocument();
    expect(mgmtBtn).toBeInTheDocument();

    // Switch to Management mode
    fireEvent.click(mgmtBtn);
    expect(mgmtBtn.className).toContain('bg-background');
  });

  it('allows toggling train filters', () => {
    const onToggleTrain = vi.fn();
    render(
      <ChlorineResidualChart
        roReadings={mockReadings}
        roTrainEntities={mockTrainEntities}
        onToggleTrain={onToggleTrain}
      />,
    );

    const train1Pill = screen.getByRole('button', { name: /RO Train 1/i });
    fireEvent.click(train1Pill);
    expect(onToggleTrain).toHaveBeenCalledWith('train-1');
  });

  it('displays gap notification bar when missing data gap is detected', () => {
    render(
      <ChlorineResidualChart
        roReadings={mockReadings}
        roTrainEntities={mockTrainEntities}
      />,
    );

    fireEvent.click(screen.getByTestId('view-mode-readings'));
    expect(screen.getByText(/6h gap/i)).toBeInTheDocument();
  });
  it('treats blank readings as missing: an overnight blank run becomes a gap', () => {
    const readings = [
      { id: 'a', train_id: 'train-1', reading_datetime: '2026-10-07T22:00:00Z', chlorine_residual_mg_l: 0.9 },
      { id: 'b', train_id: 'train-1', reading_datetime: '2026-10-08T00:00:00Z', chlorine_residual_mg_l: null },
      { id: 'c', train_id: 'train-1', reading_datetime: '2026-10-08T02:00:00Z', chlorine_residual_mg_l: '' },
      { id: 'd', train_id: 'train-1', reading_datetime: '2026-10-08T04:00:00Z', chlorine_residual_mg_l: 1.1 },
    ];
    render(<ChlorineResidualChart roReadings={readings} roTrainEntities={mockTrainEntities} />);
    fireEvent.click(screen.getByTestId('view-mode-readings'));
    expect(screen.getByText(/6h gap/i)).toBeInTheDocument();
    // only the 2 real readings are counted
    expect(screen.getByText('Valid Readings').nextSibling?.textContent).toBe('2');
  });

  it('drops retracted readings and counts normalized suspect readings as verified', () => {
    const readings = [
      { id: 'a', train_id: 'train-1', reading_datetime: '2026-10-08T01:00:00Z', chlorine_residual_mg_l: 0.9 },
      { id: 'b', train_id: 'train-1', reading_datetime: '2026-10-08T02:00:00Z', chlorine_residual_mg_l: 8.3, norm_status: 'retracted' },
      { id: 'c', train_id: 'train-1', reading_datetime: '2026-10-08T03:00:00Z', chlorine_residual_mg_l: 8.3, norm_status: 'normalized' },
    ];
    render(<ChlorineResidualChart roReadings={readings} roTrainEntities={mockTrainEntities} />);
    // retracted gone; normalized 8.3 is verified -> valid, not suspect
    expect(screen.getByText('Valid Readings').nextSibling?.textContent).toBe('2');
  });

  it('renders and toggles Overall Daily Avg button', () => {
    render(
      <ChlorineResidualChart
        roReadings={mockReadings}
        roTrainEntities={mockTrainEntities}
      />,
    );

    const overallAvgBtn = screen.getByTestId('toggle-overall-avg');
    expect(overallAvgBtn).toBeInTheDocument();
    expect(overallAvgBtn.className).toContain('bg-sky-500/15');

    // Click to toggle off
    fireEvent.click(overallAvgBtn);
    expect(overallAvgBtn.className).not.toContain('bg-sky-500/15');
  });

  it('shows the daily average hero first, with the latest day and a chip per day', () => {
    const readings = [
      { id: 'a', train_id: 'train-1', reading_datetime: '2026-10-07T02:00:00Z', chlorine_residual_mg_l: 1.0 },
      { id: 'b', train_id: 'train-1', reading_datetime: '2026-10-07T06:00:00Z', chlorine_residual_mg_l: 1.4 },
      { id: 'c', train_id: 'train-1', reading_datetime: '2026-10-08T02:00:00Z', chlorine_residual_mg_l: 8.3 },
      { id: 'd', train_id: 'train-1', reading_datetime: '2026-10-08T03:00:00Z', chlorine_residual_mg_l: 1.1 },
    ];
    render(<ChlorineResidualChart roReadings={readings} roTrainEntities={mockTrainEntities} />);
    expect(screen.getByTestId('daily-avg-hero')).toBeInTheDocument();
    // latest day excludes the unverified 8.3 -> 1.10
    expect(screen.getByTestId('daily-avg-latest').textContent).toBe('1.10');
    expect(screen.getByTestId('daily-avg-chips').children).toHaveLength(2);
    // daily view is the default
    expect(screen.queryByText(/logging gap/i)).not.toBeInTheDocument();
  });

  it('allows clicking day chips to focus and inspect previous day averages', () => {
    const readings = [
      { id: 'a', train_id: 'train-1', reading_datetime: '2026-10-07T02:00:00Z', chlorine_residual_mg_l: 1.0 },
      { id: 'b', train_id: 'train-1', reading_datetime: '2026-10-07T06:00:00Z', chlorine_residual_mg_l: 1.4 },
      { id: 'c', train_id: 'train-1', reading_datetime: '2026-10-08T03:00:00Z', chlorine_residual_mg_l: 0.8 },
    ];
    render(<ChlorineResidualChart roReadings={readings} roTrainEntities={mockTrainEntities} />);

    // Default hero shows latest day (Oct 8 -> 0.80)
    expect(screen.getByTestId('daily-avg-latest').textContent).toBe('0.80');

    // Click Oct 7 chip
    const oct7Chip = screen.getByTestId('daily-chip-2026-10-07');
    fireEvent.click(oct7Chip);

    // Hero now inspects Oct 7 (average of 1.0 and 1.4 is 1.20)
    expect(screen.getByTestId('daily-avg-latest').textContent).toBe('1.20');
    expect(screen.getByTestId('reset-day-focus-btn')).toBeInTheDocument();

    // Click reset to latest
    fireEvent.click(screen.getByTestId('reset-day-focus-btn'));
    expect(screen.getByTestId('daily-avg-latest').textContent).toBe('0.80');
  });

  it('triggers quick correction request dialog on suspect outlier review', () => {
    render(
      <ChlorineResidualChart
        roReadings={mockReadings}
        roTrainEntities={mockTrainEntities}
      />,
    );

    const reviewBtn = screen.getByTestId('review-suspect-btn');
    expect(reviewBtn).toBeInTheDocument();

    fireEvent.click(reviewBtn);

    // CorrectionRequestDialog should be rendered with the suspect reading details
    expect(screen.getByTestId('correction-request-dialog')).toBeInTheDocument();
    expect(screen.getByText('Correction: RO Train 1')).toBeInTheDocument();
    expect(screen.getByText('Value: 4.5')).toBeInTheDocument();

    // Clicking close closes dialog
    fireEvent.click(screen.getByRole('button', { name: /Close Dialog/i }));
    expect(screen.queryByTestId('correction-request-dialog')).not.toBeInTheDocument();
  });

  it('opens suspect list dialog when multiple suspect readings exist', () => {
    const multiSuspectReadings = [
      ...mockReadings,
      {
        id: 'r6',
        train_id: 'train-2',
        train_name: 'RO Train 2',
        reading_datetime: '2026-10-01T17:00:00Z',
        chlorine_residual_mg_l: 5.20,
      },
    ];

    render(
      <ChlorineResidualChart
        roReadings={multiSuspectReadings}
        roTrainEntities={mockTrainEntities}
      />,
    );

    const reviewBtn = screen.getByTestId('review-suspect-btn');
    fireEvent.click(reviewBtn);

    // Should open suspect readings list
    expect(screen.getByTestId('suspect-readings-list')).toBeInTheDocument();
    expect(screen.getByText(/5\.20 mg\/L/i)).toBeInTheDocument();

    // Click Request Correction on the second item
    const requestBtns = screen.getAllByRole('button', { name: /Request Correction/i });
    expect(requestBtns).toHaveLength(2);
    fireEvent.click(requestBtns[1]);

    // Now CorrectionRequestDialog is open for Train 2
    expect(screen.getByTestId('correction-request-dialog')).toBeInTheDocument();
    expect(screen.getByText('Correction: RO Train 2')).toBeInTheDocument();
  });
  it('flags a day whose average is in range but contains out-of-range readings', () => {
    const readings = [
      { id: 'a', train_id: 'train-1', reading_datetime: '2026-10-08T01:00:00Z', chlorine_residual_mg_l: 0.2 },
      { id: 'b', train_id: 'train-1', reading_datetime: '2026-10-08T02:00:00Z', chlorine_residual_mg_l: 1.4 },
      { id: 'c', train_id: 'train-1', reading_datetime: '2026-10-08T03:00:00Z', chlorine_residual_mg_l: 1.4 },
    ];
    render(<ChlorineResidualChart roReadings={readings} roTrainEntities={mockTrainEntities} />);
    // mean 1.00 is in range, but one reading is below 0.3
    expect(screen.getByTestId('daily-avg-latest').textContent).toBe('1.00');
    expect(screen.getByTestId('daily-avg-out-of-range').textContent).toMatch(/1 reading out of range/);
    expect(screen.getByTestId('daily-chip-range-2026-10-08').textContent).toContain('0.2–1.4 !');
  });

  it('treats a 0.00 day as critical and shows the period average with and without it', () => {
    const readings = [
      { id: 'a', train_id: 'train-1', reading_datetime: '2026-10-06T02:00:00Z', chlorine_residual_mg_l: 1.3 },
      { id: 'b', train_id: 'train-1', reading_datetime: '2026-10-07T02:00:00Z', chlorine_residual_mg_l: 0 },
      { id: 'c', train_id: 'train-1', reading_datetime: '2026-10-08T02:00:00Z', chlorine_residual_mg_l: 1.1 },
    ];
    render(<ChlorineResidualChart roReadings={readings} roTrainEntities={mockTrainEntities} />);
    // zero stays in the headline average (it is a real reading) ...
    expect(screen.getByTestId('daily-avg-hero').textContent).toContain('Period avg 0.8');
    // ... and the version without it is shown next to it
    expect(screen.getByTestId('period-avg-excl-no-residual').textContent).toMatch(/1\.20 excl\. 1 no-residual reading/);
    // the 0.00 tile is announced as no residual, not just coloured
    fireEvent.click(screen.getByTestId('daily-chip-2026-10-07'));
    expect(screen.getByTestId('daily-chip-2026-10-07').getAttribute('aria-label')).toMatch(/no residual/);
    expect(screen.getByText('No residual')).toBeInTheDocument();
  });

  it('shows gap count and longest gap in the daily view without opening the readings view', () => {
    render(<ChlorineResidualChart roReadings={mockReadings} roTrainEntities={mockTrainEntities} />);
    const kpi = screen.getByTestId('gap-kpi');
    expect(kpi.textContent).toContain('longest 6h');
    fireEvent.click(screen.getByRole('button', { name: /Management \(4h Gaps\)/i }));
    expect(screen.getByTestId('gap-kpi').textContent).toContain('Gaps >4h');
  });

  it('gives every day tile an accessible status that does not rely on colour', () => {
    const readings = [
      { id: 'a', train_id: 'train-1', reading_datetime: '2026-10-07T02:00:00Z', chlorine_residual_mg_l: 1.8 },
      { id: 'b', train_id: 'train-1', reading_datetime: '2026-10-09T02:00:00Z', chlorine_residual_mg_l: 0.9 },
    ];
    render(<ChlorineResidualChart roReadings={readings} roTrainEntities={mockTrainEntities} />);
    expect(screen.getByTestId('daily-chip-2026-10-07').getAttribute('aria-label')).toMatch(/above maximum/);
    expect(screen.getByTestId('daily-chip-2026-10-08').getAttribute('aria-label')).toMatch(/no valid readings/);
    expect(screen.getByTestId('daily-chip-2026-10-09').getAttribute('aria-label')).toMatch(/in range/);
  });
  it('shows the latest valid reading per train on the band, using plant-time timestamps', () => {
    render(<ChlorineResidualChart roReadings={mockReadings} roTrainEntities={mockTrainEntities} />);
    expect(screen.getByTestId('latest-readings')).toBeInTheDocument();
    // train-1: latest valid is 1.80 (the later 4.50 is an unverified suspect)
    expect(screen.getByTestId('latest-value-train-1').textContent).toContain('1.80');
    expect(screen.getByTestId('latest-row-train-1').getAttribute('aria-label')).toMatch(/above maximum/);
    expect(screen.getByTestId('latest-suspect-train-1').textContent).toMatch(/4\.50.*awaiting verification/);
    // train-2: 1.10 in range
    expect(screen.getByTestId('latest-value-train-2').textContent).toContain('1.10');
    expect(screen.getByTestId('latest-row-train-2').getAttribute('aria-label')).toMatch(/in range/);
    // 2026-10-01T15:00Z = Oct 1, 23:00 in Asia/Manila
    expect(screen.getByTestId('latest-row-train-1').textContent).toContain('23:00');
  });

  it('flags a train whose latest reading trails the others by more than the gap limit', () => {
    render(<ChlorineResidualChart roReadings={mockReadings} roTrainEntities={mockTrainEntities} />);
    // train-2 last read 08:00Z, train-1 valid latest 15:00Z -> 7.0h behind (> 2h operator limit)
    expect(screen.getByTestId('latest-behind-train-2').textContent).toMatch(/7\.0h/);
    expect(screen.queryByTestId('latest-behind-train-1')).not.toBeInTheDocument();
  });

  it('respects the train filter in the latest-reading panel', () => {
    render(
      <ChlorineResidualChart
        roReadings={mockReadings}
        roTrainEntities={mockTrainEntities}
        selectedTrainIds={new Set(['train-2'])}
      />,
    );
    expect(screen.queryByTestId('latest-row-train-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('latest-row-train-2')).toBeInTheDocument();
  });
});
