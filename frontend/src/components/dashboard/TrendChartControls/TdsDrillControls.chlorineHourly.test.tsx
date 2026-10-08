import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TdsDrillControls } from './TdsDrillControls';

const props = (over: Record<string, unknown> = {}) => ({
  viewGran: 'daily' as const,
  setViewGran: vi.fn(),
  rangeDays: 7,
  metric: 'chlorine',
  roDrillMode: 'by-hour',
  setRoDrillMode: vi.fn(),
  showTrainFilter: false,
  setShowTrainFilter: vi.fn(),
  allTrainsSelected: true,
  noTrainsSelected: false,
  roTrainEntities: [],
  selectedTrainIds: null,
  stackMode: 'grouped' as const,
  setStackMode: vi.fn(),
  selectAllTrains: vi.fn(),
  clearAllTrains: vi.fn(),
  toggleTrain: vi.fn(),
  ...over,
});

describe('TdsDrillControls: chlorine Hourly is locked to By train', () => {
  it('disables Total and shows By train as active while Hourly is on', () => {
    const p = props();
    render(<TdsDrillControls {...p} />);
    const total = screen.getByTestId('drill-chlorine-breakdown-total') as HTMLButtonElement;
    const byTrain = screen.getByTestId('drill-chlorine-breakdown-by-train') as HTMLButtonElement;
    expect(total.disabled).toBe(true);
    expect(byTrain.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(total);
    fireEvent.click(byTrain);
    expect(p.setRoDrillMode).not.toHaveBeenCalled();
  });

  it('keeps the train filter available in Hourly', () => {
    render(<TdsDrillControls {...props()} />);
    expect(screen.getByRole('button', { name: /Filter trains/i })).toBeInTheDocument();
  });

  it('leaves Total enabled for chlorine outside Hourly, and for other metrics in Hourly', () => {
    const { unmount } = render(<TdsDrillControls {...props({ roDrillMode: 'default' })} />);
    expect((screen.getByTestId('drill-chlorine-breakdown-total') as HTMLButtonElement).disabled).toBe(false);
    unmount();
    render(<TdsDrillControls {...props({ metric: 'tds', roDrillMode: 'by-hour' })} />);
    expect((screen.getByTestId('drill-tds-breakdown-total') as HTMLButtonElement).disabled).toBe(false);
  });
});
