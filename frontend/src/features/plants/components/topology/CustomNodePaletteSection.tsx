import { useState } from 'react';
import { Plus, Trash2, Pencil, GripVertical } from 'lucide-react';
import { DragItem, PaletteItem, COLORS, withAlpha } from './shared';

// ─── Custom Node Palette Section ─────────────────────────────────────────────

interface CustomNodePaletteSectionProps {
  paletteItems: PaletteItem[];
  onDragStart: (item: DragItem, e: React.PointerEvent) => void;
  onAddPaletteItem: (label: string) => void;
  onRenamePaletteItem: (id: string, label: string) => void;
  onDeletePaletteItem: (id: string) => void;
}

export function CustomNodePaletteSection({
  paletteItems, onDragStart, onAddPaletteItem, onRenamePaletteItem, onDeletePaletteItem,
}: CustomNodePaletteSectionProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const c = COLORS.customNode;

  function confirmAdd() {
    if (newName.trim()) onAddPaletteItem(newName.trim());
    setNewName('');
    setAdding(false);
  }

  function confirmEdit() {
    if (editId && editName.trim()) onRenamePaletteItem(editId, editName.trim());
    setEditId(null);
    setEditName('');
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="text-3xs font-mono tracking-widest text-muted-foreground uppercase mr-1 whitespace-nowrap">Custom:</span>

      {/* Existing palette chips */}
      {paletteItems.map((item) => (
        <div key={item.id} className="flex items-center gap-0.5 group shrink-0">
          {editId === item.id ? (
            /* ── Inline edit input ── */
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmEdit();
                if (e.key === 'Escape') { setEditId(null); setEditName(''); }
              }}
              onBlur={confirmEdit}
              className="h-6 w-24 text-2xs rounded border border-primary px-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            /* ── Draggable chip ── */
            <div
              className="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md border cursor-grab active:cursor-grabbing select-none transition-all hover:shadow-sm hover:-translate-y-0.5"
              style={{ background: c.bg, borderColor: withAlpha(c.border, 0.5) }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onDragStart({ nodeType: 'customNode', label: item.label, skipRename: true }, e);
              }}
            >
              <GripVertical className="h-2.5 w-2.5 opacity-40" style={{ color: c.accent }} />
              <span className="text-3xs font-mono font-bold tracking-wide max-w-[80px] truncate" style={{ color: c.text }}>
                {item.label}
              </span>
              {/* Edit icon */}
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setEditId(item.id); setEditName(item.label); }}
                title="Rename"
                aria-label="Rename"
              >
                <Pencil className="h-2.5 w-2.5" style={{ color: c.accent }} />
              </button>
              {/* Delete icon */}
              <button
                className="p-0.5 rounded hover:bg-danger-soft opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); onDeletePaletteItem(item.id); }}
                title="Remove from palette"
                aria-label="Remove from palette"
              >
                <Trash2 className="h-2.5 w-2.5 text-danger" />
              </button>
            </div>
          )}
        </div>
      ))}

      {/* ── Add new custom chip ── */}
      {adding ? (
        <div className="flex items-center gap-1 shrink-0">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmAdd();
              if (e.key === 'Escape') { setAdding(false); setNewName(''); }
            }}
            onBlur={confirmAdd}
            placeholder="Node name…"
            className="h-6 w-28 text-2xs rounded border border-primary px-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground hover:bg-muted transition-all shrink-0"
          title="Add custom node"
        >
          <Plus className="h-3 w-3" />
          <span className="text-3xs font-mono font-bold tracking-wide">ADD</span>
        </button>
      )}
    </div>
  );
}

