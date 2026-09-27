import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWellsForPlant } from '@/hooks/useWells';
import { useLocatorsForPlant } from '@/hooks/useLocators';
import { useMeterEvents, type MeterEvent } from '@/data/queries/meterEvents';
import {
  MeterMultiplierWorkflowModal,
  type MeterWorkflowTarget,
} from '../components/MeterMultiplierWorkflowModal';
import {
  PowerMeterMultiplierModal,
  type PowerMeterWorkflowTarget,
} from '../components/PowerMeterMultiplierModal';
import { PowerMeterManageModal } from '../components/PowerMeterManageModal';
import {
  MeterMultiplierTableRow,
  type UnifiedMeterRow,
} from '../components/MeterMultiplierTableRow';
import type { PowerMeterChangeRow } from '../components/MeterMultiplierHistoryDrawer';
import { usePlantMeterConfig } from '@/features/plants/shared';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Gauge, Settings2 } from 'lucide-react';

import { usePlantPowerConfig } from '@/features/plants/hooks/usePlantPowerConfig';

interface MeterMultiplierSectionProps {
  plantId: string;
  canEdit: boolean;
}

type MeterCategory = 'all' | 'product' | 'well' | 'locator' | 'power';

export function MeterMultiplierSection({ plantId, canEdit }: MeterMultiplierSectionProps) {
  const [filter, setFilter] = useState<MeterCategory>('all');
  const [expandedMeters, setExpandedMeters] = useState<Set<string>>(new Set());

  // Water meter modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTarget, setModalTarget] = useState<MeterWorkflowTarget | null>(null);
  const [modalEventType, setModalEventType] = useState<'physical_replacement' | 'multiplier_cutover'>('multiplier_cutover');

  // Power meter modal states
  const [powerModalOpen, setPowerModalOpen] = useState(false);
  const [powerTarget, setPowerTarget] = useState<PowerMeterWorkflowTarget | null>(null);
  const [powerEventType, setPowerEventType] = useState<'physical_replacement' | 'multiplier_cutover'>('multiplier_cutover');
  const [powerManageOpen, setPowerManageOpen] = useState(false);

  // Meter configuration flags
  const { config: meterConfig } = usePlantMeterConfig(plantId);
  const hasSolar = meterConfig.has_solar;
  const hasGrid = meterConfig.has_grid;

  // 1. Fetch Product Meters
  const { data: productMeters = [], isLoading: pmLoading } = useQuery({
    queryKey: ['op-product-meters', plantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_meters' as any)
        .select('id, name, meter_serial, meter_multiplier, multiplier_enabled, status')
        .eq('plant_id', plantId)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!plantId,
  });

  // 2. Fetch Wells
  const { data: wells = [], isLoading: wellsLoading } = useWellsForPlant(plantId);

  // 3. Fetch Locators
  const { data: locators = [], isLoading: locatorsLoading } = useLocatorsForPlant(plantId);

  // 4. Fetch Water Meter Events
  const { data: meterEvents = [], isLoading: eventsLoading } = useMeterEvents(plantId);

  // 5. Fetch Power Config (dual-persistence + auto-retry sync)
  const { powerConfig, isLoading: powerLoading, isLocalOnly: isPowerLocalOnly } = usePlantPowerConfig(plantId);

  // 6. Fetch Power Meter Changes
  const { data: powerMeterChanges = [], isLoading: powerChangesLoading } = useQuery<PowerMeterChangeRow[]>({
    queryKey: ['power-meter-changes', plantId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('power_meter_changes' as any) as any)
        .select('id, plant_id, meter_index, power_kind, event_type, change_date, old_multiplier, old_multiplier_enabled, new_multiplier, new_multiplier_enabled, old_meter_final_reading, new_meter_initial_reading, notes, created_at, changed_by, user_profiles:changed_by (first_name, last_name, email)')
        .eq('plant_id', plantId)
        .order('change_date', { ascending: false });
      if (error) {
        const { data: fallback, error: fbErr } = await (supabase.from('power_meter_changes' as any) as any)
          .select('id, plant_id, meter_index, power_kind, event_type, change_date, old_multiplier, old_multiplier_enabled, new_multiplier, new_multiplier_enabled, old_meter_final_reading, new_meter_initial_reading, notes, created_at, changed_by')
          .eq('plant_id', plantId)
          .order('change_date', { ascending: false });
        if (fbErr) return [];
        return (fallback ?? []) as PowerMeterChangeRow[];
      }
      return (data ?? []) as PowerMeterChangeRow[];
    },
    enabled: !!plantId,
  });

  // Combine unified meter rows
  const allMeters = useMemo<UnifiedMeterRow[]>(() => {
    const list: UnifiedMeterRow[] = [];

    // Product meters
    productMeters.forEach((pm: any) => {
      list.push({
        id: pm.id,
        name: pm.name,
        type: 'product',
        typeLabel: 'Product Meter',
        meter_serial: pm.meter_serial || null,
        meter_multiplier: Number(pm.meter_multiplier ?? 1),
        multiplier_enabled: Boolean(pm.multiplier_enabled),
      });
    });

    // Wells
    wells.forEach((w: any) => {
      list.push({
        id: w.id,
        name: w.name,
        type: 'well',
        typeLabel: 'Well Meter',
        meter_serial: w.meter_serial || null,
        meter_multiplier: Number(w.meter_multiplier ?? 1),
        multiplier_enabled: Boolean(w.multiplier_enabled),
      });
    });

    // Locators
    locators.forEach((l: any) => {
      list.push({
        id: l.id,
        name: l.name,
        type: 'locator',
        typeLabel: 'Locator Meter',
        meter_serial: l.meter_serial || null,
        meter_multiplier: Number(l.meter_multiplier ?? 1),
        multiplier_enabled: Boolean(l.multiplier_enabled),
      });
    });

    // Power meters: Grid
    if (hasGrid) {
      const gridCount = powerConfig?.grid_meter_count ?? 1;
      const gridNames: string[] = Array.isArray(powerConfig?.grid_meter_names) ? powerConfig.grid_meter_names : [];
      const gridMultipliers: number[] = Array.isArray(powerConfig?.grid_meter_multipliers) ? powerConfig.grid_meter_multipliers : [];
      const gridEnabled: boolean[] = Array.isArray(powerConfig?.grid_meter_multipliers_enabled) ? powerConfig.grid_meter_multipliers_enabled : [];

      for (let i = 0; i < gridCount; i++) {
        const mult = Number(gridMultipliers[i] ?? 1);
        const enabled = gridEnabled[i] != null ? Boolean(gridEnabled[i]) : mult > 1;
        list.push({
          id: `power-grid-${i}`,
          name: gridNames[i] || (gridCount === 1 ? 'Grid Meter' : `Grid Meter ${i + 1}`),
          type: 'power',
          typeLabel: 'Grid Meter',
          meter_serial: null,
          meter_multiplier: mult > 0 ? mult : 1,
          multiplier_enabled: enabled,
          powerKind: 'grid',
          meterIndex: i,
        });
      }
    }

    // Power meters: Solar
    if (hasSolar) {
      const solarCount = powerConfig?.solar_meter_count ?? 1;
      const solarNames: string[] = Array.isArray(powerConfig?.solar_meter_names) ? powerConfig.solar_meter_names : [];
      const solarMultipliers: number[] = Array.isArray(powerConfig?.solar_meter_multipliers) ? powerConfig.solar_meter_multipliers : [];
      const solarEnabled: boolean[] = Array.isArray(powerConfig?.solar_meter_multipliers_enabled) ? powerConfig.solar_meter_multipliers_enabled : [];

      for (let i = 0; i < solarCount; i++) {
        const mult = Number(solarMultipliers[i] ?? 1);
        const enabled = solarEnabled[i] != null ? Boolean(solarEnabled[i]) : mult > 1;
        list.push({
          id: `power-solar-${i}`,
          name: solarNames[i] || (solarCount === 1 ? 'Solar Meter' : `Solar Meter ${i + 1}`),
          type: 'power',
          typeLabel: 'Solar Meter',
          meter_serial: null,
          meter_multiplier: mult > 0 ? mult : 1,
          multiplier_enabled: enabled,
          powerKind: 'solar',
          meterIndex: i,
        });
      }
    }

    return list;
  }, [productMeters, wells, locators, powerConfig, hasSolar, hasGrid]);

  const powerMeters = useMemo(() => allMeters.filter(m => m.type === 'power'), [allMeters]);

  const filteredMeters = useMemo(() => {
    if (filter === 'all') return allMeters;
    return allMeters.filter((m) => m.type === filter);
  }, [allMeters, filter]);

  // Group water events by entity_id
  const eventsByEntity = useMemo(() => {
    const map = new Map<string, MeterEvent[]>();
    meterEvents.forEach((ev) => {
      const arr = map.get(ev.entity_id) || [];
      arr.push(ev);
      map.set(ev.entity_id, arr);
    });
    return map;
  }, [meterEvents]);

  // Group power changes by power_kind and meter_index
  const powerChangesByKey = useMemo(() => {
    const map = new Map<string, PowerMeterChangeRow[]>();
    powerMeterChanges.forEach((pc) => {
      const kind = pc.power_kind || 'grid';
      const key = `${kind}-${pc.meter_index}`;
      const arr = map.get(key) || [];
      arr.push(pc);
      map.set(key, arr);
    });
    return map;
  }, [powerMeterChanges]);

  const toggleExpand = (id: string) => {
    setExpandedMeters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openWaterWorkflow = (
    target: UnifiedMeterRow,
    eventType: 'physical_replacement' | 'multiplier_cutover'
  ) => {
    setModalTarget({
      id: target.id,
      name: target.name,
      type: target.type as 'locator' | 'well' | 'product',
      meter_serial: target.meter_serial,
      meter_multiplier: target.meter_multiplier,
      multiplier_enabled: target.multiplier_enabled,
      last_reading: target.last_reading,
    });
    setModalEventType(eventType);
    setModalOpen(true);
  };

  const openPowerMultiplier = (
    target: UnifiedMeterRow,
    eventType: 'physical_replacement' | 'multiplier_cutover'
  ) => {
    setPowerTarget({
      name: target.name,
      powerKind: target.powerKind || 'grid',
      meterIndex: target.meterIndex ?? 0,
      meter_serial: target.meter_serial,
      meter_multiplier: target.meter_multiplier,
      multiplier_enabled: target.multiplier_enabled,
      last_reading: target.last_reading,
    });
    setPowerEventType(eventType);
    setPowerModalOpen(true);
  };

  const isLoading = pmLoading || wellsLoading || locatorsLoading || powerLoading || eventsLoading || powerChangesLoading;

  return (
    <div className="space-y-4">
      {isPowerLocalOnly && (
        <div className="flex items-start gap-2 text-xs text-warn bg-warn-soft border border-warn rounded-md px-3 py-2">
          <span className="mt-0.5">⚠</span>
          <span>
            A saved change to this plant's power meter configuration hasn't reached the database yet — it's stored
            only on this device. Power consumption totals elsewhere won't reflect it until it syncs. This retries
            automatically in the background; keep this app open on this device for it to take effect, or ask an admin
            to check the <code className="font-mono">plant_power_config</code> table/RLS setup.
          </span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-primary" /> Meter Multiplier Configuration
          </h4>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Configure dial multipliers (e.g. ×10) and CT transformer ratios (e.g. ×120) across all water and power meters.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => {
              if (v) setFilter(v as MeterCategory);
            }}
            className="bg-muted/40 border border-border p-0.5 rounded-lg h-7"
          >
            <ToggleGroupItem value="all" className="text-2xs px-2.5 h-6">
              All ({allMeters.length})
            </ToggleGroupItem>
            <ToggleGroupItem value="product" className="text-2xs px-2.5 h-6">
              Product ({productMeters.length})
            </ToggleGroupItem>
            <ToggleGroupItem value="well" className="text-2xs px-2.5 h-6">
              Wells ({wells.length})
            </ToggleGroupItem>
            <ToggleGroupItem value="locator" className="text-2xs px-2.5 h-6">
              Locators ({locators.length})
            </ToggleGroupItem>
            <ToggleGroupItem value="power" className="text-2xs px-2.5 h-6">
              Power ({powerMeters.length})
            </ToggleGroupItem>
          </ToggleGroup>

          {(hasSolar || hasGrid) && canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPowerManageOpen(true)}
              className="h-7 text-2xs px-2.5 gap-1 text-foreground"
              title="Manage Power Meter Counts & Names"
            >
              <Settings2 className="h-3 w-3 text-muted-foreground" /> Power Sources
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border/80 overflow-hidden bg-card">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead className="text-xs font-medium">Meter Asset</TableHead>
              <TableHead className="text-xs font-medium">Serial No.</TableHead>
              <TableHead className="text-xs font-medium">Multiplier Status</TableHead>
              <TableHead className="text-xs font-medium text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                  Loading meter configurations…
                </TableCell>
              </TableRow>
            ) : filteredMeters.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                  No meters found for this filter.
                </TableCell>
              </TableRow>
            ) : (
              filteredMeters.map((m) => {
                const isExpanded = expandedMeters.has(m.id);
                const isPower = m.type === 'power';
                const waterEvents = !isPower ? (eventsByEntity.get(m.id) || []) : [];
                const powerKey = isPower ? `${m.powerKind || 'grid'}-${m.meterIndex ?? 0}` : '';
                const powerChanges = isPower ? (powerChangesByKey.get(powerKey) || []) : [];

                return (
                  <MeterMultiplierTableRow
                    key={`${m.type}-${m.id}`}
                    meter={m}
                    isExpanded={isExpanded}
                    canEdit={canEdit}
                    waterEvents={waterEvents}
                    powerChanges={powerChanges}
                    onToggleExpand={toggleExpand}
                    onOpenWaterWorkflow={openWaterWorkflow}
                    onOpenPowerMultiplier={openPowerMultiplier}
                  />
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <MeterMultiplierWorkflowModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        plantId={plantId}
        target={modalTarget}
        eventType={modalEventType}
      />

      <PowerMeterMultiplierModal
        open={powerModalOpen}
        onOpenChange={setPowerModalOpen}
        plantId={plantId}
        target={powerTarget}
        eventType={powerEventType}
      />

      <PowerMeterManageModal
        open={powerManageOpen}
        onOpenChange={setPowerManageOpen}
        plantId={plantId}
        hasSolar={hasSolar}
        hasGrid={hasGrid}
        initialConfig={powerConfig}
      />
    </div>
  );
}
