import { MeterToggleTile } from '../MeterConfig';
import { Sun } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PowerMeterSectionProps {
  cfg: import('@/pages/plants/shared').PlantMeterConfig;
  update: (patch: Partial<import('@/pages/plants/shared').PlantMeterConfig>) => void;
  canEdit: boolean;
}

export function PowerMeterSection({ cfg, update, canEdit }: PowerMeterSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Energy sources</span>
        <span className="text-2xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded ml-1">
          {cfg.has_solar && cfg.has_grid ? 'Solar + Grid' : cfg.has_solar ? 'Solar only' : 'Grid only'}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <MeterToggleTile
          icon={<Sun className="h-4 w-4 text-warn" />}
          title="Solar"
          subtitle="Photovoltaic energy source"
          checked={cfg.has_solar}
          onToggle={v => update({ has_solar: v })}
          canEdit={canEdit}
          accentColor="amber"
        />
        <MeterToggleTile
          icon={<GridPylonIcon className="h-4 w-4 text-info" />}
          title="Grid"
          subtitle="Utility / mains power supply"
          checked={cfg.has_grid}
          onToggle={v => update({ has_grid: v })}
          canEdit={canEdit}
          accentColor="blue"
        />
      </div>
      {cfg.has_solar && canEdit && (
        <div className="mt-2 space-y-2">
          <Label htmlFor="meterconfig-solar-capacity-kw" className="text-xs text-muted-foreground">Solar capacity (kW)</Label>
          <Input
            type="number" step="any" value={cfg.solar_capacity_kw ?? ''}
            onChange={e => update({ solar_capacity_kw: e.target.value ? +e.target.value : null })}
            placeholder="e.g. 50"
            className="h-9 text-sm mt-1 max-w-[180px]"
          id="meterconfig-solar-capacity-kw"/>
          <div>
            <p className="text-xs text-muted-foreground mb-1 block">
              Solar reading input mode
              <span className="ml-1 text-2xs opacity-70">(used in Operations entry form)</span>
            </p>
            <div className="flex items-center rounded-md border border-warn overflow-hidden text-xs font-medium w-fit">
              <button
                type="button"
                onClick={() => update({ default_solar_input_mode: 'raw' })}
                className={[
                  'px-3 py-1.5 transition-colors',
                  cfg.default_solar_input_mode !== 'direct'
                    ? 'bg-warn text-white'
                    : 'bg-transparent text-muted-foreground hover:bg-warn-soft',
                ].join(' ')}
                title="Cumulative meter reading — Δ auto-computed from previous"
              >
                Raw Meter
              </button>
              <button
                type="button"
                onClick={() => update({ default_solar_input_mode: 'direct' })}
                className={[
                  'px-3 py-1.5 transition-colors border-l border-warn',
                  cfg.default_solar_input_mode === 'direct'
                    ? 'bg-warn text-white'
                    : 'bg-transparent text-muted-foreground hover:bg-warn-soft',
                ].join(' ')}
                title="Enter daily kWh directly — no cumulative meter needed"
              >
                Direct kWh
              </button>
            </div>
            <p className="text-2xs text-muted-foreground mt-1">
              {cfg.default_solar_input_mode === 'direct'
                ? 'Operators enter daily solar kWh directly (e.g. from inverter display).'
                : 'Operators enter a cumulative meter reading; Δ is auto-computed.'}
            </p>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        Power meter names (Solar/Grid meter count &amp; labels) are configured in the <strong className="font-medium">Power tab</strong>.
      </p>
    </div>
  );
}
