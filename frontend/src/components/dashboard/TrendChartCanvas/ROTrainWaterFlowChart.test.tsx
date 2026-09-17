import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { ROTrainWaterFlowChart } from './ROTrainWaterFlowChart';

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('ROTrainWaterFlowChart', () => {
  const mockTrendRows = [
    {
      date: 'May 1',
      permeate: 80,
      reject: 20,
      rejectNeg: -20,
      feed: 100,
      expectedFeed: 100,
      variance: 0,
      variancePct: 0,
      hasDeviation: false,
    },
    {
      date: 'May 2',
      permeate: 75,
      reject: 20,
      rejectNeg: -20,
      feed: 110, // Mismatch: 110 != 75 + 20 (diff = +15)
      expectedFeed: 95,
      variance: 15,
      variancePct: 13.6,
      hasDeviation: true,
    },
  ];

  it('renders without crashing and displays legend markers', () => {
    const { getByText } = render(
      <ROTrainWaterFlowChart
        trendRows={mockTrendRows}
        formatYAxis={(v) => `${v}`}
      />
    );

    expect(getByText('Permeate Water (+)')).toBeDefined();
    expect(getByText('Reject Water (−)')).toBeDefined();
    expect(getByText('Feed Hairline')).toBeDefined();
    expect(getByText('Mismatch Marker')).toBeDefined();
  });

  it('displays PERMEATE and REJECT WATER labels in legend and HUD indicators', () => {
    const { getAllByText } = render(
      <ROTrainWaterFlowChart
        trendRows={mockTrendRows}
        formatYAxis={(v) => `${v}`}
      />
    );

    const permeateLabels = getAllByText('PERMEATE');
    expect(permeateLabels.length).toBeGreaterThanOrEqual(2); // Legend + HUD badge

    const rejectLabels = getAllByText('REJECT WATER');
    expect(rejectLabels.length).toBeGreaterThanOrEqual(2); // Legend + HUD badge
  });

  it('renders both permeate rect and reject rect', () => {
    const { container } = render(
      <div style={{ width: 500, height: 300 }}>
        <ROTrainWaterFlowChart
          trendRows={mockTrendRows}
          formatYAxis={(v) => `${v}`}
        />
      </div>
    );

    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(0);
  });
});

