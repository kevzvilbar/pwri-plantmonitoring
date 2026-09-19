import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MeterNameList({
  count,
  names,
  accentColor,
  defaultPrefix,
  onSave,
  onRemoveLast,
}: {
  count: number;
  names: string[];
  accentColor: 'yellow' | 'blue';
  defaultPrefix: string;
  onSave: (names: string[]) => void;
  onRemoveLast: () => void;
}) {
  const isYellow = accentColor === 'yellow';
  const ring = isYellow ? 'focus-visible:ring-warn' : 'focus-visible:ring-info';
  const border = isYellow ? 'border-warn' : 'border-info';
  const chip = isYellow
    ? 'bg-warn-soft border-warn text-warn'
    : 'bg-info-soft border-info text-info';

  const [editingIdx, setEditingIdx] = useState<number>(-1);
  const [editVal, setEditVal] = useState('');
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1);

  const startEdit = (i: number) => {
    setConfirmDeleteIdx(-1);
    setEditingIdx(i);
    setEditVal(names[i] ?? `${defaultPrefix} ${i + 1}`);
  };

  const commitEdit = () => {
    if (editingIdx < 0) return;
    const trimmed = editVal.trim() || `${defaultPrefix} ${editingIdx + 1}`;
    const next = [...names];
    next[editingIdx] = trimmed;
    onSave(next);
    setEditingIdx(-1);
  };

  const cancelEdit = () => { setEditingIdx(-1); };

  const askDelete = (i: number) => {
    setEditingIdx(-1);
    setConfirmDeleteIdx(i);
  };

  const confirmDelete = (i: number) => {
    const next = [...names];
    next.splice(i, 1);
    onSave(next);
    onRemoveLast();
    setConfirmDeleteIdx(-1);
  };

  const cancelDelete = () => setConfirmDeleteIdx(-1);

  return (
    <div className="flex gap-1 flex-wrap mt-0.5">
      {Array.from({ length: count }).map((_, i) => {
        const name = names[i] ?? `${defaultPrefix} ${i + 1}`;
        const isEditing = editingIdx === i;
        const isDeleting = confirmDeleteIdx === i;

        if (isEditing) {
          return (
            <div key={i} className={`flex items-center gap-0.5 rounded border ${border} bg-background px-1 py-0.5`}>
              <input
                autoFocus
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                className={`h-5 w-20 text-xs bg-transparent focus:outline-none focus-visible:ring-1 ${ring} rounded px-0.5`}
              />
              <button
                onClick={commitEdit}
                className="text-3xs font-semibold text-accent hover:text-accent/90 px-0.5 leading-none"
                title="Save name"
              >✓</button>
              <button
                onClick={cancelEdit}
                className="text-3xs text-muted-foreground hover:text-foreground px-0.5 leading-none"
                title="Cancel"
              >✕</button>
            </div>
          );
        }

        if (isDeleting) {
          return (
            <div key={i} className="flex items-center gap-0.5 rounded border border-destructive/40 bg-destructive/5 px-1.5 py-0.5">
              <span className="text-2xs text-destructive font-medium">Delete "{name}"?</span>
              <button
                onClick={() => confirmDelete(i)}
                className="text-3xs font-bold text-destructive hover:text-destructive/80 ml-1 px-0.5"
                title="Confirm delete"
              >Yes</button>
              <button
                onClick={cancelDelete}
                className="text-3xs text-muted-foreground hover:text-foreground px-0.5"
                title="Cancel"
              >No</button>
            </div>
          );
        }

        return (
          <div key={i} className={`flex items-center gap-0.5 rounded border ${chip} px-1.5 py-0.5 text-xs`}>
            <span className="leading-none">{name}</span>
            <button
              onClick={() => startEdit(i)}
              className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
              title={`Rename "${name}"`}
              aria-label={`Rename "${name}"`}
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={() => askDelete(i)}
              className="opacity-60 hover:opacity-100 hover:text-destructive transition-opacity"
              title={`Remove "${name}"`}
              aria-label={`Remove "${name}"`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
