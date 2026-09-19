import { useState, useEffect } from 'react';
import { NodeType, NODE_LABELS, COLORS } from './shared';

// ─── Rename Modal ─────────────────────────────────────────────────────────────

interface RenameModalProps {
  defaultName: string;
  nodeType: NodeType;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function RenameModal({ defaultName, nodeType, onConfirm, onCancel }: RenameModalProps) {
  const [name, setName] = useState(defaultName);
  const c = COLORS[nodeType];

  useEffect(() => {
    const inp = document.getElementById('rename-modal-input') as HTMLInputElement | null;
    if (inp) { inp.focus(); inp.select(); }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card rounded-xl border border-border shadow-2xl w-80 overflow-hidden">
        <div className="h-1.5 w-full" style={{ background: c.accent }} />
        <div className="px-5 py-4">
          <p className="text-3xs font-mono tracking-widest uppercase mb-1" style={{ color: c.accent }}>
            {NODE_LABELS[nodeType]}
          </p>
          <h3 className="text-sm font-bold text-foreground mb-3">Name this node</h3>
          <input
            id="rename-modal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onConfirm(name.trim());
              if (e.key === 'Escape') onCancel();
            }}
            className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Enter a name…"
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => name.trim() && onConfirm(name.trim())}
              disabled={!name.trim()}
              className="flex-1 h-8 rounded-md text-xs font-semibold text-white transition-all disabled:opacity-40"
              style={{ background: c.accent }}
            >
              Add Node
            </button>
            <button
              onClick={onCancel}
              className="px-3 h-8 rounded-md text-xs font-medium border border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

