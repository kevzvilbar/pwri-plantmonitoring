import type { ReactNode } from 'react';

export function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
