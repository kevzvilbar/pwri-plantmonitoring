import { FlaskConical, Layers, Zap } from 'lucide-react';

interface CategoryToggleProps {
  itemCategory: 'chemical' | 'filter' | 'power';
  setItemCategory: (cat: 'chemical' | 'filter' | 'power') => void;
}

export function CategoryToggle({ itemCategory, setItemCategory }: CategoryToggleProps) {
  const cats: { cat: 'chemical' | 'filter' | 'power'; icon: React.ReactNode; label: string }[] = [
    { cat: 'chemical', icon: <FlaskConical className="h-3 w-3" />, label: 'Chemicals' },
    { cat: 'filter',   icon: <Layers className="h-3 w-3" />,     label: 'Filters' },
    { cat: 'power',    icon: <Zap className="h-3 w-3" />,        label: 'Power' },
  ];

  return (
    <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-lg border border-border/40" role="tablist" aria-label="Item category">
      {cats.map(({ cat, icon, label }) => (
        <button
          key={cat}
          type="button"
          role="tab"
          aria-selected={itemCategory === cat}
          onClick={() => setItemCategory(cat)}
          className={`inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
            itemCategory === cat ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
