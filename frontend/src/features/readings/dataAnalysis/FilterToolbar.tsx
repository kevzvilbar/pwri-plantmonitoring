import { type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-picker';
import { cn } from '@/lib/utils';
import { SOURCE_TABLES, TABLES_WITHOUT_NORM_STATUS, TABLE_LABELS, ENTITY_CONFIG, POWER_SOURCE_OPTIONS, type Plant, type EntityOption } from './shared';

interface FilterToolbarProps {
  sourceTable: string;
  column: string;
  plantId: string;
  entityId: string;
  powerSource: string;
  dateFrom: string;
  dateTo: string;
  onColumnChange: (v: string) => void;
  onPlantChange: (v: string) => void;
  onEntityChange: (v: string) => void;
  onPowerSourceChange: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  handleTableChange: (t: string) => void;
  handlePlantChange: (p: string) => void;
  applyPreset: (days: number | null) => void;
  plants: Plant[];
  entityOptions: EntityOption[];
  entityFetching: boolean;
  entityCfgMain: { lookupTable: string; fkColumn: string; selectCols: string; labelFn: (row: Record<string, unknown>) => string; filterLabel: string } | undefined;
  canEdit: boolean;
}

export function FilterToolbar({
  sourceTable,
  column,
  plantId,
  entityId,
  powerSource,
  dateFrom,
  dateTo,
  onColumnChange,
  onPlantChange,
  onEntityChange,
  onPowerSourceChange,
  onDateFromChange,
  onDateToChange,
  handleTableChange,
  handlePlantChange,
  applyPreset,
  plants,
  entityOptions,
  entityFetching,
  entityCfgMain,
  canEdit,
}: FilterToolbarProps) {
  return (
    <>
      {/* ── 2. QUICK SOURCE TABLES SELECTOR ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {Object.entries(TABLE_LABELS).map(([k, label]) => {
          const isActive = sourceTable === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => handleTableChange(k)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all shrink-0 border flex items-center gap-1.5 ${
                isActive
                  ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                  : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted border-border'
              }`}
            >
              <span>{label}</span>
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── 3. FILTER CONSOLE TOOLBAR ── */}
      <div className="rounded-2xl border border-border/80 shadow-2xs overflow-hidden">
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            
            {/* Column Target */}
            <div className="space-y-1 lg:col-span-3">
              <Label htmlFor="dataanalysis-column" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                Target Telemetry Metric
              </Label>
              <Select value={column} onValueChange={onColumnChange}>
                <SelectTrigger className="h-9 text-xs rounded-xl font-mono bg-muted/30" id="dataanalysis-column">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(SOURCE_TABLES[sourceTable] ?? []).map(c => (
                    <SelectItem key={c} value={c} className="text-xs font-mono">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Plant Facility */}
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor="dataanalysis-plant" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                Plant Facility
              </Label>
              <Select value={plantId} onValueChange={handlePlantChange}>
                <SelectTrigger className="h-9 text-xs rounded-xl bg-muted/30" id="dataanalysis-plant">
                  <SelectValue placeholder="All plants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs text-muted-foreground">All plants</SelectItem>
                  {plants.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity drill-down */}
            {entityCfgMain && (
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="dataanalysis-field-2" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground flex items-center justify-between">
                  <span>{entityCfgMain.filterLabel}</span>
                  {entityOptions.length > 0 && (
                    <span className="text-3xs font-mono font-normal">
                      {entityOptions.length} available
                    </span>
                  )}
                </Label>
                <Select
                  value={entityId}
                  onValueChange={onEntityChange}
                  disabled={entityFetching && entityOptions.length === 0}
                >
                  <SelectTrigger className="h-9 text-xs rounded-xl bg-muted/30" id="dataanalysis-field-2">
                    <SelectValue
                      placeholder={
                        entityFetching
                          ? `Loading ${entityCfgMain.filterLabel}s…`
                          : `All ${entityCfgMain.filterLabel}s`
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs text-muted-foreground">
                      All {entityCfgMain.filterLabel}s ({entityOptions.length})
                    </SelectItem>
                    {entityOptions.map(opt => (
                      <SelectItem key={opt.id} value={opt.id} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Power Source filter */}
            {sourceTable === 'power_readings' && (
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="dataanalysis-source" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                  Power Stream
                </Label>
                <Select value={powerSource} onValueChange={onPowerSourceChange}>
                  <SelectTrigger className="h-9 text-xs rounded-xl bg-muted/30" id="dataanalysis-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POWER_SOURCE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date Range */}
            <div className="space-y-1 lg:col-span-4">
              <Label htmlFor="dataanalysis-from" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                Date Range
              </Label>
              <DateRangePicker
                from={dateFrom}
                to={dateTo}
                onChange={({ from: f, to: t }) => {
                  onDateFromChange(f);
                  onDateToChange(t);
                }}
                className="h-9 text-xs rounded-xl w-full"
              />
            </div>
          </div>

          {/* Quick Date Presets Bar */}
          <div className="flex items-center gap-1.5 pt-2 border-t border-border/50 text-2xs">
            <span className="text-muted-foreground font-semibold mr-1">Date Presets:</span>
            <button
              type="button"
              onClick={() => applyPreset(7)}
              className="px-2 py-0.5 rounded-lg bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last 7d
            </button>
            <button
              type="button"
              onClick={() => applyPreset(30)}
              className="px-2 py-0.5 rounded-lg bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last 30d
            </button>
            <button
              type="button"
              onClick={() => applyPreset(90)}
              className="px-2 py-0.5 rounded-lg bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last 90d
            </button>
            <button
              type="button"
              onClick={() => applyPreset(null)}
              className="px-2 py-0.5 rounded-lg bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              All Time
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
