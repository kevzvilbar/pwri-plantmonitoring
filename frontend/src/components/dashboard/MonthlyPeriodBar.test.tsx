import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonthlyPeriodBar } from './MonthlyPeriodBar';
import { useAppStore } from '@/store/appStore';
import { rangeKeyToDays } from './types';

describe('MonthlyPeriodBar Component', () => {
  it('renders correctly with year, period label, YTD pill, and 12 month buttons', () => {
    const handlePeriodChange = vi.fn();
    const handleBackToDays = vi.fn();

    render(
      <MonthlyPeriodBar
        year={2026}
        selectedMonth="YTD"
        onPeriodChange={handlePeriodChange}
        onBackToDays={handleBackToDays}
        testIdPrefix="test-monthly"
      />
    );

    expect(screen.getByTestId('test-monthly-bar')).toBeInTheDocument();
    expect(screen.getByTestId('test-monthly-pill-YTD')).toBeInTheDocument();
    expect(screen.getByText('PERIOD:')).toBeInTheDocument();
    expect(screen.getByTestId('test-monthly-back-days')).toBeInTheDocument();

    // Verify all 12 month pills are present
    const monthPills = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    monthPills.forEach((m) => {
      expect(screen.getByTestId(`test-monthly-pill-${m}`)).toBeInTheDocument();
    });
  });

  it('triggers onPeriodChange when clicking a month pill', () => {
    const handlePeriodChange = vi.fn();

    render(
      <MonthlyPeriodBar
        year={2026}
        selectedMonth="YTD"
        onPeriodChange={handlePeriodChange}
        testIdPrefix="test-monthly"
      />
    );

    // Click August ('08')
    const augBtn = screen.getByTestId('test-monthly-pill-08');
    fireEvent.click(augBtn);

    expect(handlePeriodChange).toHaveBeenCalledTimes(1);
    expect(handlePeriodChange).toHaveBeenCalledWith(2026, '08');
  });

  it('disables future months in the current year', () => {
    const handlePeriodChange = vi.fn();

    render(
      <MonthlyPeriodBar
        year={2026}
        selectedMonth="YTD"
        onPeriodChange={handlePeriodChange}
        testIdPrefix="test-monthly"
      />
    );

    // Month 12 (December 2026) is in the future relative to September 2026
    const decBtn = screen.getByTestId('test-monthly-pill-12');
    expect(decBtn).toBeDisabled();
    fireEvent.click(decBtn);

    expect(handlePeriodChange).not.toHaveBeenCalled();
  });

  it('triggers onPeriodChange when clicking YTD Full Year', () => {
    const handlePeriodChange = vi.fn();

    render(
      <MonthlyPeriodBar
        year={2026}
        selectedMonth="05"
        onPeriodChange={handlePeriodChange}
        testIdPrefix="test-monthly"
      />
    );

    const ytdBtn = screen.getByTestId('test-monthly-pill-YTD');
    fireEvent.click(ytdBtn);

    expect(handlePeriodChange).toHaveBeenCalledTimes(1);
    expect(handlePeriodChange).toHaveBeenCalledWith(2026, 'YTD');
  });

  it('triggers onBackToDays when the back button is clicked', () => {
    const handleBackToDays = vi.fn();

    render(
      <MonthlyPeriodBar
        year={2026}
        selectedMonth="YTD"
        onPeriodChange={vi.fn()}
        onBackToDays={handleBackToDays}
        testIdPrefix="test-monthly"
      />
    );

    const backBtn = screen.getByTestId('test-monthly-back-days');
    fireEvent.click(backBtn);

    expect(handleBackToDays).toHaveBeenCalledTimes(1);
  });
});

describe('useAppStore Monthly Period calculations', () => {
  it('computes YTD period accurately (Jan 1 to Dec 31)', () => {
    const { setChartMonthlyPeriod } = useAppStore.getState();
    setChartMonthlyPeriod(2026, 'YTD');

    const state = useAppStore.getState();
    expect(state.chartRange).toBe('MONTHLY');
    expect(state.chartYear).toBe(2026);
    expect(state.chartMonth).toBe('YTD');
    expect(state.chartFrom).toBe('2026-01-01');
    expect(state.chartTo).toBe('2026-12-31');
  });

  it('computes individual month period accurately (e.g. August 2026)', () => {
    const { setChartMonthlyPeriod } = useAppStore.getState();
    setChartMonthlyPeriod(2026, '08');

    const state = useAppStore.getState();
    expect(state.chartRange).toBe('MONTHLY');
    expect(state.chartYear).toBe(2026);
    expect(state.chartMonth).toBe('08');
    expect(state.chartFrom).toBe('2026-08-01');
    expect(state.chartTo).toBe('2026-08-31');
  });

  it('correctly accounts for leap years in February', () => {
    const { setChartMonthlyPeriod } = useAppStore.getState();
    
    // Leap year 2024
    setChartMonthlyPeriod(2024, '02');
    expect(useAppStore.getState().chartTo).toBe('2024-02-29');

    // Non-leap year 2025
    setChartMonthlyPeriod(2025, '02');
    expect(useAppStore.getState().chartTo).toBe('2025-02-28');
  });

  it('updates chartFrom and chartTo when switching range to MONTHLY directly', () => {
    const { setChartRange, setChartMonthlyPeriod } = useAppStore.getState();
    setChartMonthlyPeriod(2026, '06');
    setChartRange('7D');
    expect(useAppStore.getState().chartRange).toBe('7D');

    // Switch back to MONTHLY
    setChartRange('MONTHLY');
    const state = useAppStore.getState();
    expect(state.chartRange).toBe('MONTHLY');
    expect(state.chartFrom).toBe('2026-06-01');
    expect(state.chartTo).toBe('2026-06-30');
  });

  it('rangeKeyToDays calculates days between dates when range is MONTHLY', () => {
    const days = rangeKeyToDays('MONTHLY', '2026-08-01', '2026-08-31');
    expect(days).toBe(31);
  });
});

