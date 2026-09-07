import { MeterToggleTile } from '../MeterConfig';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendingUp, BarChart2, Gauge } from 'lucide-react';

interface ProductMeterSectionProps {
  cfg: import('@/pages/plants/shared').PlantMeterConfig;
  update: (patch: Partial<import('@/pages/plants/shared').PlantMeterConfig>) => void;
  canEdit: boolean;
}

export function ProductMeterSection({ cfg, update, canEdit }: ProductMeterSectionProps) {
  return (
    <>
      {/* ── Production source ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Production volume source</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([
            { val: 'product', label: 'Dedicated product meter', sub: 'Separate meter for finished product' },
            { val: 'permeate', label: 'Permeate meter = production', sub: 'No product meter — permeate IS production' },
            { val: 'both', label: 'Product meter + Permeate', sub: 'Two independent sources — totals are added together' },
          ] as const).map(opt => (
            <label key={opt.val} className={[
              'flex items-center gap-3 p-3 rounded-lg border transition-colors',
              cfg.ro_production_source === opt.val ? 'border-primary/60 bg-primary-soft/70' : 'border-border bg-muted/30',
              canEdit ? 'cursor-pointer' : 'cursor-default',
            ].join(' ')}>
              <div className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center ${cfg.ro_production_source === opt.val ? 'border-primary' : 'border-muted-foreground/40'}`}>
                {cfg.ro_production_source === opt.val && <div className="h-2 w-2 rounded-full bg-primary" />}
              </div>
              <div>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.sub}</div>
              </div>
              {canEdit && (
                <input type="radio" className="sr-only" checked={cfg.ro_production_source === opt.val}
                  onChange={() => update({
                    ro_production_source: opt.val,
                    permeate_is_production: opt.val !== 'product',
                  })} />
              )}
            </label>
          ))}
        </div>
        {cfg.ro_production_source === 'both' && (
          <p className="mt-2 text-xs text-warn bg-warn-soft border border-warn rounded-md px-2.5 py-1.5">
            Only pick this if the product meter and the permeate meter measure <em>different</em> water
            (e.g. a bulk/mirrored meter from another plant, plus this plant's own RO output). If they
            measure the same water twice, use "Permeate meter = production" instead — otherwise Total
            Production and NRW % will be inflated.
          </p>
        )}
      </div>

      {/* ── Permeate = Production: cut-off (manager only) ── */}
      {(cfg.ro_production_source === 'permeate' || cfg.ro_production_source === 'both') && (() => {
        return (
          <div className="rounded-lg border border-primary bg-primary-soft/40 p-3 space-y-2.5">
            {/* Header row with master toggle */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <span>⏱</span> Permeate readings are production
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Readings are collected hourly. A daily "cut-off" groups them into calendar days.
                  The day label is the date <em>after</em> the cut-off crosses midnight.
                </div>
              </div>
              <Switch
                checked={cfg.permeate_is_production}
                onCheckedChange={canEdit ? (v) => update({ permeate_is_production: v }) : undefined}
                disabled={!canEdit}
                className="h-8 w-14 sm:h-5 sm:w-9 shrink-0 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-4 sm:[&>span]:w-4 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary"
              />
            </div>

            {cfg.permeate_is_production && (
              <div className="space-y-4 pt-1 border-t border-primary">

                {/* ── Daily cut-off time ── */}
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Daily cut-off time</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(cfg.permeate_cutoff_enabled ?? true)
                          ? 'Readings taken just after midnight are attributed to the previous production day.'
                          : 'Cut-off is optional — new entries use the natural calendar date. Historical data still groups by the saved time below.'}
                      </p>
                    </div>
                    <Switch
                      checked={cfg.permeate_cutoff_enabled ?? true}
                      onCheckedChange={canEdit ? (v) => update({ permeate_cutoff_enabled: v }) : undefined}
                      disabled={!canEdit}
                      className="h-8 w-14 sm:h-5 sm:w-9 shrink-0 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-4 sm:[&>span]:w-4 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary"
                    />
                  </div>

                  {/* Always show the time input — it's used for historical grouping even when toggle is off */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {canEdit ? (
                      <Input
                        type="time"
                        value={cfg.permeate_cutoff_time}
                        onChange={e => update({ permeate_cutoff_time: e.target.value })}
                        className="h-8 w-32 text-sm font-mono"
                      />
                    ) : (
                      <span className="font-mono text-sm bg-muted px-2 py-1 rounded border border-border">
                        {cfg.permeate_cutoff_time || '00:20'}
                      </span>
                    )}
                    <div className="text-xs text-muted-foreground leading-relaxed max-w-xs">
                      {(() => {
                        const t = cfg.permeate_cutoff_time || '00:20';
                        const [hh, mm] = t.split(':');
                        const cutH = parseInt(hh ?? '0');
                        const cutM = parseInt(mm ?? '20');
                        const pad = (n: number) => String(n).padStart(2, '0');
                        const nextM = (cutM + 1) % 60;
                        const nextH = cutM === 59 ? (cutH + 1) % 24 : cutH;
                        return (cfg.permeate_cutoff_enabled ?? true) ? (
                          <span>
                            Day recorded as <strong>May 4</strong> = readings from{' '}
                            <span className="font-mono">May 3 {pad(nextH)}:{pad(nextM)}</span> to{' '}
                            <span className="font-mono">May 4 {t}</span>
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground/70">
                            Saved for historical grouping. New entries use <strong>midnight</strong> as the day boundary.
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {!canEdit && (
                    <p className="text-2xs text-muted-foreground">Only managers and admins can change these settings.</p>
                  )}
                </div>

              </div>
            )}
          </div>
        );
      })()}

      {/* ══ SECTION: NRW / Product ══ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Production & NRW</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <MeterToggleTile
            icon={<BarChart2 className="h-4 w-4 text-primary" />}
            title="Enable NRW calculation"
            subtitle="Auto-compute non-revenue water"
            checked={cfg.nrw_enabled}
            onToggle={v => update({ nrw_enabled: v })}
            canEdit={canEdit}
          />
          <MeterToggleTile
            icon={<Gauge className="h-4 w-4 text-info" />}
            title="Billed volume meter"
            subtitle="Separate meter for billed / sold water"
            checked={cfg.has_billed_volume_meter}
            onToggle={v => update({ has_billed_volume_meter: v })}
            canEdit={canEdit}
            accentColor="blue"
          />
        </div>
      </div>
    </>
  );
}
