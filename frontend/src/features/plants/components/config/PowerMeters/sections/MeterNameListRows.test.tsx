import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MeterNameListRows } from './MeterNameListRows';

describe('MeterNameListRows source-type badge', () => {
  it('labels solar rows "Solar Gen"', () => {
    render(
      <MeterNameListRows
        count={1}
        names={['Solar Meter 1']}
        accentColor="yellow"
        defaultPrefix="Solar Meter"
        onSave={vi.fn()}
        onRemoveLast={vi.fn()}
      />
    );

    const row = screen.getByText('Solar Meter 1').closest('div')!.parentElement!;
    expect(within(row).getByText('Solar Gen')).toBeInTheDocument();
    expect(within(row).queryByText('Grid Import')).not.toBeInTheDocument();
  });

  it('labels grid rows "Grid Import", not "Solar Gen"', () => {
    render(
      <MeterNameListRows
        count={3}
        names={['Grid Meter 1 STP', 'Grid Meter 2 Pumphouse', 'Grid Meter 3 Main']}
        accentColor="blue"
        defaultPrefix="Grid Meter"
        onSave={vi.fn()}
        onRemoveLast={vi.fn()}
      />
    );

    // Regression guard for the bug where every grid row rendered "Solar Gen"
    // regardless of accentColor/meter kind.
    expect(screen.queryByText('Solar Gen')).not.toBeInTheDocument();
    expect(screen.getAllByText('Grid Import')).toHaveLength(3);
    expect(screen.getByText('Grid Meter 1 STP')).toBeInTheDocument();
    expect(screen.getByText('Grid Meter 2 Pumphouse')).toBeInTheDocument();
    expect(screen.getByText('Grid Meter 3 Main')).toBeInTheDocument();
  });
});
