import React from 'react';
import { Button } from '@/components/ui/button';
import { X, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrainFilterPanelProps {
  roTrainEntities: any[];
  selectedTrainIds: Set<string> | null;
  showTrainFilter: boolean;
  allTrainsSelected: boolean;
  noTrainsSelected: boolean;
  trainSearch: string;
  filteredTrainList: any[];
  selectAllTrains: () => void;
  clearAllTrains: () => void;
  setShowTrainFilter: (v: boolean) => void;
  setTrainSearch: (v: string) => void;
  toggleTrain: (id: string) => void;
}

export function TrainFilterPanel({
  roTrainEntities, selectedTrainIds, showTrainFilter, allTrainsSelected, noTrainsSelected,
  trainSearch, filteredTrainList, selectAllTrains, clearAllTrains, setShowTrainFilter,
  setTrainSearch, toggleTrain,
}: TrainFilterPanelProps) {
  if (!showTrainFilter) return null;

  return (
    <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-foreground shrink-0">Filter Trains</span>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={selectAllTrains}
            className={[
              'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
              allTrainsSelected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground hover:text-foreground border-border',
            ].join(' ')}
          >All</button>
          <button
            onClick={clearAllTrains}
            className={[
              'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
              noTrainsSelected
                ? 'bg-danger text-white border-danger'
                : 'bg-muted text-muted-foreground hover:text-foreground border-border',
            ].join(' ')}
          >None</button>
          <button
            onClick={() => setShowTrainFilter(false)}
            className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Close filter"
            aria-label="Close filter"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {roTrainEntities.length > 6 && (
        <div className="relative">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={trainSearch}
            onChange={(e) => setTrainSearch(e.target.value)}
            placeholder="Search trains…"
            className="w-full h-6 pl-6 pr-2 rounded border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {trainSearch && (
            <button onClick={() => setTrainSearch('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1 max-h-[130px] overflow-y-auto pr-0.5">
        {filteredTrainList.length === 0 && (
          <span className="text-xs text-muted-foreground py-1">No trains match search.</span>
        )}
        {filteredTrainList.map((entity) => {
          const isActive = selectedTrainIds === null || selectedTrainIds.has(entity.id);
          return (
            <button
              key={entity.id}
              onClick={() => toggleTrain(entity.id)}
              title={entity.label}
              className={[
                'flex items-center gap-1 h-6 px-2 rounded-full text-2xs font-medium border transition-all leading-none max-w-[180px]',
                isActive
                  ? 'text-white border-transparent shadow-sm'
                  : 'bg-background text-muted-foreground border-border hover:border-foreground/30',
              ].join(' ')}
              style={isActive ? { backgroundColor: entity.color, borderColor: entity.color } : {}}
            >
              {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
              <span className="truncate">{entity.label}</span>
            </button>
          );
        })}
      </div>

      <div className="text-2xs text-muted-foreground flex items-center gap-2 pt-0.5 border-t border-border/50">
        <span>
          {allTrainsSelected
            ? `All ${roTrainEntities.length} trains shown`
            : noTrainsSelected
              ? 'No trains selected — chart will be empty'
              : `${selectedTrainIds!.size} of ${roTrainEntities.length} trains shown`}
        </span>
        {!allTrainsSelected && !noTrainsSelected && (
          <button onClick={selectAllTrains} className="ml-auto text-2xs text-primary hover:underline">Reset</button>
        )}
      </div>
    </div>
  );
}
