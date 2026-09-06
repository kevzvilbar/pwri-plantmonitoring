import { describe, it, expect, beforeEach } from 'vitest';
import { useChartStore, isValidDateStr, defaultChartFrom, defaultChartTo } from './chartStore';

describe('useChartStore', () => {
  beforeEach(() => {
    useChartStore.setState({
      chartRange: '7D',
      chartFrom: defaultChartFrom(),
      chartTo: defaultChartTo(),
      chartYear: new Date().getFullYear(),
      chartMonth: 'YTD',
    });
  });

  it('should have correct initial default dates and range', () => {
    const state = useChartStore.getState();
    expect(state.chartRange).toBe('7D');
    expect(state.chartFrom).toBe(defaultChartFrom());
    expect(state.chartTo).toBe(defaultChartTo());
  });

  it('should update range correctly with setChartRange', () => {
    useChartStore.getState().setChartRange('30D');
    expect(useChartStore.getState().chartRange).toBe('30D');
    
    useChartStore.getState().setChartRange('14D');
    expect(useChartStore.getState().chartRange).toBe('14D');
  });

  it('should set custom dates and keep current chartRange string', () => {
    // The implementation updates from/to directly without necessarily switching chartRange string to 'CUSTOM' unless specified in another way,
    // actually, setChartCustomDates just updates from and to.
    useChartStore.getState().setChartCustomDates('2023-01-01', '2023-01-31');
    const state = useChartStore.getState();
    expect(state.chartFrom).toBe('2023-01-01');
    expect(state.chartTo).toBe('2023-01-31');
  });

  it('should ignore invalid date strings in setChartCustomDates', () => {
    const originalFrom = useChartStore.getState().chartFrom;
    useChartStore.getState().setChartCustomDates('invalid', '2023-01-31');
    const state = useChartStore.getState();
    expect(state.chartFrom).toBe(originalFrom); // unchanged
    expect(state.chartTo).toBe('2023-01-31');
  });

  it('should set monthly period and update from/to', () => {
    useChartStore.getState().setChartMonthlyPeriod(2023, '02');
    const state = useChartStore.getState();
    expect(state.chartRange).toBe('MONTHLY');
    expect(state.chartYear).toBe(2023);
    expect(state.chartMonth).toBe('02');
    expect(state.chartFrom).toBe('2023-02-01');
    expect(state.chartTo).toBe('2023-02-28'); // 2023 is not a leap year

    // YTD
    useChartStore.getState().setChartMonthlyPeriod(2023, 'YTD');
    const stateYtd = useChartStore.getState();
    expect(stateYtd.chartFrom).toBe('2023-01-01');
    expect(stateYtd.chartTo).toBe('2023-12-31');
  });

  it('should validate dates using isValidDateStr', () => {
    expect(isValidDateStr('2023-01-01')).toBe(true);
    expect(isValidDateStr('invalid')).toBe(false);
    expect(isValidDateStr(null)).toBe(false);
    expect(isValidDateStr('2023-13-45')).toBe(false); // Valid string format but invalid Date
  });
});
