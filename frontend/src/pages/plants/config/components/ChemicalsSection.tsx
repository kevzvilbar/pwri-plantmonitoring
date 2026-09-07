import { Switch } from '@/components/ui/switch';
import { PLANT_CHEMICALS } from '../../shared';

export function ChemicalsSection({
  cfg,
  update,
  canEdit,
}: {
  cfg: {
    enabled_chemicals: string[];
  };
  update: (patch: Partial<{ enabled_chemicals: string[] }>) => void;
  canEdit: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base leading-none">🧪</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chemicals in use</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Select which chemicals this plant uses. Only checked chemicals appear in{' '}
        <strong className="font-medium">RO Trains → Chemical Dosing</strong>.
        {!canEdit && ' (view only)'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PLANT_CHEMICALS.map(chem => {
          const isEnabled = cfg.enabled_chemicals.length === 0 || cfg.enabled_chemicals.includes(chem.name);
          return (
            <label
              key={chem.name}
              className={[
                'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                isEnabled
                  ? 'border-primary/60 bg-primary-soft/70'
                  : 'border-border bg-muted/30',
                canEdit ? 'cursor-pointer' : 'cursor-default',
              ].join(' ')}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{chem.name}</div>
                <div className="text-xs text-muted-foreground">default unit: {chem.defaultUnit}</div>
              </div>
              <Switch
                checked={isEnabled}
                disabled={!canEdit}
                onCheckedChange={canEdit ? (checked) => {
                  const current = cfg.enabled_chemicals.length === 0
                    ? PLANT_CHEMICALS.map(c => c.name)
                    : [...cfg.enabled_chemicals];
                  const next = checked
                    ? [...new Set([...current, chem.name])]
                    : current.filter(n => n !== chem.name);
                  update({ enabled_chemicals: next });
                } : undefined}
                className="h-8 w-14 sm:h-5 sm:w-9 shrink-0 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-4 sm:[&>span]:w-4 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary"
              />
            </label>
          );
        })}
      </div>
      {canEdit && cfg.enabled_chemicals.length > 0 && cfg.enabled_chemicals.length < PLANT_CHEMICALS.length && (
        <button
          type="button"
          onClick={() => update({ enabled_chemicals: [] })}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Enable all chemicals
        </button>
      )}
    </div>
  );
}
