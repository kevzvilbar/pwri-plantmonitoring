// Clickable "repl." badge shared by every history table (Option A).
// Same footprint as the old static pill, plus hover affordance — the Repl.
// checkbox column keeps its existing mark/unmark behaviour untouched.
import React from 'react';

export function ReplPill({
  title = 'View replacement details',
  tone = 'solar',
  label = 'repl.',
  onClick,
}: {
  title?: string;
  tone?: 'solar' | 'grid';
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const color = tone === 'grid' ? 'text-kpi-grid bg-kpi-grid/15' : 'text-kpi-solar bg-kpi-solar/15';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className={[
        'text-3xs font-semibold uppercase tracking-wide px-1 py-0.5 rounded leading-none',
        'cursor-pointer hover:underline hover:brightness-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        color,
      ].join(' ')}
    >
      {label}
    </button>
  );
}
