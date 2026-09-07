import { useState, useEffect, useRef, useMemo } from 'react';
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, Minus, Check, MapPin, Gauge, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet } from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { usePlantMeterConfig, GridPylonIcon } from '../../shared';
import { usePowerHistoryQuery } from '../../config/hooks/usePowerHistoryQuery';
import { PowerChartHeader } from '../../config/sections/PowerChartHeader';
import { PowerKpiStrip } from '../../config/sections/PowerKpiStrip';
import { PowerChart } from '../../config/sections/PowerChart';
import { PowerMeterChangeForm } from '../../config/sections/PowerMeterChangeForm';
import { MeterNameList } from './sections/MeterNameList';
import { GridMeterListRows } from './sections/GridMeterListRows';
import { MeterNameListRows } from './sections/MeterNameListRows';

export { PowerMeterChangeForm as PowerMeterChangeDialog } from '../../config/sections/PowerMeterChangeForm';

export const POWER_CONFIG_KEY = (plantId: string) => `power_config_${plantId}`;

export function PowerMetersCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isAdmin, isManager } = useAuth();
  const canEdit = isAdmin || isManager;

  const { config: meterConfig } = usePlantMeterConfig(plant.id);
  const hasSolar = meterConfig.has_solar;
  const hasGrid  = meterConfig.has_grid;

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

  const [solarCount, setSolarCount] = useState(1);
  const [gridCount,  setGridCount]  = useState(1);
  const MAX_METERS = 20;
  const [solarNames, setSolarNames] = useState<string[]>(
    Array.from({ length: MAX_METERS }, (_, i) => `Solar Meter ${i + 1}`)
  );
  const [gridNames,  setGridNames]  = useState<string[]>(
    Array.from({ length: MAX_METERS }, (_, i) => `Grid Meter ${i + 1}`)
  );
  const [gridMultipliers, setGridMultipliers] = useState<number[]>(
    Array.from({ length: MAX_METERS }, () => 1)
  );
  const [saving, setSaving] = useState(false);

  const isDirty = useRef(false);
  const [showDirty, setShowDirty] = useState(false);

  useEffect(() => {
    if (!savedConfig || isDirty.current) return;
    if (savedConfig.solar_meter_count != null) setSolarCount(savedConfig.solar_meter_count);
    if (savedConfig.grid_meter_count  != null) setGridCount(savedConfig.grid_meter_count);
    if (Array.isArray(savedConfig.solar_meter_names) && savedConfig.solar_meter_names.length) setSolarNames(savedConfig.solar_meter_names);
    if (Array.isArray(savedConfig.grid_meter_names)  && savedConfig.grid_meter_names.length)  setGridNames(savedConfig.grid_meter_names);
    if (Array.isArray(savedConfig.grid_meter_multipliers) && savedConfig.grid_meter_multipliers.length) {
      setGridMultipliers(prev => {
        const next = [...prev];
        (savedConfig.grid_meter_multipliers as number[]).forEach((m, i) => { next[i] = m > 0 ? m : 1; });
        return next;
      });
    }
  }, [savedConfig]);

  const saveConfig = async () => {
    setSaving(true);
    const payload = {
      plant_id: plant.id,
      solar_meter_count: solarCount,
      solar_meter_names: solarNames,
      grid_meter_count:  gridCount,
      grid_meter_names:  gridNames,
      grid_meter_multipliers: gridMultipliers.slice(0, gridCount),
      updated_at: new Date().toISOString(),
    };
    let savedToDb = false;
    try {
      const { error } = await (supabase.from('plant_power_config' as any) as any)
        .upsert(payload, { onConflict: 'plant_id' });
      if (!error) savedToDb = true;
    } catch { /* table missing */ }
    try { localStorage.setItem(POWER_CONFIG_KEY(plant.id), JSON.stringify(payload)); } catch { /* ignore */ }
    setSaving(false);
    isDirty.current = false;
    setShowDirty(false);
    qc.invalidateQueries({ queryKey: ['plant-power-config', plant.id] });
    toast.success(savedToDb ? 'Power meter config saved' : 'Power meter config saved (local)');
  };

  if (isLoading) return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading power config…
    </div>
  );

  return (
    <div className="space-y-3">
      <Card className="p-4 sm:p-5 space-y-4 rounded-lg border border-border shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-primary-soft text-primary flex items-center justify-center shrink-0">
              <Gauge className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Power Meter Configuration</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure meters per source. Names appear in <strong className="text-foreground font-medium">Operations → Power</strong>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasSolar && (
              <span className="inline-flex items-center gap-1 text-2xs font-medium px-2.5 py-0.5 rounded-full bg-warn-soft text-warn border border-warn/30">
                <Sun className="h-3 w-3" /><span>Solar</span>
              </span>
            )}
            {hasGrid && (
              <span className="inline-flex items-center gap-1 text-2xs font-medium px-2.5 py-0.5 rounded-full bg-info-soft text-info border border-info/30">
                <GridPylonIcon className="h-3 w-3" /><span>Grid</span>
              </span>
            )}
          </div>
        </div>

        <div className={`grid gap-3 ${hasSolar ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
          {hasSolar && (
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-md bg-warn-soft text-warn flex items-center justify-center shrink-0">
                      <Sun className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-foreground">Solar meters</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-3xs text-muted-foreground uppercase font-mono font-medium tracking-wider">Count</span>
                    <div className="flex items-center gap-0.5 bg-card rounded-md border border-border p-0.5 shadow-xs">
                      <button onClick={() => canEdit && setSolarCount(c => Math.max(1, c - 1))} disabled={!canEdit || solarCount <= 1} className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors" aria-label="Decrease solar meter count"><Minus className="h-3 w-3" /></button>
                      <span className="w-5 text-center text-xs font-mono font-semibold">{solarCount}</span>
                      <button onClick={() => canEdit && setSolarCount(c => Math.min(20, c + 1))} disabled={!canEdit || solarCount >= 20} className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors" aria-label="Increase solar meter count"><Plus className="h-3 w-3" /></button>
                    </div>
                  </div>
                </div>
                {canEdit && (
                  <div className="space-y-1">
                    <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider">Meter Names</p>
                    <MeterNameListRows count={solarCount} names={solarNames} accentColor="yellow" defaultPrefix="Solar Meter"
                      onSave={names => { isDirty.current = true; setShowDirty(true); setSolarNames(names); }}
                      onRemoveLast={() => setSolarCount(c => Math.max(1, c - 1))} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-info-soft text-info flex items-center justify-center shrink-0">
                    <GridPylonIcon className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">Grid meters</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-3xs text-muted-foreground uppercase font-mono font-medium tracking-wider">Count</span>
                  <div className="flex items-center gap-0.5 bg-card rounded-md border border-border p-0.5 shadow-xs">
                    <button onClick={() => canEdit && setGridCount(c => Math.max(1, c - 1))} disabled={!canEdit || gridCount <= 1} className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors" aria-label="Decrease grid meter count"><Minus className="h-3 w-3" /></button>
                    <span className="w-5 text-center text-xs font-mono font-semibold">{gridCount}</span>
                    <button onClick={() => canEdit && setGridCount(c => Math.min(20, c + 1))} disabled={!canEdit || gridCount >= 20} className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors" aria-label="Increase grid meter count"><Plus className="h-3 w-3" /></button>
                  </div>
                </div>
              </div>
              {canEdit && (
                <div className="space-y-1">
                  <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider">Meter Names &amp; CT Multipliers</p>
                  <GridMeterListRows
                    count={gridCount}
                    names={gridNames}
                    multipliers={gridMultipliers}
                    onSaveNames={names => { isDirty.current = true; setShowDirty(true); setGridNames(names); }}
                    onSaveMultiplier={(idx, val) => { isDirty.current = true; setShowDirty(true); setGridMultipliers(prev => { const next = [...prev]; next[idx] = val; return next; }); }}
                    onRemoveLast={() => setGridCount(c => Math.max(1, c - 1))}
                  />
                </div>
              )}
            </div>
            {canEdit && (
              <div className="pt-2 border-t border-border/60">
                <Button size="sm" variant="outline" onClick={() => setChangeMeterOpen(true)} className="w-full gap-1.5 h-8 text-xs font-medium">
                  <ChangeMeterIcon className="h-3.5 w-3.5 text-primary" />
                  <span>Change Meter / Update CT Ratio</span>
                </Button>
              </div>
            )}
          </div>
        </div>

        {canEdit ? (
          <div className="pt-2 border-t border-border/60">
            {showDirty ? (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-warn-soft/60 border border-warn/60 animate-fade-in">
                <div className="flex items-center gap-2 text-xs font-semibold text-warn">
                  <span className="h-2 w-2 rounded-full bg-warn animate-ping" />
                  <span>You have unsaved power meter configuration changes</span>
                </div>
                <Button onClick={saveConfig} disabled={saving} size="sm" className="w-full sm:w-auto px-5 h-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold shadow-sm">
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
                  Save power meter config
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between text-2xs text-muted-foreground px-1 py-0.5">
                <span className="flex items-center gap-1.5 text-accent font-medium">
                  <Check className="h-3.5 w-3.5" /> Power meter configuration is synced &amp; up to date
                </span>
                <span className="hidden sm:inline text-muted-foreground/60">
                  {solarCount} solar · {gridCount} grid configured
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">Only managers and admins can edit meter configuration.</p>
        )}
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
  const [range, setRange]   = useState<'30' | '90' | '180' | 'all'>('30');
  const [source, setSource] = useState<'both' | 'solar' | 'grid'>('both');

  const { rows, isLoading, rangeAggregates } = usePowerHistoryQuery(plantId, range);

  const chartRows = useMemo(() => rows.map(r => ({
    date: r.date,
    solar: source !== 'grid'  ? r.solar : 0,
    grid:  source !== 'solar' ? r.grid  : 0,
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
