import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Table, TableBody } from '@/components/ui/table';
import { MeterMultiplierTableRow, type UnifiedMeterRow } from './MeterMultiplierTableRow';

describe('MeterMultiplierTableRow', () => {
  const waterMeter: UnifiedMeterRow = {
    id: 'prod-1',
    name: 'Product Meter 1',
    type: 'product',
    typeLabel: 'Product Meter',
    meter_serial: 'SN-PROD-101',
    meter_multiplier: 10,
    multiplier_enabled: true,
  };

  const powerMeter: UnifiedMeterRow = {
    id: 'power-grid-0',
    name: 'Main Grid Feed',
    type: 'power',
    typeLabel: 'Grid Meter',
    meter_serial: null,
    meter_multiplier: 120,
    multiplier_enabled: true,
    powerKind: 'grid',
    meterIndex: 0,
  };

  it('renders water meter row with correct status badge and actions', () => {
    const onWaterWorkflow = vi.fn();
    const onPowerMultiplier = vi.fn();

    render(
      <Table>
        <TableBody>
          <MeterMultiplierTableRow
            meter={waterMeter}
            isExpanded={false}
            canEdit={true}
            waterEvents={[]}
            powerChanges={[]}
            onToggleExpand={vi.fn()}
            onOpenWaterWorkflow={onWaterWorkflow}
            onOpenPowerMultiplier={onPowerMultiplier}
          />
        </TableBody>
      </Table>
    );

    expect(screen.getByText('Product Meter 1')).toBeInTheDocument();
    expect(screen.getByText('Product Meter')).toBeInTheDocument();
    expect(screen.getByText('×10 Active')).toBeInTheDocument();
    expect(screen.getByText('SN-PROD-101')).toBeInTheDocument();

    const configureBtn = screen.getByRole('button', { name: /^Configure$/i });
    fireEvent.click(configureBtn);
    expect(onWaterWorkflow).toHaveBeenCalledWith(waterMeter, 'multiplier_cutover');

    const replaceBtn = screen.getByRole('button', { name: /^Replace$/i });
    fireEvent.click(replaceBtn);
    expect(onWaterWorkflow).toHaveBeenCalledWith(waterMeter, 'physical_replacement');
  });

  it('renders power meter row with uniform status badge and routes actions to power multiplier modal', () => {
    const onWaterWorkflow = vi.fn();
    const onPowerMultiplier = vi.fn();

    render(
      <Table>
        <TableBody>
          <MeterMultiplierTableRow
            meter={powerMeter}
            isExpanded={false}
            canEdit={true}
            waterEvents={[]}
            powerChanges={[]}
            onToggleExpand={vi.fn()}
            onOpenWaterWorkflow={onWaterWorkflow}
            onOpenPowerMultiplier={onPowerMultiplier}
          />
        </TableBody>
      </Table>
    );

    expect(screen.getByText('Main Grid Feed')).toBeInTheDocument();
    expect(screen.getByText('Grid Meter')).toBeInTheDocument();
    expect(screen.getByText('×120 Active')).toBeInTheDocument();

    const configureBtn = screen.getByRole('button', { name: /^Configure$/i });
    fireEvent.click(configureBtn);
    expect(onPowerMultiplier).toHaveBeenCalledWith(powerMeter, 'multiplier_cutover');

    const replaceBtn = screen.getByRole('button', { name: /^Replace$/i });
    fireEvent.click(replaceBtn);
    expect(onPowerMultiplier).toHaveBeenCalledWith(powerMeter, 'physical_replacement');
  });
});
