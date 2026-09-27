import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Gauge, Sun, Zap, Loader2, SlidersHorizontal, ArrowUpRight } from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { usePlantMeterConfig, GridPylonIcon } from '../../../shared';
import { usePowerHistoryQuery } from '../hooks/usePowerHistoryQuery';
import { PowerChartHeader } from '../sections/PowerChartHeader';
import { PowerKpiStrip } from '../sections/PowerKpiStrip';
import { PowerChart } from '../sections/PowerChart';
import { PowerMeterChangeForm } from '../sections/PowerMeterChangeForm';

export { PowerMeterChangeForm as PowerMeterChangeDialog } from '../sections/PowerMeterChangeForm';

export const POWER_CONFIG_KEY = (plantId: string) => `power_config_${plantId}`;

export function PowerMetersCard({ plant }: { plant: any }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin, isManager } = useAuth();
  const canEdit = isAdmin || isManager;

  const { config: meterConfig } = usePlantMeterConfig(plant.id);
  const hasSolar = meterConfig.has_solar;
  const hasGrid = meterConfig.has_grid;

  const { data: savedConfig, isLoading } = useQuery({
    queryKey: ['plant-power-config', plant.id],
    queryFn: async () => {
      try {
        const { data, error } = await (supabase.from('plant_power_config' as any) as any)
          .select('solar_meter_count, solar_meter_names, grid_meter_count, grid_meter_names, grid_meter_multipliers')
          .eq('plant_id', plant.id)
          .maybeSingle();
        if (!error && data) return data as any;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(POWER_CONFIG_KEY(plant.id));
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    },
  });

  const [changeMeterOpen, setChangeMeterOpen] = useState(false);

  const solarCount = savedConfig?.solar_meter_count ?? 1;
  const gridCount = savedConfig?.grid_meter_count ?? 1;
  const solarNames: string[] = Array.isArray(savedConfig?.solar_meter_names) ? savedConfig.solar_meter_names : [];
  const gridNames: string[] = Array.isArray(savedConfig?.grid_meter_names) ? savedConfig.grid_meter_names : [];
  const gridMultipliers: number[] = Array.isArray(savedConfig?.grid_meter_multipliers) ? savedConfig.grid_meter_multipliers : [];

  if (isLoading) return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading power config…
    </div>
  );

  return (
    <div className="space-y-3">
      <Card className="p-4 sm:p-5 space-y-3.5 rounded-lg border border-border shadow-xs bg-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
              <Gauge className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm text-foreground">Power Meter Configuration &amp; CT Multipliers</h3>
                <div className="flex items-center gap-1.5">
                  {hasSolar && (
                    <span className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full bg-warn-soft text-warn border border-warn/30">
                      <Sun className="h-3 w-3" /><span>Solar ({solarCount})</span>
                    </span>
                  )}
                  {hasGrid && (
                    <span className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full bg-info-soft text-info border border-info/30">
                      <GridPylonIcon className="h-3 w-3" /><span>Grid ({gridCount})</span>
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Power meter counts, names, and CT multipliers are uniformly managed in{' '}
                <strong className="text-foreground font-medium">Plant Config → Meter Multipliers</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setChangeMeterOpen(true)}
                  className="gap-1.5 h-8 text-xs font-medium"
                >
                  <ChangeMeterIcon className="h-3.5 w-3.5 text-primary" />
                  <span>Change Meter / CT Ratio</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/plants/${plant.id}?tab=configuration`)}
                  className="gap-1.5 h-8 text-xs font-medium"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Plant Config</span>
                  <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Configured Meters Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-border/50">
          {hasGrid && Array.from({ length: gridCount }).map((_, i) => {
            const name = gridNames[i] || (gridCount === 1 ? 'Grid Meter' : `Grid Meter ${i + 1}`);
            const mult = gridMultipliers[i] ?? 1;
            return (
              <div
                key={`grid-summary-${i}`}
                className="flex items-center justify-between p-2.5 rounded-md border border-border/70 bg-muted/20 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-6 w-6 rounded bg-info-soft text-info flex items-center justify-center shrink-0">
                    <GridPylonIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="truncate">
                    <div className="font-semibold text-foreground truncate">{name}</div>
                    <div className="text-3xs text-muted-foreground">Grid Power Source</div>
                  </div>
                </div>
                <div className="shrink-0 ml-2 font-mono">
                  {mult > 1 ? (
                    <Badge variant="outline" className="border-primary/50 text-primary bg-primary-soft text-3xs font-semibold">
                      ×{mult} CT Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-border text-muted-foreground text-3xs">
                      ×1 Multiplier
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}

          {hasSolar && Array.from({ length: solarCount }).map((_, i) => {
            const name = solarNames[i] || (solarCount === 1 ? 'Solar Meter' : `Solar Meter ${i + 1}`);
            return (
              <div
                key={`solar-summary-${i}`}
                className="flex items-center justify-between p-2.5 rounded-md border border-border/70 bg-muted/20 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-6 w-6 rounded bg-warn-soft text-warn flex items-center justify-center shrink-0">
                    <Sun className="h-3.5 w-3.5" />
                  </div>
                  <div className="truncate">
                    <div className="font-semibold text-foreground truncate">{name}</div>
                    <div className="text-3xs text-muted-foreground">Photovoltaic Source</div>
                  </div>
                </div>
                <div className="shrink-0 ml-2 font-mono">
                  <Badge variant="outline" className="border-border text-muted-foreground text-3xs">
                    Direct / Raw (×1)
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <PowerConsumptionEnergyMixWrapper plantId={plant.id} hasSolar={hasSolar} hasGrid={hasGrid} />
      </Card>

      {changeMeterOpen && (
        <PowerMeterChangeForm
          plant={plant}
          gridMeterCount={gridCount}
          gridMeterNames={gridNames}
          currentMultipliers={gridMultipliers}
          onClose={() => {
            setChangeMeterOpen(false);
            qc.invalidateQueries({ queryKey: ['plant-power-config', plant.id] });
          }}
        />
      )}
    </div>
  );
}

function PowerConsumptionEnergyMixWrapper({
  plantId, hasSolar, hasGrid,
}: {
  plantId: string;
  hasSolar: boolean;
  hasGrid: boolean;
}) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');
  const [source, setSource] = useState<'both' | 'solar' | 'grid'>('both');

  const { rows, isLoading, rangeAggregates } = usePowerHistoryQuery(plantId, range);

  const chartRows = useMemo(() => rows.map(r => ({
    date: r.date,
    solar: source !== 'grid' ? r.solar : 0,
    grid: source !== 'solar' ? r.grid : 0,
  })), [rows, source]);

  const rangeLabel = range === 'all' ? 'all time' : `last ${range}d`;

  return (
    <div className="space-y-4">
      <PowerChartHeader
        range={range} onRangeChange={setRange}
        source={source} onSourceChange={setSource}
        hasSolar={hasSolar} hasGrid={hasGrid}
        rows={rows} plantId={plantId} rangeLabel={rangeLabel}
      />
      <PowerKpiStrip hasSolar={hasSolar} hasGrid={hasGrid} rows={rows} rangeLabel={rangeLabel} />
      <PowerChart
        chartRows={chartRows} hasSolar={hasSolar} hasGrid={hasGrid}
        isLoading={isLoading} rangeAggregates={rangeAggregates}
      />
    </div>
  );
}
