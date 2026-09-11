import { Download, Droplet, Receipt, Gauge, TableProperties, Percent, Zap, Sun,
  Coins, Activity, TrendingUp, FlaskConical, Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SnapshotCards } from './SnapshotCards';

interface HeaderProps {
  title?: string;
  metric: string;
  onExportCsv: () => void;
  filterFrom: string;
  filterTo: string;
  setFilterFrom: (v: string) => void;
  setFilterTo: (v: string) => void;
  defaultFrom: string;
  defaultTo: string;
  activeTab: string;
  hasProdTab: boolean;
  hasConsTab: boolean;
  hasGridTab: boolean;
  hasChemBreakdownTab?: boolean;
  overviewLabel: string;
  prodTabLabel: string;
  setTab: (t: string) => void;
  summaryStats: {
    totalProd: number;
    totalCons: number;
    totalRaw: number;
    avgDailyProd: number;
    avgDailyCons: number;
    avgDailyRaw: number;
    peakProd: number;
    peakDate: string;
    peakRaw: number;
    nrwPct: number;
    totalSolar: number;
    totalGrid: number;
    totalKwh: number;
    solarPct: number;
    gridPvRatio: number | null;
    totalPvRatio: number | null;
    avgProdCost: number | null;
    avgPowerCost: number | null;
    avgChemCost: number | null;
    totalCostOutput: number;
    avgRecovery: number | null;
    minRecovery: number | null;
    maxRecovery: number | null;
    recoveryDays: number;
    avgTds: number | null;
    minTds: number | null;
    maxTds: number | null;
    tdsDays: number;
  };
  prodEntities: { id: string; label: string; kind: string }[];
}

export function Header({
  title, metric, onExportCsv,
  filterFrom, filterTo, setFilterFrom, setFilterTo, defaultFrom, defaultTo,
  activeTab, hasProdTab, hasConsTab, hasGridTab, hasChemBreakdownTab,
  overviewLabel, prodTabLabel, setTab,
  summaryStats, prodEntities,
}: HeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 pb-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold flex items-center gap-2">
              <TableProperties className="h-4 w-4 text-primary" />
              Data Summary — {title ?? metric}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-3xs font-medium bg-muted text-muted-foreground border border-border/60">
              Daily audit trail
            </span>
          </div>
          <p className="text-3xs text-muted-foreground">
            Verified day-level reading records and calculated entity deltas across the period.
          </p>
        </div>

        <div className="flex items-center gap-2 mr-8">
          <Button
            size="sm"
            variant="outline"
            onClick={onExportCsv}
            className="h-7 px-2.5 text-2xs gap-1.5 font-semibold text-muted-foreground hover:text-foreground shadow-xs"
          >
            <Download className="h-3 w-3 text-primary" />
            <span>Export CSV</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pb-3">
        <SnapshotCards metric={metric} stats={summaryStats} prodEntities={prodEntities} />
      </div>

      <div className="flex items-center gap-2 pb-2 flex-wrap border-t pt-2 border-border/40">
        <span className="text-2xs text-muted-foreground font-medium shrink-0">Date range:</span>
        <Input
          type="date"
          value={filterFrom}
          onChange={(e) => setFilterFrom(e.target.value)}
          placeholder={defaultFrom}
          className="h-6 w-[110px] text-2xs px-1.5"
        />
        <span className="text-2xs text-muted-foreground shrink-0">→</span>
        <Input
          type="date"
          value={filterTo}
          onChange={(e) => setFilterTo(e.target.value)}
          placeholder={defaultTo}
          className="h-6 w-[110px] text-2xs px-1.5"
        />
        {(filterFrom !== defaultFrom || filterTo !== defaultTo) && (
          <button
            onClick={() => { setFilterFrom(defaultFrom); setFilterTo(defaultTo); }}
            className="h-6 px-2 rounded text-2xs font-medium bg-muted text-muted-foreground hover:text-foreground border border-border transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex gap-0 -mb-px">
        {([
          { key: 'overview', label: overviewLabel, show: true },
          { key: 'chemical-breakdown', label: 'Chemical Specific', show: !!hasChemBreakdownTab },
          { key: 'grid-by-meter', label: 'Grid by Meter', show: hasGridTab },
          { key: 'production', label: prodTabLabel, show: hasProdTab },
          { key: 'consumption', label: 'Consumption', show: hasConsTab },
        ] as const).filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'px-5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer',
              activeTab === t.key
                ? 'border-primary text-primary bg-background'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}
