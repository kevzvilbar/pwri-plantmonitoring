import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitMeterMultiplierWorkflow } from './meterMultiplier';
import { supabase } from '@/integrations/supabase/client';

describe('submitMeterMultiplierWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits a multiplier cutover event and updates entity table and reading table', async () => {
    const fromSpy = vi.spyOn(supabase, 'from');

    const result = await submitMeterMultiplierWorkflow({
      plantId: 'plant-1',
      entityType: 'well',
      entityId: 'well-1',
      eventType: 'multiplier_cutover',
      effectiveAt: '2026-09-26T08:00:00Z',
      oldReadingValue: 1250,
      oldReadingConvention: 'pre_multiplied',
      newReadingValue: 125,
      newMultiplier: 10,
      newMultiplierEnabled: true,
      performedBy: 'user-1',
      notes: 'Initial x10 cutover',
    });

    expect(result.error).toBeNull();
    expect(fromSpy).toHaveBeenCalledWith('meter_events');
    expect(fromSpy).toHaveBeenCalledWith('wells');
    expect(fromSpy).toHaveBeenCalledWith('well_readings');
  });

  it('submits a physical replacement event with serial numbers', async () => {
    const fromSpy = vi.spyOn(supabase, 'from');

    const result = await submitMeterMultiplierWorkflow({
      plantId: 'plant-1',
      entityType: 'locator',
      entityId: 'loc-1',
      eventType: 'physical_replacement',
      effectiveAt: '2026-09-26T08:00:00Z',
      oldReadingValue: 9800,
      oldMeterSerial: 'SN-OLD-1',
      newReadingValue: 0,
      newMultiplier: 10,
      newMultiplierEnabled: true,
      newMeterSerial: 'SN-NEW-2',
      performedBy: 'user-1',
      notes: 'Swapped damaged meter',
    });

    expect(result.error).toBeNull();
    expect(fromSpy).toHaveBeenCalledWith('meter_events');
    expect(fromSpy).toHaveBeenCalledWith('locators');
    expect(fromSpy).toHaveBeenCalledWith('locator_readings');
  });
});
