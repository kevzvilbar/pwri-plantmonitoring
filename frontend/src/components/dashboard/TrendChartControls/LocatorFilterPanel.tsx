import React from 'react';
import { Button } from '@/components/ui/button';
import { X, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocatorFilterPanelProps {
  metric: string;
  showLocatorFilter: boolean;
  allSelected: boolean;
  noneSelected: boolean;
  drillEntities: any[];
  selectedLocatorIds: Set<string> | null;
  filteredLocatorList: any[];
  locatorSearch: string;
  locatorTotals: Map<string, number> | undefined;
  selectAllLocators: () => void;
  clearAllLocators: () => void;
  setShowLocatorFilter: (v: boolean) => void;
  setLocatorSearch: (v: string) => void;
  toggleLocator: (id: string) => void;
  selectTopNLocators: (n: number) => void;
}

export function LocatorFilterPanel({
  metric, showLocatorFilter, allSelected, noneSelected, drillEntities,
  selectedLocatorIds, filteredLocatorList, locatorSearch, locatorTotals,
  selectAllLocators, clearAllLocators, setShowLocatorFilter, setLocatorSearch,
  toggleLocator, selectTopNLocators,
}: LocatorFilterPanelProps) {
  if (!showLocatorFilter) return null;

  return (
    <div className="mb-2 rounded-lg border border-border/80 bg-card/90 shadow-sm p-2.5 flex flex-col gap-2 backdrop-blur-sm" data-testid={`locator-filter-panel-${metric}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-border/50">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold text-foreground shrink-0">Filter Locators</span>
          <span className="text-3xs text-muted-foreground">| Quick Presets:</span>
          <button
            onClick={() => selectTopNLocators(3)}
            className="h-5 px-2 rounded-md text-3xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
            title="Select Top 3 highest volume locators"
          >
            Top 3
          </button>
          <button
            onClick={() => selectTopNLocators(5)}
            className="h-5 px-2 rounded-md text-3xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
            title="Select Top 5 highest volume locators"
          >
            Top 5
          </button>
          {drillEntities.length > 10 && (
            <button
              onClick={() => selectTopNLocators(10)}
              className="h-5 px-2 rounded-md text-3xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
              title="Select Top 10 highest volume locators"
            >
              Top 10
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={selectAllLocators}
            className={[
              'h-5 px-2 rounded text-2xs font-semibold border transition-colors leading-none',
              allSelected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground hover:text-foreground border-border',
            ].join(' ')}
          >
            All ({drillEntities.length})
          </button>
          <button
            onClick={clearAllLocators}
            className={[
              'h-5 px-2 rounded text-2xs font-semibold border transition-colors leading-none',
              noneSelected
                ? 'bg-danger text-white border-danger'
                : 'bg-muted text-muted-foreground hover:text-foreground border-border',
            ].join(' ')}
          >
            Clear
          </button>
          <button
            onClick={() => setShowLocatorFilter(false)}
            className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Close filter"
            aria-label="Close filter"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {drillEntities.length > 6 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={locatorSearch}
            onChange={(e) => setLocatorSearch(e.target.value)}
            placeholder="Search locator name or area…"
            className="w-full h-7 pl-7 pr-6 rounded-md border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {locatorSearch && (
            <button
              onClick={() => setLocatorSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-0.5 py-0.5">
        {filteredLocatorList.length === 0 && (
          <span className="text-xs text-muted-foreground py-1">No locators match search.</span>
        )}
        {filteredLocatorList.map((entity: any) => {
          const isActive = selectedLocatorIds === null || selectedLocatorIds.has(entity.id);
          const vol = locatorTotals?.get(entity.id);
          const volLabel = vol != null && vol > 0
            ? vol >= 1000 ? `${(vol / 1000).toFixed(1)}k m³` : `${Math.round(vol)} m³`
            : null;

          return (
            <button
              key={entity.id}
              onClick={() => toggleLocator(entity.id)}
              title={`${entity.label}${volLabel ? ` — Total: ${volLabel}` : ''}`}
              className={[
                'flex items-center gap-1.5 h-6 px-2.5 rounded-full text-2xs font-semibold border transition-all leading-none max-w-[220px]',
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
          {allSelected
            ? `Showing all ${drillEntities.length} locators`
            : noneSelected
              ? 'No locators selected — select at least one'
              : `Showing ${selectedLocatorIds!.size} of ${drillEntities.length} locators`}
        </span>
        {!allSelected && (
          <button
            onClick={selectAllLocators}
            className="text-2xs font-semibold text-primary hover:underline"
          >
            Reset to All
          </button>
        )}
      </div>
    </div>
  );
}
