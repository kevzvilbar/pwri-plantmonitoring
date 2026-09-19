import { cn } from '@/lib/utils';
import { ImportTypeCard } from './ImportTypeCard';
import { CONFIG_MAP, CATEGORY_GROUPS, type ImportType } from './registry';

interface SidebarContentProps {
  selected: ImportType;
  onSelect: (t: ImportType) => void;
}

export function SidebarContent({ selected, onSelect }: SidebarContentProps) {
  return (
    <div className="space-y-0.5">
      {CATEGORY_GROUPS.map((group, gi) => {
        const configs = group.types.map(t => CONFIG_MAP[t]).filter(Boolean);
        return (
          <div key={group.label} className={cn(gi > 0 && 'pt-2')}>
            <p className={cn(
              'text-3xs font-bold tracking-[0.12em] uppercase px-1 mb-1',
              gi > 0 && 'border-t border-border/50 pt-2',
              'text-muted-foreground/60',
            )}>
              {group.label}
            </p>
            <div className="space-y-1">
              {configs.map(c => (
                <ImportTypeCard
                  key={c.id}
                  config={c}
                  selected={selected === c.id}
                  onClick={() => onSelect(c.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
