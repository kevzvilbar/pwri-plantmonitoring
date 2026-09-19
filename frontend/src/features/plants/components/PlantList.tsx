import { Search, Droplet } from 'lucide-react';
import { PlantCard } from './PlantCard';

export type PlantListProps = {
  plants: any[];
  filteredList: any[];
  summaryCounts: any;
  isManager: boolean;
  onNavigate: (path: string) => void;
  onInspect: (plant: any) => void;
  setSearch: (v: string) => void;
  setStatusFilter: (v: 'all' | 'Active' | 'Inactive') => void;
};

export function PlantList({ plants, filteredList, summaryCounts, isManager, onNavigate, onInspect, setSearch, setStatusFilter }: PlantListProps) {
  return (
    <div className="stagger-grid space-y-3">
      {filteredList?.map((p, idx) => (
        <PlantCard
          key={p.id}
          plant={p}
          summaryCounts={summaryCounts}
          index={idx}
          onNavigate={onNavigate}
          onInspect={onInspect}
          isManager={isManager}
        />
      ))}

      {!plants?.length && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border/60">
          <Droplet className="h-8 w-8 opacity-30" />
          <span>No plants visible</span>
        </div>
      )}

      {!!plants?.length && !filteredList?.length && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border/60">
          <Search className="h-8 w-8 opacity-30" strokeWidth={1.5} aria-hidden />
          <span>No plants match your search</span>
          <button
            type="button"
            className="text-xs text-primary underline underline-offset-2 hover:no-underline"
            onClick={() => { setSearch(''); setStatusFilter('all'); }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

