import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, SprayCan } from 'lucide-react';

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
        <SprayCan className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CIP Chemicals</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        These chemicals appear as input fields in{' '}
        <strong className="font-medium">RO Trains → CIP</strong>. Built-in chemicals
        (Caustic Soda, HCl, SLS) map to dedicated DB columns; custom ones are stored
        in the remarks field.{!canEdit && ' (view only)'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {chemicals.map(chem => {
          const isBuiltin = BUILTIN_CIP_CHEMICALS.includes(chem.name);
          const isConfirming = confirmRemove === chem.name;
          return (
            <span
              key={chem.name}
              className={[
                'inline-flex items-center gap-1.5 text-xs pl-1 pr-2.5 py-1 rounded-full border font-medium shadow-2xs transition-colors',
                isBuiltin
                  ? 'bg-primary-soft text-primary border-primary/40'
                  : 'bg-muted/40 text-foreground border-border',
              ].join(' ')}
            >
              <span className={[
                'inline-flex items-center justify-center w-5 h-5 rounded-full text-3xs font-bold shrink-0',
                isBuiltin ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              ].join(' ')}>
                {isBuiltin ? '★' : '✦'}
              </span>
              <span>{chem.name}</span>
              <span className="opacity-60">({chem.unit})</span>

              {canEdit && (
                isConfirming ? (
                  <span className="flex items-center gap-1 -mr-1">
                    <button
                      type="button"
                      onClick={() => removeChemical(chem.name)}
                      className="px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 text-2xs font-semibold"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(null)}
                      className="px-1.5 py-0.5 rounded-full hover:bg-muted text-muted-foreground text-2xs"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(chem.name)}
                    className="h-3.5 w-3.5 rounded-full hover:bg-destructive/10 flex items-center justify-center text-muted-foreground/70 hover:text-destructive transition-colors -mr-1"
                    title={`Remove ${chem.name} from CIP`}
                    aria-label={`Remove ${chem.name} from CIP`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )
              )}
            </span>
          );
        })}

        {canEdit && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border/80 bg-muted/30 pl-1 pr-1 py-1">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addChemical()}
              placeholder="New chemical…"
              className="h-6 w-28 text-xs border-0 bg-transparent shadow-none focus-visible:ring-0 px-1.5"
            />
            <Select value={newUnit} onValueChange={setNewUnit}>
              <SelectTrigger className="h-6 w-16 text-2xs border-0 bg-transparent shadow-none focus:ring-0 px-1.5">
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
              className="h-6 px-2.5 rounded-full text-2xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              + Add
            </button>
          </span>
        )}

        {chemicals.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">
            No CIP chemicals configured — add one above.
          </p>
        )}
      </div>
    </div>
  );
}
