import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ImportTypeConfig } from './types';

interface ImportTypeCardProps {
  config: ImportTypeConfig;
  selected: boolean;
  onClick: () => void;
}

export function ImportTypeCard({ config, selected, onClick }: ImportTypeCardProps) {
  const Icon = config.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-150 group',
        selected
          ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
          : 'border-border hover:border-border/80 hover:bg-muted/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', config.accent)}>
          <Icon className={cn('h-3.5 w-3.5', config.color)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-semibold truncate leading-tight">{config.label}</span>
            <ChevronRight className={cn(
              'h-3 w-3 shrink-0 transition-transform',
              selected ? 'text-primary rotate-90' : 'text-muted-foreground/40 group-hover:translate-x-0.5',
            )} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground leading-snug line-clamp-2">{config.description}</p>
        </div>
      </div>
    </button>
  );
}

