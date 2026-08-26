import { DragItem, NODE_LABELS, COLORS, withAlpha } from './shared';

// ─── Drag Ghost ───────────────────────────────────────────────────────────────

interface DragGhostProps {
  item: DragItem;
  x: number;
  y: number;
  snapping: boolean;
}

export function DragGhost({ item, x, y, snapping }: DragGhostProps) {
  const c = COLORS[item.nodeType];
  return (
    <div
      className="fixed z-50 pointer-events-none select-none"
      style={{ left: x + 16, top: y - 18 }}
    >
      <div
        className="px-3 py-1.5 rounded-lg border-2 text-2xs font-bold font-mono shadow-xl"
        style={{
          background: c.bg,
          borderColor: snapping ? c.accent : withAlpha(c.border, 0.67),
          color: c.text,
          transform: snapping ? 'scale(1.06)' : 'scale(1)',
          transition: 'transform 0.1s, border-color 0.1s',
          boxShadow: snapping ? `0 0 0 3px ${withAlpha(c.accent, 0.2)}, 0 8px 24px #0003` : '0 4px 12px #0002',
        }}
      >
        {snapping ? '📌 ' : '✦ '}{NODE_LABELS[item.nodeType]}
      </div>
    </div>
  );
}

