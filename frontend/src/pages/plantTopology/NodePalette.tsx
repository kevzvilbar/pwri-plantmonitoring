import { GripVertical, Move } from 'lucide-react';
import { NodeType, DragItem, PaletteItem, NODE_LABELS, COLORS, withAlpha } from './shared';
import { CustomNodePaletteSection } from './CustomNodePaletteSection';

// ─── Node Palette ─────────────────────────────────────────────────────────────
// Draggable chips for creating new nodes on the canvas.

const PALETTE_TYPES: NodeType[] = [
  'well', 'rawMeter', 'pretreat', 'feedMeter', 'roTrain',
  'permeate', 'reject', 'bulk', 'locator',
  // 'customNode' handled by CustomNodePaletteSection below
];

interface NodePaletteProps {
  onDragStart: (item: DragItem, e: React.PointerEvent) => void;
  paletteItems: PaletteItem[];
  onAddPaletteItem: (label: string) => void;
  onRenamePaletteItem: (id: string, label: string) => void;
  onDeletePaletteItem: (id: string) => void;
}

export function NodePalette({ onDragStart, paletteItems, onAddPaletteItem, onRenamePaletteItem, onDeletePaletteItem }: NodePaletteProps) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm shrink-0 overflow-x-auto">
      <div className="flex items-center gap-1 mr-2 shrink-0">
        <Move className="h-3 w-3 text-muted-foreground" />
        <span className="text-3xs font-mono tracking-widest text-muted-foreground uppercase whitespace-nowrap">Drag to canvas:</span>
      </div>
      {PALETTE_TYPES.map((type) => {
        const c = COLORS[type];
        return (
          <div
            key={type}
            className="flex items-center gap-1 px-2 py-1 rounded-md border cursor-grab active:cursor-grabbing select-none shrink-0 transition-all hover:shadow-sm hover:-translate-y-0.5"
            style={{ background: c.bg, borderColor: withAlpha(c.border, 0.5) }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              onDragStart({ nodeType: type, label: NODE_LABELS[type] }, e);
            }}
          >
            <GripVertical className="h-2.5 w-2.5 opacity-40" style={{ color: c.accent }} />
            <span className="text-3xs font-mono font-bold tracking-wide" style={{ color: c.text }}>
              {NODE_LABELS[type]}
            </span>
          </div>
        );
      })}

      {/* Divider */}
      <div className="h-5 w-px bg-border mx-1 shrink-0" />

      {/* Custom node section */}
      <CustomNodePaletteSection
        paletteItems={paletteItems}
        onDragStart={onDragStart}
        onAddPaletteItem={onAddPaletteItem}
        onRenamePaletteItem={onRenamePaletteItem}
        onDeletePaletteItem={onDeletePaletteItem}
      />
    </div>
  );
}

