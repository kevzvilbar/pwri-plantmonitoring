import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StandardRow } from './ReadingHistoryTable/StandardRow';

describe('StandardRow multiplier rendering and calculation fallback', () => {
  const defaultActions = {
    selectedIds: new Set(),
    handleSelectOne: vi.fn(),
    handleToggleReplacement: vi.fn(),
    viewReplacement: vi.fn(),
  };

  const baseRow = {
    id: 'reading-1',
    current_reading: 10781,
    multiplier_at_reading: 1,
    daily_volume: null,
    is_meter_rollover: false,
    meter_rollover_max: null,
    is_meter_replacement: false,
    is_estimated: false,
  };

  const predecessorRow = {
    id: 'reading-0',
    current_reading: 10765,
  };

  it('falls back to entityMultiplier when multiplier_at_reading is 1 (pre-backfill row)', () => {
    render(
      <table>
        <tbody>
          <StandardRow
            r={baseRow}
            i={0}
            rows={[baseRow, predecessorRow]}
            predecessor={predecessorRow}
            module="locator"
            isDirectMode={false}
            anyEditable={false}
            hasFullAccess={true}
            actions={defaultActions}
            dateStr="Sep 24, 2026 17:21"
            isMeterReplacement={false}
            isEstimated={false}
            isDeleting={false}
            isToggling={false}
            rowEditable={false}
            isEditing={false}
            entityMultiplier={10}
          />
        </tbody>
      </table>
    );

    // Multiplier column should show ×10
    expect(screen.getByText('×10')).toBeInTheDocument();

    // Raw delta is 16.00, Effective Volume should be 160.00 (16 × 10)
    expect(screen.getByText('16.00')).toBeInTheDocument(); // raw delta
    expect(screen.getByText('160.00')).toBeInTheDocument(); // volume
  });

  it('prefers stored multiplier_at_reading when it is > 1 over entityMultiplier', () => {
    const rowWithStoredMult = {
      ...baseRow,
      multiplier_at_reading: 5,
    };

    render(
      <table>
        <tbody>
          <StandardRow
            r={rowWithStoredMult}
            i={0}
            rows={[rowWithStoredMult, predecessorRow]}
            predecessor={predecessorRow}
            module="locator"
            isDirectMode={false}
            anyEditable={false}
            hasFullAccess={true}
            actions={defaultActions}
            dateStr="Sep 24, 2026 17:21"
            isMeterReplacement={false}
            isEstimated={false}
            isDeleting={false}
            isToggling={false}
            rowEditable={false}
            isEditing={false}
            entityMultiplier={10}
          />
        </tbody>
      </table>
    );

    // Multiplier column should show ×5 (stored multiplier took priority over entityMultiplier 10)
    expect(screen.getByText('×5')).toBeInTheDocument();
    expect(screen.getByText('80.00')).toBeInTheDocument(); // 16 × 5
  });

  it('renders ×1 and unmultiplied volume when no multiplier or entityMultiplier=1 is passed', () => {
    render(
      <table>
        <tbody>
          <StandardRow
            r={baseRow}
            i={0}
            rows={[baseRow, predecessorRow]}
            predecessor={predecessorRow}
            module="well"
            isDirectMode={false}
            anyEditable={false}
            hasFullAccess={true}
            actions={defaultActions}
            dateStr="Sep 24, 2026 17:21"
            isMeterReplacement={false}
            isEstimated={false}
            isDeleting={false}
            isToggling={false}
            rowEditable={false}
            isEditing={false}
            entityMultiplier={1}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText('×1')).toBeInTheDocument();
    // Both raw delta and volume are 16.00
    const values = screen.getAllByText('16.00');
    expect(values.length).toBeGreaterThanOrEqual(2);
  });
});
