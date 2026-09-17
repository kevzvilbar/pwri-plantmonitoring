import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { DashboardSectionNav } from './DashboardSectionNav';

describe('DashboardSectionNav', () => {
  it('renders section navigation buttons', () => {
    const { getAllByText } = render(<DashboardSectionNav />);
    expect(getAllByText('Action Center').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Overview').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Quality').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Production Cost').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Health & Coverage').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Data Trust').length).toBeGreaterThanOrEqual(1);
  });

  it('renders floating view mode toggle buttons when provided', () => {
    const onViewModeChange = vi.fn();
    const { getByText, getByTestId, getByLabelText } = render(
      <DashboardSectionNav
        viewMode="sections"
        onViewModeChange={onViewModeChange}
      />
    );

    expect(getByTestId('floating-dashboard-view-mode')).toBeDefined();
    // Legacy hero test-id kept as alias on the same toggle for E2E compat.
    expect(getByText('Inline')).toBeDefined();
    expect(getByText('Sections')).toBeDefined();
    expect(getByText('Dialog')).toBeDefined();

    const inlineBtn = getByLabelText('Inline view');
    fireEvent.click(inlineBtn);
    expect(onViewModeChange).toHaveBeenCalledWith('inline');
  });

  it('renders unified range picker row when range props provided', () => {
    const onRangeChange = vi.fn();
    const { getByTestId } = render(
      <DashboardSectionNav
        range="7D"
        onRangeChange={onRangeChange}
        chartFrom="2026-09-01"
        chartTo="2026-09-07"
        chartYear={2026}
        chartMonth="YTD"
      />
    );

    // Unified control bar keeps legacy test-ids so E2E keeps passing.
    expect(getByTestId('dashboard-control-bar')).toBeDefined();
    expect(getByTestId('dash-range-7D')).toBeDefined();
    expect(getByTestId('dash-range-label').textContent).toContain('2026-09-01');
  });

  it('omits range row when range props not provided (backwards-compat)', () => {
    const { queryByTestId } = render(<DashboardSectionNav />);
    expect(queryByTestId('dashboard-control-bar')).toBeDefined();
    expect(queryByTestId('dash-range-7D')).toBeNull();
  });
});
