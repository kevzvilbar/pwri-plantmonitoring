import React from 'react';
import { Button } from '@/components/ui/button';
import { X, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WellFilterPanelProps {
  metric: string;
  showWellFilter: boolean;
  allWellsSelected: boolean;
  noneWellsSelected: boolean;
  wellEntities: any[];
  selectedWellIds: Set<string> | null;
  wellSearch: string;
  filteredWellList: any[];
  wellTotals: Map<string, number> | undefined;
  selectAllWells: () => void;
  clearAllWells: () => void;
  setShowWellFilter: (v: boolean) => void;
  setWellSearch: (v: string) => void;
  toggleWell: (id: string) => void;
  selectTopNWells: (n: number) => void;
}

export function WellFilterPanel({
  metric, showWellFilter, allWellsSelected, noneWellsSelected, wellEntities,
  selectedWellIds, wellSearch, filteredWellList, wellTotals,
  selectAllWells, clearAllWells, setShowWellFilter, setWellSearch, toggleWell, selectTopNWells,
}: WellFilterPanelProps) {
  if (!showWellFilter) return null;

  return (
    <div className="mb-2 rounded-lg border border-border/80 bg-card/90 shadow-sm p-2.5 flex flex-col gap-2 backdrop-blur-sm" data-testid="well-filter-panel-rawwater">
      <div className="flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-border/50">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold text-foreground shrink-0">Filter Extraction Wells</span>
          <span className="text-3xs text-muted-foreground">| Quick Presets:</span>
          <button
            onClick={() => selectTopNWells(3)}
            className="h-5 px-2 rounded-md text-3xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
            title="Select Top 3 highest yield wells"
          >
            Top 3
          </button>
          <button
            onClick={() => selectTopNWells(5)}
            className="h-5 px-2 rounded-md text-3xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
            title="Select Top 5 highest yield wells"
          >
            Top 5
          </button>

          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={selectAllWells}
              className={[
                'h-5 px-2 rounded text-2xs font-semibold border transition-colors leading-none',
                allWellsSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >
              All ({wellEntities.length})
            </button>
            <button
              onClick={clearAllWells}
              className={[
                'h-5 px-2 rounded text-2xs font-semibold border transition-colors leading-none',
                noneWellsSelected
                  ? 'bg-danger text-white border-danger'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >
              Clear
            </button>
            <button
              onClick={() => setShowWellFilter(false)}
              className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Close filter"
              aria-label="Close filter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {wellEntities.length > 6 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={wellSearch}
            onChange={(e) => setWellSearch(e.target.value)}
            placeholder="Search well number or locator…"
            className="w-full h-7 pl-7 pr-6 rounded-md border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {wellSearch && (
            <button
              onClick={() => setWellSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-0.5 py-0.5">
        {filteredWellList.length === 0 && (
          <span className="text-xs text-muted-foreground py-1">No wells match search.</span>
        )}
        {filteredWellList.map((entity: any) => {
          const isActive = selectedWellIds === null || selectedWellIds.has(entity.id);
          const vol = wellTotals?.get(entity.id);
          const volLabel = vol != null && vol > 0
            ? vol >= 1000 ? `${(vol / 1000).toFixed(1)}k m³` : `${Math.round(vol)} m³`
            : null;

          return (
            <button
              key={entity.id}
              onClick={() => toggleWell(entity.id)}
              title={`${entity.label}${volLabel ? ` — Total: ${volLabel}` : ''}`}
              className={[
                'flex items-center gap-1.5 h-6 px-2.5 rounded-full text-2xs font-semibold border transition-all leading-none max-w-[200px]',
                isActive
                  ? 'text-white border-transparent shadow-xs'
                  : 'bg-background/80 text-muted-foreground border-border/80 hover:border-foreground/40 hover:bg-muted/30 opacity-60',
              ].join(' ')}
              style={isActive ? { backgroundColor: entity.color, borderColor: entity.color } : {}}
            >
              {isActive ? <Check className="h-3 w-3 shrink-0" /> : <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: entity.color }} />}
              <span className="truncate">{entity.label}</span>
              {volLabel && (
                <span className={cn('text-3xs font-mono ml-0.5 shrink-0 opacity-85', isActive ? 'text-white' : 'text-muted-foreground')}>
                  {volLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="text-2xs text-muted-foreground flex items-center justify-between pt-1 border-t border-border/50 font-medium">
        <span>
          {allWellsSelected
            ? `Showing all ${wellEntities.length} extraction wells`
            : noneWellsSelected
              ? 'No wells selected — select at least one'
              : `Showing ${selectedWellIds!.size} of ${wellEntities.length} wells`}
        </span>
        {!allWellsSelected && (
          <button
            onClick={selectAllWells}
            className="text-2xs font-semibold text-primary hover:underline"
          >
            Reset to All
          </button>
        )}
      </div>
    </div>
  );
}
