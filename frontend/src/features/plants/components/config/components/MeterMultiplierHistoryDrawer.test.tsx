import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table, TableBody } from '@/components/ui/table';
import {
  MeterMultiplierHistoryDrawer,
  type PowerMeterChangeRow,
} from './MeterMultiplierHistoryDrawer';
import type { MeterEvent } from '@/data/queries/meterEvents';

describe('MeterMultiplierHistoryDrawer', () => {
  it('renders power meter events with Physical Replacement and Multiplier Cutover badges', () => {
    const powerChanges: PowerMeterChangeRow[] = [
      {
        id: 'pc-1',
        plant_id: 'p-1',
        meter_index: 0,
        power_kind: 'grid',
        event_type: 'physical_replacement',
        change_date: '2026-09-27',
        old_multiplier: 120,
        new_multiplier: 240,
        old_meter_final_reading: 55000,
        new_meter_initial_reading: 10,
        notes: 'Swapped CT to 240:1',
        created_at: '2026-09-27T10:00:00Z',
        user_profiles: { first_name: 'John', last_name: 'Doe', email: 'john@example.com' },
      },
      {
        id: 'pc-2',
        plant_id: 'p-1',
        meter_index: 0,
        power_kind: 'grid',
        event_type: 'multiplier_cutover',
        change_date: '2026-09-20',
        old_multiplier: 1,
        new_multiplier: 120,
        old_meter_final_reading: null,
        new_meter_initial_reading: null,
        notes: 'Applied CT factor',
        created_at: '2026-09-20T10:00:00Z',
        user_profiles: { first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com' },
      },
    ];

    render(
      <Table>
        <TableBody>
          <MeterMultiplierHistoryDrawer
            isPower={true}
            historyCount={2}
            powerChanges={powerChanges}
            waterEvents={[]}
          />
        </TableBody>
      </Table>
    );

    expect(screen.getByText(/Replacement & Multiplier Event History \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('Physical Replacement')).toBeInTheDocument();
    expect(screen.getByText('Multiplier Cutover')).toBeInTheDocument();
    expect(screen.getByText('55000 kWh')).toBeInTheDocument();
    expect(screen.getByText('10 kWh')).toBeInTheDocument();
    expect(screen.getByText('×240')).toBeInTheDocument();
    expect(screen.getByText('Note: Swapped CT to 240:1')).toBeInTheDocument();
  });

  it('renders water meter events with proper badges and serial info', () => {
    const waterEvents: MeterEvent[] = [
      {
        id: 'we-1',
        plant_id: 'p-1',
        entity_type: 'well',
        entity_id: 'w-1',
        event_type: 'physical_replacement',
        effective_at: '2026-09-27T12:00:00Z',
        old_reading_value: 1200,
        old_reading_convention: 'raw',
        old_meter_serial: 'OLD-SN',
        new_reading_value: 0,
        new_multiplier: 10,
        new_multiplier_enabled: true,
        new_meter_serial: 'NEW-SN-123',
        performed_by: 'u-1',
        notes: 'Replaced mechanical dial',
        created_at: '2026-09-27T12:00:00Z',
        performer: { first_name: 'Alice', last_name: 'Admin', email: 'alice@example.com' },
      },
    ];

    render(
      <Table>
        <TableBody>
          <MeterMultiplierHistoryDrawer
            isPower={false}
            historyCount={1}
            powerChanges={[]}
            waterEvents={waterEvents}
          />
        </TableBody>
      </Table>
    );

    expect(screen.getByText('Physical Replacement')).toBeInTheDocument();
    expect(screen.getByText('OLD-SN')).toBeInTheDocument();
    expect(screen.getByText('NEW-SN-123')).toBeInTheDocument();
    expect(screen.getByText('×10')).toBeInTheDocument();
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
  });
});
