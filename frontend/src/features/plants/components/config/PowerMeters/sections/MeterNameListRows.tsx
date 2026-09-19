import { useState } from 'react';
import { Pencil, X, Check } from 'lucide-react';
import { Sun } from 'lucide-react';

export function MeterNameListRows({
  count, names, accentColor, defaultPrefix, onSave, onRemoveLast,
}: {
  count: number;
  names: string[];
  accentColor: 'yellow' | 'blue';
  defaultPrefix: string;
  onSave: (names: string[]) => void;
  onRemoveLast: () => void;
}) {
  const [editingIdx, setEditingIdx]             = useState<number>(-1);
  const [editVal, setEditVal]                   = useState('');
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1);

  const isYellow = accentColor === 'yellow';
  const border = isYellow ? 'border-warn/60' : 'border-info/60';
  const headerBg = isYellow ? 'bg-warn-soft/60' : 'bg-info-soft/60';
  const ring = isYellow ? 'focus:ring-warn' : 'focus:ring-info';

  const startEdit  = (i: number) => { setConfirmDeleteIdx(-1); setEditingIdx(i); setEditVal(names[i] ?? `${defaultPrefix} ${i + 1}`); };
  const commitEdit = () => {
    if (editingIdx < 0) return;
    const trimmed = editVal.trim() || `${defaultPrefix} ${editingIdx + 1}`;
    const next = [...names]; next[editingIdx] = trimmed;
    onSave(next); setEditingIdx(-1);
  };
  const cancelEdit    = () => setEditingIdx(-1);
  const askDelete     = (i: number) => { setEditingIdx(-1); setConfirmDeleteIdx(i); };
  const confirmDelete = (i: number) => {
    const next = [...names]; next.splice(i, 1);
    onSave(next); onRemoveLast(); setConfirmDeleteIdx(-1);
  };

  return (
    <div className={`rounded-xl border ${border} overflow-hidden shadow-2xs`}>
      <div className={`grid grid-cols-[1fr_110px_auto] items-center ${headerBg} border-b ${border} px-3 py-2 gap-2`}>
        <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide">Meter Name</span>
        <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide text-center">
          Source Type
        </span>
        <span className="w-10" />
      </div>

      {Array.from({ length: count }).map((_, i) => {
        const name = names[i] ?? `${defaultPrefix} ${i + 1}`;

        if (confirmDeleteIdx === i) return (
          <div key={i} className="grid grid-cols-[1fr_110px_auto] items-center gap-2 px-3 py-2.5 bg-destructive/5 border-b border-border/50 last:border-b-0">
            <span className="text-xs text-destructive font-medium truncate col-span-2">Remove &quot;{name}&quot;?</span>
            <div className="flex items-center gap-1 w-10 justify-end">
              <button onClick={() => confirmDelete(i)} className="text-xs font-semibold text-destructive hover:underline">Yes</button>
              <span className="text-muted-foreground/40">/</span>
              <button onClick={() => setConfirmDeleteIdx(-1)} className="text-xs text-muted-foreground hover:underline">No</button>
            </div>
          </div>
        );

        if (editingIdx === i) return (
          <div key={i} className="grid grid-cols-[1fr_110px_auto] items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0 bg-background">
            <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              className={`text-sm bg-transparent border-b ${isYellow ? 'border-warn' : 'border-info'} focus:outline-none focus:ring-1 ${ring} rounded-t w-full px-1`} />
            <div className="flex items-center justify-center">
              <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-warn-soft text-warn border border-warn/40">
                <Sun className="h-2.5 w-2.5" /> Solar Gen
              </span>
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
          <div key={i} className={`group grid grid-cols-[1fr_110px_auto] items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0 bg-background hover:${headerBg}/40 transition-colors`}>
            <span className="text-sm truncate font-medium text-foreground" title={name}>{name}</span>
            <div className="flex items-center justify-center">
              <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-warn-soft text-warn border border-warn/40">
                <Sun className="h-2.5 w-2.5" /> Solar Gen
              </span>
            </div>
            <div className="flex items-center gap-0.5 w-10 justify-end">
              <button
                onClick={() => startEdit(i)}
                className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:text-accent hover:bg-accent-soft opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                title={`Rename "${name}"`}
                aria-label={`Rename "${name}"`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => askDelete(i)}
                className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/15 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                title={`Remove "${name}"`}
                aria-label={`Remove "${name}"`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
