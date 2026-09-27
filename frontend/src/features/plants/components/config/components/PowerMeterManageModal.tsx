import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, Minus, Check, Sun, Loader2 } from 'lucide-react';
import { GridPylonIcon } from '@/features/plants/shared';
import { MeterNameListRows } from '../PowerMeters/sections/MeterNameListRows';
import { usePlantPowerConfig, type PlantPowerConfig } from '@/features/plants/hooks/usePlantPowerConfig';
import { toast } from 'sonner';

interface PowerMeterManageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plantId: string;
  hasSolar?: boolean;
  hasGrid?: boolean;
  initialConfig?: Partial<PlantPowerConfig> | null;
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
  const { powerConfig, savePowerConfig } = usePlantPowerConfig(plantId);
  const [solarCount, setSolarCount] = useState(1);
  const [gridCount, setGridCount] = useState(1);
  const [solarNames, setSolarNames] = useState<string[]>(
    Array.from({ length: MAX_METERS }, (_, i) => `Solar Meter ${i + 1}`)
  );
  const [gridNames, setGridNames] = useState<string[]>(
    Array.from({ length: MAX_METERS }, (_, i) => `Grid Meter ${i + 1}`)
  );
  const [saving, setSaving] = useState(false);
  const isDirty = useRef(false);

  const activeCfg = initialConfig || powerConfig;

  useEffect(() => {
    if (!activeCfg || !open) return;
    if (activeCfg.solar_meter_count != null) setSolarCount(activeCfg.solar_meter_count);
    if (activeCfg.grid_meter_count != null) setGridCount(activeCfg.grid_meter_count);
    if (Array.isArray(activeCfg.solar_meter_names) && activeCfg.solar_meter_names.length) {
      setSolarNames(prev => {
        const next = [...prev];
        activeCfg.solar_meter_names!.forEach((n, idx) => { next[idx] = n; });
        return next;
      });
    }
    if (Array.isArray(activeCfg.grid_meter_names) && activeCfg.grid_meter_names.length) {
      setGridNames(prev => {
        const next = [...prev];
        activeCfg.grid_meter_names!.forEach((n, idx) => { next[idx] = n; });
        return next;
      });
    }
    isDirty.current = false;
  }, [activeCfg, open]);

  const saveConfig = async () => {
    setSaving(true);
    const existingGridMults = powerConfig?.grid_meter_multipliers || initialConfig?.grid_meter_multipliers || [];
    const existingGridEnabled = powerConfig?.grid_meter_multipliers_enabled || initialConfig?.grid_meter_multipliers_enabled || [];
    const existingSolarMults = powerConfig?.solar_meter_multipliers || initialConfig?.solar_meter_multipliers || [];
    const existingSolarEnabled = powerConfig?.solar_meter_multipliers_enabled || initialConfig?.solar_meter_multipliers_enabled || [];

    const payload: PlantPowerConfig = {
      grid_meter_count: gridCount,
      grid_meter_names: gridNames.slice(0, gridCount),
      grid_meter_multipliers: Array.from({ length: gridCount }, (_, i) => existingGridMults[i] ?? 1),
      grid_meter_multipliers_enabled: Array.from({ length: gridCount }, (_, i) => existingGridEnabled[i] ?? false),
      solar_meter_count: solarCount,
      solar_meter_names: solarNames.slice(0, solarCount),
      solar_meter_multipliers: Array.from({ length: solarCount }, (_, i) => existingSolarMults[i] ?? 1),
      solar_meter_multipliers_enabled: Array.from({ length: solarCount }, (_, i) => existingSolarEnabled[i] ?? false),
    };

    const saved = await savePowerConfig(payload);
    setSaving(false);
    isDirty.current = false;
    if (saved) {
      toast.success('Power meter structure saved');
    } else {
      toast.warning('Power meter structure saved locally (offline or database unreachable)');
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <GridPylonIcon className="h-4 w-4 text-primary" /> Power Meter Sources &amp; Asset Configuration
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure power meter quantities and custom names. Multipliers are managed per meter via the Configure and Replace actions.
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
                    <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider">Meter Names</p>
                    <MeterNameListRows
                      count={gridCount}
                      names={gridNames}
                      accentColor="blue"
                      defaultPrefix="Grid Meter"
                      onSave={names => {
                        isDirty.current = true;
                        setGridNames(names);
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
