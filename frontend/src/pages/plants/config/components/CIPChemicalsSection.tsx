import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';

export const BUILTIN_CIP_CHEMICALS = ['Caustic Soda', 'HCl', 'SLS'];
export const CIP_CHEM_UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'gal'];

export function CIPChemicalsSection({
  cfg,
  update,
  canEdit,
}: {
  cfg: any;
  update: (patch: Partial<any>) => void;
  canEdit: boolean;
}) {
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('kg');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const chemicals: Array<{ name: string; unit: string }> =
    cfg.cip_chemicals?.length
      ? cfg.cip_chemicals
      : [
          { name: 'Caustic Soda', unit: 'kg' },
          { name: 'HCl',          unit: 'L'  },
          { name: 'SLS',          unit: 'g'  },
        ];

  const addChemical = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (chemicals.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    update({ cip_chemicals: [...chemicals, { name: trimmed, unit: newUnit }] });
    setNewName('');
    setNewUnit('kg');
  };

  const removeChemical = (name: string) => {
    update({ cip_chemicals: chemicals.filter(c => c.name !== name) });
    setConfirmRemove(null);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base leading-none">🧫</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CIP Chemicals</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        These chemicals appear as input fields in{' '}
        <strong className="font-medium">RO Trains → CIP</strong>. Built-in chemicals
        (Caustic Soda, HCl, SLS) map to dedicated DB columns; custom ones are stored
        in the remarks field.{!canEdit && ' (view only)'}
      </p>

      <div className="space-y-1.5">
        {chemicals.map(chem => {
          const isBuiltin = BUILTIN_CIP_CHEMICALS.includes(chem.name);
          const isConfirming = confirmRemove === chem.name;
          return (
            <div
              key={chem.name}
              className={[
                'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                isBuiltin
                  ? 'border-primary/60 bg-primary-soft/50'
                  : 'border-border bg-muted/20',
              ].join(' ')}
            >
              <span className={[
                'inline-flex items-center justify-center w-6 h-6 rounded-full text-3xs font-bold shrink-0',
                isBuiltin
                  ? 'bg-primary-soft text-primary'
                  : 'bg-muted text-muted-foreground',
              ].join(' ')}>
                {isBuiltin ? '★' : '✦'}
              </span>

              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{chem.name}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">({chem.unit})</span>
                {isBuiltin && (
                  <span className="ml-2 text-3xs font-semibold uppercase tracking-wide text-primary">built-in</span>
                )}
              </div>

              {canEdit && (
                isConfirming ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-2xs text-muted-foreground">Remove?</span>
                    <button
                      type="button"
                      onClick={() => removeChemical(chem.name)}
                      className="px-2 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-2xs font-semibold"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(null)}
                      className="px-2 py-0.5 rounded hover:bg-muted text-muted-foreground text-2xs"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(chem.name)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title={`Remove ${chem.name} from CIP`}
                    aria-label={`Remove ${chem.name} from CIP`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )
              )}
            </div>
          );
        })}

        {canEdit && (
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addChemical()}
              placeholder="New chemical name…"
              className="h-8 text-xs flex-1"
            />
            <Select value={newUnit} onValueChange={setNewUnit}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CIP_CHEM_UNITS.map(u => (
                  <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={addChemical}
              disabled={!newName.trim()}
              className="h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              + Add
            </button>
          </div>
        )}

        {chemicals.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No CIP chemicals configured — add one above.
          </p>
        )}
      </div>
    </div>
  );
}
