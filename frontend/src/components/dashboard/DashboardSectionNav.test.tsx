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
    expect(getByText('Inline')).toBeDefined();
    expect(getByText('Sections')).toBeDefined();
    expect(getByText('Dialog')).toBeDefined();

    const inlineBtn = getByLabelText('Inline view');
    fireEvent.click(inlineBtn);
    expect(onViewModeChange).toHaveBeenCalledWith('inline');
  });
});
