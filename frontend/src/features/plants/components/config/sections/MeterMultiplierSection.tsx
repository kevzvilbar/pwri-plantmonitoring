import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWellsForPlant } from '@/hooks/useWells';
import { useLocatorsForPlant } from '@/hooks/useLocators';
import { useMeterEvents, type MeterEvent } from '@/data/queries/meterEvents';
import {
  MeterMultiplierWorkflowModal,
  type MeterWorkflowTarget,
} from '../components/MeterMultiplierWorkflowModal';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Gauge,
  Droplet,
  MapPin,
  RotateCw,
  Sliders,
  History,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface MeterMultiplierSectionProps {
  plantId: string;
  canEdit: boolean;
}

type MeterCategory = 'all' | 'product' | 'well' | 'locator';

interface UnifiedMeterRow {
  id: string;
  name: string;
  type: 'product' | 'well' | 'locator';
  typeLabel: string;
  meter_serial: string | null;
  meter_multiplier: number;
  multiplier_enabled: boolean;
  last_reading?: number | null;
}

export function MeterMultiplierSection({ plantId, canEdit }: MeterMultiplierSectionProps) {
  const [filter, setFilter] = useState<MeterCategory>('all');
  const [expandedMeters, setExpandedMeters] = useState<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTarget, setModalTarget] = useState<MeterWorkflowTarget | null>(null);
  const [modalEventType, setModalEventType] = useState<'physical_replacement' | 'multiplier_cutover'>('multiplier_cutover');

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

  // 4. Fetch Meter Events
  const { data: meterEvents = [], isLoading: eventsLoading } = useMeterEvents(plantId);

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

    return list;
  }, [productMeters, wells, locators]);

  const filteredMeters = useMemo(() => {
    if (filter === 'all') return allMeters;
    return allMeters.filter((m) => m.type === filter);
  }, [allMeters, filter]);

  // Group events by entity_id
  const eventsByEntity = useMemo(() => {
    const map = new Map<string, MeterEvent[]>();
    meterEvents.forEach((ev) => {
      const arr = map.get(ev.entity_id) || [];
      arr.push(ev);
      map.set(ev.entity_id, arr);
    });
    return map;
  }, [meterEvents]);

  const toggleExpand = (id: string) => {
    setExpandedMeters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openWorkflow = (
    target: UnifiedMeterRow,
    eventType: 'physical_replacement' | 'multiplier_cutover'
  ) => {
    setModalTarget({
      id: target.id,
      name: target.name,
      type: target.type,
      meter_serial: target.meter_serial,
      meter_multiplier: target.meter_multiplier,
      multiplier_enabled: target.multiplier_enabled,
      last_reading: target.last_reading,
    });
    setModalEventType(eventType);
    setModalOpen(true);
  };

  const isLoading = pmLoading || wellsLoading || locatorsLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-primary" /> Meter Multiplier Configuration
          </h4>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Meters with mechanical dial registers that require a fixed multiplier factor (e.g. ×10) to calculate actual cubic meters (m³).
          </p>
        </div>

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
        </ToggleGroup>
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
                const events = eventsByEntity.get(m.id) || [];
                const hasEvents = events.length > 0;

                const icon =
                  m.type === 'product' ? (
                    <Gauge className="h-3.5 w-3.5 text-primary" />
                  ) : m.type === 'well' ? (
                    <Droplet className="h-3.5 w-3.5 text-kpi-wells" />
                  ) : (
                    <MapPin className="h-3.5 w-3.5 text-kpi-locator" />
                  );

                return (
                  <React.Fragment key={`${m.type}-${m.id}`}>
                    <TableRow className={cn('hover:bg-muted/20 transition-colors', isExpanded && 'bg-muted/10')}>
                      <TableCell className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleExpand(m.id)}
                          className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                          title={hasEvents ? `${events.length} audit event(s)` : 'No replacement history'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className={cn('h-3.5 w-3.5', !hasEvents && 'opacity-40')} />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded bg-muted/60 flex items-center justify-center shrink-0">
                            {icon}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-foreground">{m.name}</div>
                            <div className="text-3xs text-muted-foreground">{m.typeLabel}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">
                        {m.meter_serial || '—'}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {m.multiplier_enabled ? (
                          <Badge variant="outline" className="border-primary/50 text-primary bg-primary-soft text-2xs font-mono font-semibold">
                            ×{m.meter_multiplier} Active
                          </Badge>
                        ) : m.meter_multiplier > 1 ? (
                          <Badge variant="outline" className="border-warn/50 text-warn bg-warn-soft text-2xs font-mono">
                            Configured Off (×{m.meter_multiplier})
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-border text-muted-foreground text-2xs font-mono">
                            No Multiplier (×1)
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openWorkflow(m, 'multiplier_cutover')}
                            disabled={!canEdit}
                            className="h-7 text-2xs px-2.5 gap-1 text-foreground"
                          >
                            <Sliders className="h-3 w-3 text-muted-foreground" /> Configure
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openWorkflow(m, 'physical_replacement')}
                            disabled={!canEdit}
                            className="h-7 text-2xs px-2.5 gap-1 text-foreground"
                          >
                            <RotateCw className="h-3 w-3 text-muted-foreground" /> Replace
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Expandable History Drawer */}
                    {isExpanded && (
                      <TableRow className="bg-muted/15 border-b border-border/40">
                        <TableCell colSpan={5} className="py-3 px-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                <History className="h-3 w-3" /> Replacement & Multiplier Event History ({events.length})
                              </span>
                            </div>

                            {events.length === 0 ? (
                              <p className="text-2xs text-muted-foreground italic py-1">
                                No replacement or cutover events logged for this meter yet.
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {events.map((ev) => (
                                  <div
                                    key={ev.id}
                                    className="rounded border border-border/60 bg-card p-2 text-2xs space-y-1 shadow-2xs"
                                  >
                                    <div className="flex items-center justify-between font-medium">
                                      <div className="flex items-center gap-2">
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            'text-3xs px-1.5 py-0',
                                            ev.event_type === 'physical_replacement'
                                              ? 'border-info text-info bg-info-soft'
                                              : 'border-primary text-primary bg-primary-soft'
                                          )}
                                        >
                                          {ev.event_type === 'physical_replacement'
                                            ? 'Physical Replacement'
                                            : 'Multiplier Cutover'}
                                        </Badge>
                                        <span className="text-foreground">
                                          {format(parseISO(ev.effective_at), 'MMM d, yyyy h:mm a')}
                                        </span>
                                      </div>
                                      <span className="text-muted-foreground">
                                        {ev.performer?.first_name
                                          ? `${ev.performer.first_name} ${ev.performer.last_name || ''}`
                                          : ev.performer?.email || 'System'}
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5 text-muted-foreground font-mono">
                                      <div>
                                        Old Serial: <span className="text-foreground">{ev.old_meter_serial || '—'}</span>
                                      </div>
                                      <div>
                                        New Serial: <span className="text-foreground">{ev.new_meter_serial || '—'}</span>
                                      </div>
                                      <div>
                                        Multiplier:{' '}
                                        <span className="text-foreground font-semibold">
                                          {ev.new_multiplier_enabled ? `×${ev.new_multiplier}` : 'Off (×1)'}
                                        </span>
                                      </div>
                                      <div>
                                        Baseline Read: <span className="text-foreground">{ev.new_reading_value ?? '—'}</span>
                                      </div>
                                    </div>

                                    {ev.notes && (
                                      <p className="text-3xs text-muted-foreground italic pt-0.5 border-t border-border/30 mt-1">
                                        Note: {ev.notes}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
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
    </div>
  );
}
