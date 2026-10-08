import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChlorineHourlyByTrainChart } from './ChlorineHourlyByTrainChart';
import { buildHourlyChlorineByTrain } from '@/lib/chlorineConfig';

vi.mock('recharts', async () => {
  const original = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
      <div style={{ width: 800, height: 400 }}>{children}</div>
    ),
  };
});

const trains = [
  { id: 'A', label: 'RO Train 1', color: '#0ea5e9' },
  { id: 'B', label: 'RO Train 2', color: '#f97316' },
];
const p = (train_id: string, iso: string, v: number) => ({ train_id, reading_datetime: iso, chlorine_residual_mg_l: v });

describe('ChlorineHourlyByTrainChart', () => {
  it('shows a legend entry per train (not one combined series) and isolates on click', () => {
    const hourly = buildHourlyChlorineByTrain([
      p('A', '2026-10-08T01:00:00Z', 0.9),
      p('B', '2026-10-08T01:00:00Z', 1.2),
      p('A', '2026-10-08T02:00:00Z', 1.0),
    ]);
    const isolate = vi.fn();
    render(<ChlorineHourlyByTrainChart hourly={hourly} trainEntities={trains} handleTrainLegendIsolate={isolate} />);
    expect(screen.getByTestId('chlorine-hourly-by-train')).toBeInTheDocument();
    expect(screen.getByTestId('chlorine-hourly-legend-A')).toBeInTheDocument();
    expect(screen.getByTestId('chlorine-hourly-legend-B')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chlorine-hourly-legend-B'));
    expect(isolate).toHaveBeenCalledWith({ dataKey: 'B' });
  });

  it('states the band and the gap rule in the legend line', () => {
    const hourly = buildHourlyChlorineByTrain([p('A', '2026-10-08T01:00:00Z', 0.9)]);
    render(<ChlorineHourlyByTrainChart hourly={hourly} trainEntities={trains} />);
    expect(screen.getByTestId('chlorine-hourly-by-train').textContent).toMatch(/band 0\.3–1\.5 mg\/L/);
    expect(screen.getByTestId('chlorine-hourly-by-train').textContent).toMatch(/lines break after >2h/);
  });

  it('shows an explicit empty state when only suspect readings exist', () => {
    const hourly = buildHourlyChlorineByTrain([p('A', '2026-10-08T01:00:00Z', 8.3)]);
    render(<ChlorineHourlyByTrainChart hourly={hourly} trainEntities={trains} />);
    expect(screen.getByTestId('chlorine-hourly-empty')).toBeInTheDocument();
  });

  it('draws nothing for trains hidden by the train filter', () => {
    const hourly = buildHourlyChlorineByTrain([p('A', '2026-10-08T01:00:00Z', 0.9), p('B', '2026-10-08T01:00:00Z', 1.2)]);
    render(<ChlorineHourlyByTrainChart hourly={hourly} trainEntities={[trains[1]]} />);
    expect(screen.queryByTestId('chlorine-hourly-legend-A')).not.toBeInTheDocument();
    expect(screen.getByTestId('chlorine-hourly-legend-B')).toBeInTheDocument();
  });
});
