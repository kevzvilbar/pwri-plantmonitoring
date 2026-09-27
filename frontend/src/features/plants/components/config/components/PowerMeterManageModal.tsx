import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, Minus, Check, Sun, Loader2 } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';
import { MeterNameListRows } from '../PowerMeters/sections/MeterNameListRows';
import { GridMeterListRows } from '../PowerMeters/sections/GridMeterListRows';
import { POWER_CONFIG_KEY } from '../PowerMeters/PowerMeters';
import { toast } from 'sonner';

interface PowerMeterManageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plantId: string;
  hasSolar?: boolean;
  hasGrid?: boolean;
  initialConfig?: {
    solar_meter_count?: number | null;
    solar_meter_names?: string[] | null;
    grid_meter_count?: number | null;
    grid_meter_names?: string[] | null;
    grid_meter_multipliers?: number[] | null;
  } | null;
}

const MAX_METERS = 20;

export function PowerMeterManageModal({
  open,
  onOpenChange,
  plantId,
  hasSolar = true,
  hasGrid = true,
  initialConfig,
}: PowerMeterManageModalProps) {
  const qc = useQueryClient();
  const [solarCount, setSolarCount] = useState(1);
  const [gridCount, setGridCount] = useState(1);
  const [solarNames, setSolarNames] = useState<string[]>(
    Array.from({ length: MAX_METERS }, (_, i) => `Solar Meter ${i + 1}`)
  );
  const [gridNames, setGridNames] = useState<string[]>(
    Array.from({ length: MAX_METERS }, (_, i) => `Grid Meter ${i + 1}`)
  );
  const [gridMultipliers, setGridMultipliers] = useState<number[]>(
    Array.from({ length: MAX_METERS }, () => 1)
  );
  const [saving, setSaving] = useState(false);
  const isDirty = useRef(false);

  useEffect(() => {
    if (!initialConfig || !open) return;
    if (initialConfig.solar_meter_count != null) setSolarCount(initialConfig.solar_meter_count);
    if (initialConfig.grid_meter_count != null) setGridCount(initialConfig.grid_meter_count);
    if (Array.isArray(initialConfig.solar_meter_names) && initialConfig.solar_meter_names.length) {
      setSolarNames(initialConfig.solar_meter_names);
    }
    if (Array.isArray(initialConfig.grid_meter_names) && initialConfig.grid_meter_names.length) {
      setGridNames(initialConfig.grid_meter_names);
    }
    if (Array.isArray(initialConfig.grid_meter_multipliers) && initialConfig.grid_meter_multipliers.length) {
      setGridMultipliers(prev => {
        const next = [...prev];
        (initialConfig.grid_meter_multipliers as number[]).forEach((m, i) => {
          next[i] = m > 0 ? m : 1;
        });
        return next;
      });
    }
    isDirty.current = false;
  }, [initialConfig, open]);

  const saveConfig = async () => {
    setSaving(true);
    const payload = {
      plant_id: plantId,
      solar_meter_count: solarCount,
      solar_meter_names: solarNames.slice(0, solarCount),
      grid_meter_count: gridCount,
      grid_meter_names: gridNames.slice(0, gridCount),
      grid_meter_multipliers: gridMultipliers.slice(0, gridCount),
      updated_at: new Date().toISOString(),
    };

    let savedToDb = false;
    try {
      const { error } = await (supabase.from('plant_power_config' as any) as any)
        .upsert(payload, { onConflict: 'plant_id' });
      if (!error) savedToDb = true;
    } catch {
      // Ignore database table absence fallback
    }

    try {
      localStorage.setItem(POWER_CONFIG_KEY(plantId), JSON.stringify(payload));
    } catch {
      // Ignore local storage error
    }

    setSaving(false);
    isDirty.current = false;
    qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] });
    toast.success(savedToDb ? 'Power meter configuration saved' : 'Power meter configuration saved (local)');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <GridPylonIcon className="h-4 w-4 text-primary" /> Power Meter Sources &amp; Multipliers
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure power meter counts, custom names, and CT (Current Transformer) ratio multiplier factors for this plant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      <div className="flex items-center gap-0.5 bg-card rounded-md border border-border p-0.5 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => {
                            isDirty.current = true;
                            setSolarCount(c => Math.max(1, c - 1));
                          }}
                          disabled={solarCount <= 1}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
                          aria-label="Decrease solar meter count"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center text-xs font-mono font-semibold">{solarCount}</span>
                        <button
                          type="button"
                          onClick={() => {
                            isDirty.current = true;
                            setSolarCount(c => Math.min(20, c + 1));
                          }}
                          disabled={solarCount >= 20}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
                          aria-label="Increase solar meter count"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider">Meter Names</p>
                    <MeterNameListRows
                      count={solarCount}
                      names={solarNames}
                      accentColor="yellow"
                      defaultPrefix="Solar Meter"
                      onSave={names => {
                        isDirty.current = true;
                        setSolarNames(names);
                      }}
                      onRemoveLast={() => {
                        isDirty.current = true;
                        setSolarCount(c => Math.max(1, c - 1));
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {hasGrid && (
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
                      <div className="flex items-center gap-0.5 bg-card rounded-md border border-border p-0.5 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => {
                            isDirty.current = true;
                            setGridCount(c => Math.max(1, c - 1));
                          }}
                          disabled={gridCount <= 1}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
                          aria-label="Decrease grid meter count"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center text-xs font-mono font-semibold">{gridCount}</span>
                        <button
                          type="button"
                          onClick={() => {
                            isDirty.current = true;
                            setGridCount(c => Math.min(20, c + 1));
                          }}
                          disabled={gridCount >= 20}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
                          aria-label="Increase grid meter count"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider">Meter Names &amp; CT Multipliers</p>
                    <GridMeterListRows
                      count={gridCount}
                      names={gridNames}
                      multipliers={gridMultipliers}
                      onSaveNames={names => {
                        isDirty.current = true;
                        setGridNames(names);
                      }}
                      onSaveMultiplier={(idx, val) => {
                        isDirty.current = true;
                        setGridMultipliers(prev => {
                          const next = [...prev];
                          next[idx] = val;
                          return next;
                        });
                      }}
                      onRemoveLast={() => {
                        isDirty.current = true;
                        setGridCount(c => Math.max(1, c - 1));
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-9">
            Cancel
          </Button>
          <Button onClick={saveConfig} disabled={saving} className="h-9 bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
