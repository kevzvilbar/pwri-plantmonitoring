import { KPI_STATUS } from './constants';

function KpiLegend() {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-2xs text-muted-foreground font-semibold">Legend:</span>
      {Object.entries(KPI_STATUS).map(([key, cfg]) => (
        <div key={key} className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-sm" style={{ background: cfg.color }} />
          <span className="text-2xs text-muted-foreground">{cfg.label}</span>
        </div>
      ))}
      <span className="text-muted-foreground/40 hidden sm:inline">·</span>
      <span className="text-2xs text-muted-foreground">
        Individual weighting: <strong className="text-foreground">60% RO Train</strong> + <strong className="text-foreground">40% Shared Duties</strong>
      </span>
    </div>
  );
}

export { KpiLegend };
