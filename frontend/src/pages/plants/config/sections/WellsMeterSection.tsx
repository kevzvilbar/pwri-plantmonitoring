import { MeterToggleTile, MeterGroupChips } from '../MeterConfig';
import { Droplet, Zap, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface WellsMeterSectionProps {
  cfg: import('@/pages/plants/shared').PlantMeterConfig;
  update: (patch: Partial<import('@/pages/plants/shared').PlantMeterConfig>) => void;
  canEdit: boolean;
  wells: Array<{ id: string; name: string }>;
}

export function WellsMeterSection({ cfg, update, canEdit, wells }: WellsMeterSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Droplet className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Raw water — wells</span>
        <span className="text-2xs text-muted-foreground ml-1">(each well always has its own water meter)</span>
      </div>
      <p className="text-xs font-medium text-muted-foreground mb-2">Electricity metering</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <MeterToggleTile
          icon={<Zap className="h-4 w-4 text-warn" />}
          title="Shared electric meter"
          subtitle="Multiple wells / colboxes share one kWh meter"
          checked={cfg.wells_shared_electric_groups.length > 0}
          onToggle={v => update({ wells_shared_electric_groups: v ? [{ id: crypto.randomUUID(), name: 'Group 1', members: [] }] : [] })}
          canEdit={canEdit}
          accentColor="amber"
        />
        <MeterToggleTile
          icon={<Zap className="h-4 w-4 text-warn" />}
          title="Dedicated meter (per well)"
          subtitle="Some wells have their own kWh meter"
          checked={cfg.wells_dedicated_electric_ids.length > 0}
          onToggle={v => update({ wells_dedicated_electric_ids: v ? (wells[0] ? [wells[0].id] : []) : [] })}
          canEdit={canEdit}
          accentColor="amber"
        />
        <MeterToggleTile
          icon={<Zap className="h-4 w-4 text-muted-foreground" />}
          title="No electricity metering"
          subtitle="Some wells have no kWh meter at all"
          checked={cfg.wells_no_electric}
          onToggle={v => update({ wells_no_electric: v })}
          canEdit={canEdit}
          accentColor="teal"
        />
      </div>

      {/* Shared electric groups */}
      {cfg.wells_shared_electric_groups.length > 0 && (
        <div className="space-y-2.5 mb-2">
          <p className="text-xs font-medium text-muted-foreground">Shared meter groups</p>
          {cfg.wells_shared_electric_groups.map((grp, gi) => (
            <div key={grp.id}>
              <MeterGroupChips
                label={grp.name}
                groupName={grp.name}
                members={grp.members}
                allEntities={wells}
                entityLabel="well"
                canEdit={canEdit}
                onGroupNameChange={name => {
                  const next = [...cfg.wells_shared_electric_groups];
                  next[gi] = { ...grp, name };
                  update({ wells_shared_electric_groups: next });
                }}
                onMembersChange={members => {
                  const next = [...cfg.wells_shared_electric_groups];
                  next[gi] = { ...grp, members };
                  update({ wells_shared_electric_groups: next });
                }}
                onDeleteGroup={() => update({ wells_shared_electric_groups: cfg.wells_shared_electric_groups.filter((_, i) => i !== gi) })}
              />
            </div>
          ))}
          {canEdit && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 rounded-lg border-border/80 font-semibold"
              onClick={() => update({ wells_shared_electric_groups: [...cfg.wells_shared_electric_groups, { id: crypto.randomUUID(), name: `Group ${cfg.wells_shared_electric_groups.length + 1}`, members: [] }] })}>
              <Plus className="h-3 w-3 text-primary" />Add group
            </Button>
          )}
        </div>
      )}

      {/* Dedicated electric wells */}
      {cfg.wells_dedicated_electric_ids.length > 0 && (
        <div className="space-y-1.5 mb-2">
          <p className="text-xs font-medium text-muted-foreground">Wells with dedicated meter</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {cfg.wells_dedicated_electric_ids.map(id => {
              const w = wells.find(x => x.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-warn-soft text-warn border border-warn/40 font-medium shadow-2xs">
                  <span>{w?.name ?? id}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => update({ wells_dedicated_electric_ids: cfg.wells_dedicated_electric_ids.filter(x => x !== id) })}
                      aria-label={`Remove ${w?.name ?? id}`}
                      title="Remove"
                      className="h-3.5 w-3.5 rounded-full hover:bg-warn/20 flex items-center justify-center text-warn/80 hover:text-warn transition-colors -mr-1"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              );
            })}
            {canEdit && wells.filter(w => !cfg.wells_dedicated_electric_ids.includes(w.id)).length > 0 && (
              <Select onValueChange={id => update({ wells_dedicated_electric_ids: [...cfg.wells_dedicated_electric_ids, id] })}>
                <SelectTrigger className="h-6 w-auto text-xs px-2.5 py-0 rounded-full border-dashed border-border/80 bg-muted/30 hover:bg-muted font-medium">
                  <Plus className="h-3 w-3 mr-1 text-primary" />Add well
                </SelectTrigger>
                <SelectContent>
                  {wells.filter(w => !cfg.wells_dedicated_electric_ids.includes(w.id)).map(w => (
                    <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
