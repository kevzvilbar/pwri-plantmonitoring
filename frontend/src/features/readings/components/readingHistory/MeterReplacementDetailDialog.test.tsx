import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MeterReplacementDetailDialog } from './MeterReplacementDetailDialog';
import type { NormalizedReplacement, ReplacementDetailHost } from './replacementTypes';

describe('MeterReplacementDetailDialog multiplier transition', () => {
  const host: ReplacementDetailHost = {
    target: {
      kind: 'well',
      readingId: 'r-1',
      entityId: 'well-1',
      entityName: 'Production Well 1',
    },
  };

  it('renders multiplier transition and dual enabled state tags when newMultiplier is present', () => {
    const records: NormalizedReplacement[] = [
      {
        id: 'repl-1',
        table: 'well_meter_replacements',
        oldSerial: 'OLD-SN',
        oldFinal: 1000,
        newSerial: 'NEW-SN',
        newInitial: 0,
        oldMultiplier: 1,
        oldMultiplierEnabled: false,
        newMultiplier: 10,
        newMultiplierEnabled: true,
        raw: {},
      },
    ];

    render(
      <MeterReplacementDetailDialog
        host={host}
        records={records}
        isLoading={false}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByText('Multiplier:')).toBeInTheDocument();
    expect(screen.getByText('→')).toBeInTheDocument();
    expect(screen.getByText('(Off)')).toBeInTheDocument();
    expect(screen.getByText('(Active)')).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('×1') && !content.startsWith('×10'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('×10'))).toBeInTheDocument();
  });

  it('omits multiplier line when newMultiplier is null (legacy record)', () => {
    const legacyRecords: NormalizedReplacement[] = [
      {
        id: 'repl-legacy',
        table: 'well_meter_replacements',
        oldSerial: 'OLD-LEGACY',
        newSerial: 'NEW-LEGACY',
        oldMultiplier: null,
        newMultiplier: null,
        raw: {},
      },
    ];

    render(
      <MeterReplacementDetailDialog
        host={host}
        records={legacyRecords}
        isLoading={false}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    expect(screen.queryByText('Multiplier:')).not.toBeInTheDocument();
  });
});
