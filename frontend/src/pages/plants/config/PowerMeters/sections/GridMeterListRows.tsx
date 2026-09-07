import { useState, useEffect, useRef } from 'react';
import { Pencil, X, Check } from 'lucide-react';

export function GridMeterListRows({
  count, names, multipliers, onSaveNames, onSaveMultiplier, onRemoveLast,
}: {
  count: number;
  names: string[];
  multipliers: number[];
  onSaveNames: (names: string[]) => void;
  onSaveMultiplier: (idx: number, val: number) => void;
  onRemoveLast: () => void;
}) {
  const [editingIdx, setEditingIdx]             = useState<number>(-1);
  const [editVal, setEditVal]                   = useState('');
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1);

  const [multInputs, setMultInputs] = useState<string[]>(() =>
    Array.from({ length: multipliers.length }, (_, i) => String(multipliers[i] ?? 1))
  );

  const focusedMultIdxRef = useRef<number>(-1);

  useEffect(() => {
    setMultInputs(prev => {
      const next = [...prev];
      multipliers.forEach((m, i) => {
        if (i !== focusedMultIdxRef.current) next[i] = String(m > 0 ? m : 1);
      });
      return next;
    });
  }, [multipliers]);

  const commitMultiplier = (i: number, raw: string) => {
    const v = parseFloat(raw);
    if (v > 0) {
      onSaveMultiplier(i, v);
    } else {
      setMultInputs(prev => {
        const next = [...prev]; next[i] = String(multipliers[i] ?? 1); return next;
      });
    }
  };

  const startEdit  = (i: number) => { setConfirmDeleteIdx(-1); setEditingIdx(i); setEditVal(names[i] ?? `Grid Meter ${i + 1}`); };
  const commitEdit = () => {
    if (editingIdx < 0) return;
    const trimmed = editVal.trim() || `Grid Meter ${editingIdx + 1}`;
    const next = [...names]; next[editingIdx] = trimmed;
    onSaveNames(next); setEditingIdx(-1);
  };
  const cancelEdit    = () => setEditingIdx(-1);
  const askDelete     = (i: number) => { setEditingIdx(-1); setConfirmDeleteIdx(i); };
  const confirmDelete = (i: number) => {
    const next = [...names]; next.splice(i, 1);
    onSaveNames(next); onRemoveLast(); setConfirmDeleteIdx(-1);
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden shadow-xs">
      <div className="grid grid-cols-[1fr_110px_auto] items-center bg-muted/50 border-b border-border px-3 py-2 gap-2">
        <span className="text-2xs font-mono font-medium text-muted-foreground uppercase tracking-wider">Meter Name</span>
        <span className="text-2xs font-mono font-medium text-muted-foreground uppercase tracking-wider text-center">
          Multiplier <span className="normal-case font-normal text-3xs opacity-80">(CT ratio)</span>
        </span>
        <span className="w-10" />
      </div>

      {Array.from({ length: count }).map((_, i) => {
        const name = names[i] ?? `Grid Meter ${i + 1}`;
        const mult = multipliers[i] ?? 1;

        if (confirmDeleteIdx === i) return (
          <div key={i} className="grid grid-cols-[1fr_110px_auto] items-center gap-2 px-3 py-2 bg-destructive/5 border-b border-border last:border-b-0">
            <span className="text-xs text-destructive font-medium truncate col-span-2">Remove &quot;{name}&quot;?</span>
            <div className="flex items-center gap-1 w-10 justify-end">
              <button onClick={() => confirmDelete(i)} className="text-xs font-medium text-destructive hover:underline">Yes</button>
              <span className="text-muted-foreground/40">/</span>
              <button onClick={() => setConfirmDeleteIdx(-1)} className="text-xs text-muted-foreground hover:underline">No</button>
            </div>
          </div>
        );

        if (editingIdx === i) return (
          <div key={i} className="grid grid-cols-[1fr_110px_auto] items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 bg-background">
            <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              className="text-xs bg-transparent border-b border-primary focus:outline-none focus:ring-1 focus:ring-primary rounded-t w-full px-1" />
            <div className="inline-flex items-center justify-center gap-0.5 px-2 py-0.5 rounded bg-muted/60 border border-border text-foreground font-mono text-xs font-semibold justify-self-center">
              <span className="text-3xs text-muted-foreground font-mono">×</span>
              <span>{mult}</span>
            </div>
            <div className="flex items-center gap-1 w-10 justify-end">
              <button onClick={commitEdit} className="inline-flex items-center justify-center h-6 w-6 rounded-full text-accent hover:bg-accent-soft transition-colors" aria-label="Save name">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={cancelEdit} className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:bg-muted transition-colors" aria-label="Cancel">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );

        return (
          <div key={i} className="group grid grid-cols-[1fr_110px_auto] items-center gap-2 px-3 py-2 border-b border-border/60 last:border-b-0 bg-card hover:bg-muted/30 transition-colors">
            <span className="text-xs truncate font-medium text-foreground" title={name}>{name}</span>
            <div className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-muted/60 border border-border/80 text-foreground font-mono text-xs font-semibold justify-self-center">
              <span className="text-3xs text-muted-foreground font-mono">×</span>
              <input
                type="number" step="any" min="0.001"
                value={multInputs[i] ?? String(mult)}
                onChange={e => {
                  const raw = e.target.value;
                  setMultInputs(prev => { const next = [...prev]; next[i] = raw; return next; });
                }}
                onFocus={() => { focusedMultIdxRef.current = i; }}
                onBlur={e => { focusedMultIdxRef.current = -1; commitMultiplier(i, e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                  if (e.key === 'Escape') {
                    setMultInputs(prev => { const next = [...prev]; next[i] = String(mult); return next; });
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-[46px] text-xs text-right font-mono font-bold text-foreground bg-transparent focus:outline-none focus:ring-1 focus:ring-primary rounded px-0.5"
                title={`CT multiplier for "${name}". Consumption = (Current − Previous) × ${mult}. Press Enter or click away to save.`}
              />
            </div>
            <div className="flex items-center gap-0.5 w-10 justify-end">
              <button
                onClick={() => startEdit(i)}
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                title={`Rename "${name}"`}
                aria-label={`Rename "${name}"`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => askDelete(i)}
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                title={`Remove "${name}"`}
                aria-label={`Remove "${name}"`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
