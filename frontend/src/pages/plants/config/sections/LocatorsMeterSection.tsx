import { MeterToggleTile, MeterGroupChips, LocatorGroupRealitySync } from '../MeterConfig';
import { MapPin, Gauge, Calendar, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface LocatorsMeterSectionProps {
  cfg: import('@/pages/plants/shared').PlantMeterConfig;
  update: (patch: Partial<import('@/pages/plants/shared').PlantMeterConfig>) => void;
  canEdit: boolean;
  locators: Array<{ id: string; name: string; product_meter_id: string | null }>;
  configProductMeters: Array<{ id: string; name: string }>;
}

export function LocatorsMeterSection({ cfg, update, canEdit, locators, configProductMeters }: LocatorsMeterSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Locators / distribution</span>
        <span className="text-2xs text-muted-foreground ml-1">(each locator always has its own water meter)</span>
      </div>
      <p className="text-xs font-medium text-muted-foreground mb-2">Bulk / product metering</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <MeterToggleTile
          icon={<Gauge className="h-4 w-4 text-primary" />}
          title="Dedicated bulk meter"
          subtitle="Some locators have their own bulk meter"
          checked={cfg.locators_dedicated_bulk_ids.length > 0}
          onToggle={v => update({ locators_dedicated_bulk_ids: v ? (locators[0] ? [locators[0].id] : []) : [] })}
          canEdit={canEdit}
        />
        <MeterToggleTile
          icon={<Gauge className="h-4 w-4 text-kpi-ro" />}
          title="Shared bulk meter group"
          subtitle="Multiple locators share one bulk meter"
          checked={cfg.locators_shared_bulk_groups.length > 0}
          onToggle={v => update({ locators_shared_bulk_groups: v ? [{ id: crypto.randomUUID(), name: 'South Cluster', members: [] }] : [] })}
          canEdit={canEdit}
          accentColor="purple"
        />
        <MeterToggleTile
          icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
          title="No bulk meter (some locators)"
          subtitle="Certain locators only track water meter"
          checked={cfg.locators_no_bulk}
          onToggle={v => update({ locators_no_bulk: v })}
          canEdit={canEdit}
          accentColor="teal"
        />
      </div>

      {/* Dedicated bulk locators */}
      {cfg.locators_dedicated_bulk_ids.length > 0 && (
        <div className="space-y-1.5 mb-2">
          <p className="text-xs font-medium text-muted-foreground">Locators with dedicated bulk meter</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {cfg.locators_dedicated_bulk_ids.map(id => {
              const l = locators.find(x => x.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-primary-soft text-primary border border-primary/40 font-medium shadow-2xs">
                  <span>{l?.name ?? id}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => update({ locators_dedicated_bulk_ids: cfg.locators_dedicated_bulk_ids.filter(x => x !== id) })}
                      aria-label={`Remove ${l?.name ?? id}`}
                      title="Remove"
                      className="h-3.5 w-3.5 rounded-full hover:bg-primary/20 flex items-center justify-center text-primary/70 hover:text-primary transition-colors -mr-1"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              );
            })}
            {canEdit && locators.filter(l => !cfg.locators_dedicated_bulk_ids.includes(l.id)).length > 0 && (
              <Select onValueChange={id => update({ locators_dedicated_bulk_ids: [...cfg.locators_dedicated_bulk_ids, id] })}>
                <SelectTrigger className="h-6 w-auto text-xs px-2.5 py-0 rounded-full border-dashed border-border/80 bg-muted/30 hover:bg-muted font-medium">
                  <Plus className="h-3 w-3 mr-1 text-primary" />Add locator
                </SelectTrigger>
                <SelectContent>
                  {locators.filter(l => !cfg.locators_dedicated_bulk_ids.includes(l.id)).map(l => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      )}

      {/* Shared bulk locator groups */}
      {cfg.locators_shared_bulk_groups.length > 0 && (
        <div className="space-y-2.5 mb-2">
          <p className="text-xs font-medium text-muted-foreground">
            Shared bulk meter groups <span className="font-normal opacity-70">(for reference / reporting only — each locator still logs separately. This list is independent from the real "Assign Locators" assignment on the Product tab, which drives NRW/derived-meter calculations. Use "Compare to Assign Locators" below to check for drift.)</span>
          </p>
          {cfg.locators_shared_bulk_groups.map((grp, gi) => (
            <div key={grp.id} className="space-y-1.5">
              <MeterGroupChips
                label={grp.name}
                groupName={grp.name}
                members={grp.members}
                allEntities={locators}
                entityLabel="locator"
                canEdit={canEdit}
                onGroupNameChange={name => {
                  const next = [...cfg.locators_shared_bulk_groups];
                  next[gi] = { ...grp, name };
                  update({ locators_shared_bulk_groups: next });
                }}
                onMembersChange={members => {
                  const next = [...cfg.locators_shared_bulk_groups];
                  next[gi] = { ...grp, members };
                  update({ locators_shared_bulk_groups: next });
                }}
                onDeleteGroup={() => update({ locators_shared_bulk_groups: cfg.locators_shared_bulk_groups.filter((_, i) => i !== gi) })}
              />
              <LocatorGroupRealitySync
                productMeters={configProductMeters}
                locators={locators}
                members={grp.members}
                canEdit={canEdit}
                onSync={members => {
                  const next = [...cfg.locators_shared_bulk_groups];
                  next[gi] = { ...grp, members };
                  update({ locators_shared_bulk_groups: next });
                }}
              />
            </div>
          ))}
          {canEdit && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 rounded-lg border-border/80 font-semibold"
              onClick={() => update({ locators_shared_bulk_groups: [...cfg.locators_shared_bulk_groups, { id: crypto.randomUUID(), name: `Cluster ${cfg.locators_shared_bulk_groups.length + 1}`, members: [] }] })}>
              <Plus className="h-3 w-3 text-primary" />Add group
            </Button>
          )}
        </div>
      )}

      {/* ── Locator readings frequency ── */}
      <div className="mt-3 rounded-lg border border-primary bg-primary-soft/40 p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="text-sm font-medium">Locator readings per day</div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          How many times per day operators can submit a reading per locator. Only managers and admins can change this.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Preset buttons */}
          {([3, 8, 24] as const).map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => canEdit && update({ locator_readings_per_day: preset })}
              disabled={!canEdit}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md border transition-colors',
                (cfg.locator_readings_per_day ?? 3) === preset
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border hover:bg-muted dark:hover:bg-muted/50',
                !canEdit ? 'opacity-50 cursor-default' : 'cursor-pointer',
              ].join(' ')}
              title={preset === 24 ? 'Hourly (every hour)' : `${preset} times per day`}
            >
              {preset === 24 ? 'Hourly (24)' : `${preset}×/day`}
            </button>
          ))}
          {/* Custom stepper */}
          {canEdit ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Custom:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => update({ locator_readings_per_day: Math.max(1, (cfg.locator_readings_per_day ?? 3) - 1) })}
                  disabled={(cfg.locator_readings_per_day ?? 3) <= 1}
                  className="h-7 w-7 rounded-md border bg-background flex items-center justify-center text-sm font-medium hover:bg-muted disabled:opacity-40"
                >−</button>
                <Input
                  type="number"
                  min={1}
                  max={48}
                  value={cfg.locator_readings_per_day ?? 3}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v >= 1 && v <= 48) update({ locator_readings_per_day: v });
                  }}
                  className="h-7 w-14 text-xs text-center font-mono font-semibold"
                />
                <button
                  type="button"
                  onClick={() => update({ locator_readings_per_day: Math.min(48, (cfg.locator_readings_per_day ?? 3) + 1) })}
                  disabled={(cfg.locator_readings_per_day ?? 3) >= 48}
                  className="h-7 w-7 rounded-md border bg-background flex items-center justify-center text-sm font-medium hover:bg-muted disabled:opacity-40"
                >+</button>
              </div>
              <span className="text-xs text-muted-foreground">per day</span>
            </div>
          ) : (
            <span className="text-sm font-mono font-semibold">{cfg.locator_readings_per_day ?? 3}×/day</span>
          )}
        </div>
        {!canEdit && (
          <p className="text-2xs text-muted-foreground">Only managers and admins can change the reading frequency.</p>
        )}
      </div>
    </div>
  );
}
