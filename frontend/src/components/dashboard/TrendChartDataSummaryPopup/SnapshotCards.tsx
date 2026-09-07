import { Download, Droplet, Receipt, Gauge, TableProperties, Percent, Zap, Sun,
  Coins, Activity, TrendingUp, FlaskConical, Calendar,
} from 'lucide-react';

interface StatCardProps {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  value: React.ReactNode;
  unit?: string;
}

function StatCard({ icon, iconColor, label, value, unit }: StatCardProps) {
  return (
    <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
      <div className={`text-2xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1 ${iconColor}`}>
        <span className="h-3 w-3 flex items-center justify-center">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="font-mono text-sm font-bold text-foreground mt-0.5">
        {value}
        {unit && <span className="text-3xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

interface SnapshotCardsProps {
  metric: string;
  stats: {
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

export function SnapshotCards({ metric, stats, prodEntities }: SnapshotCardsProps) {
  if (metric === 'kwh') {
    return (
      <>
        <StatCard icon={<Zap />} iconColor="text-primary" label="Total Power"
          value={stats.totalKwh > 0 ? stats.totalKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="kWh" />
        <StatCard icon={<Zap className="text-amber-500" />} iconColor="" label="Total Grid"
          value={stats.totalGrid > 0 ? stats.totalGrid.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="kWh" />
        <StatCard icon={<Sun className="text-orange-400" />} iconColor="" label="Total Solar"
          value={stats.totalSolar > 0 ? stats.totalSolar.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="kWh" />
        <StatCard icon={<Percent className="text-emerald-500" />} iconColor="" label="Solar Share"
          value={stats.totalKwh > 0 ? `${stats.solarPct.toFixed(1)}%` : '—'} />
      </>
    );
  }

  if (metric === 'productionCost' || metric === 'chemCost' || metric === 'powerCost') {
    return (
      <>
        <StatCard icon={<Coins />} iconColor="text-primary" label="Avg Prod Cost"
          value={stats.avgProdCost != null ? `₱${stats.avgProdCost.toFixed(4)}` : '—'} unit="/m³" />
        <StatCard icon={<Zap className="text-amber-500" />} iconColor="" label="Avg Power Cost"
          value={stats.avgPowerCost != null ? `₱${stats.avgPowerCost.toFixed(4)}` : '—'} unit="/m³" />
        <StatCard icon={<FlaskConical className="text-cyan-500" />} iconColor="" label="Avg Chem Cost"
          value={stats.avgChemCost != null ? `₱${stats.avgChemCost.toFixed(4)}` : '—'} unit="/m³" />
        <StatCard icon={<Droplet className="text-sky-500" />} iconColor="" label="Total Output"
          value={stats.totalCostOutput > 0 ? stats.totalCostOutput.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="m³" />
      </>
    );
  }

  if (metric === 'pv') {
    return (
      <>
        <StatCard icon={<Droplet />} iconColor="text-primary" label="Total Production"
          value={stats.totalProd > 0 ? stats.totalProd.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="m³" />
        <StatCard icon={<Zap className="text-amber-500" />} iconColor="" label="Total Power"
          value={stats.totalKwh > 0 ? stats.totalKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="kWh" />
        <StatCard icon={<Gauge className="text-sky-500" />} iconColor="" label="Grid PV Ratio"
          value={stats.gridPvRatio != null ? stats.gridPvRatio.toFixed(2) : '—'} unit="kWh/m³" />
        <StatCard icon={<TrendingUp className="text-emerald-500" />} iconColor="" label="Overall PV Ratio"
          value={stats.totalPvRatio != null ? stats.totalPvRatio.toFixed(2) : '—'} unit="kWh/m³" />
      </>
    );
  }

  if (metric === 'recovery') {
    return (
      <>
        <StatCard icon={<Activity />} iconColor="text-primary" label="Avg Recovery"
          value={stats.avgRecovery != null ? `${stats.avgRecovery.toFixed(1)}%` : '—'} />
        <StatCard icon={<TrendingUp className="text-amber-500" />} iconColor="" label="Min Recovery"
          value={stats.minRecovery != null ? `${stats.minRecovery.toFixed(1)}%` : '—'} />
        <StatCard icon={<TrendingUp className="text-emerald-500" />} iconColor="" label="Max Recovery"
          value={stats.maxRecovery != null ? `${stats.maxRecovery.toFixed(1)}%` : '—'} />
        <StatCard icon={<Calendar className="text-sky-500" />} iconColor="" label="Recorded Days"
          value={stats.recoveryDays > 0 ? `${stats.recoveryDays} days` : '—'} />
      </>
    );
  }

  if (metric === 'tds') {
    return (
      <>
        <StatCard icon={<Activity />} iconColor="text-primary" label="Avg Permeate TDS"
          value={stats.avgTds != null ? `${Math.round(stats.avgTds)}` : '—'} unit="ppm" />
        <StatCard icon={<TrendingUp className="text-emerald-500" />} iconColor="" label="Min TDS"
          value={stats.minTds != null ? `${stats.minTds}` : '—'} unit="ppm" />
        <StatCard icon={<TrendingUp className="text-rose-500" />} iconColor="" label="Max TDS"
          value={stats.maxTds != null ? `${stats.maxTds}` : '—'} unit="ppm" />
        <StatCard icon={<Calendar className="text-sky-500" />} iconColor="" label="Recorded Days"
          value={stats.tdsDays > 0 ? `${stats.tdsDays} days` : '—'} />
      </>
    );
  }

  if (metric === 'rawwater') {
    return (
      <>
        <StatCard icon={<Droplet />} iconColor="text-primary" label="Total Raw Intake"
          value={stats.totalRaw > 0 ? stats.totalRaw.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="m³" />
        <StatCard icon={<Gauge className="text-sky-500" />} iconColor="" label="Daily Avg Intake"
          value={stats.avgDailyRaw > 0 ? stats.avgDailyRaw.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="m³/day" />
        <StatCard icon={<TrendingUp className="text-amber-500" />} iconColor="" label="Peak Daily Intake"
          value={stats.peakRaw > 0 ? stats.peakRaw.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="m³" />
        <StatCard icon={<Activity className="text-emerald-500" />} iconColor="" label="Active Wells"
          value={prodEntities.length > 0 ? `${prodEntities.length} wells` : '—'} />
      </>
    );
  }

  return (
    <>
      <StatCard icon={<Droplet />} iconColor="text-primary" label="Total Prod"
        value={stats.totalProd > 0 ? stats.totalProd.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="m³" />
      <StatCard icon={<Receipt className="text-highlight" />} iconColor="" label="Total Cons"
        value={stats.totalCons > 0 ? stats.totalCons.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="m³" />
      <StatCard icon={<Gauge className="text-sky-500" />} iconColor="" label="Daily Avg Output"
        value={stats.avgDailyProd > 0 ? stats.avgDailyProd.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="m³/day" />
      <StatCard icon={<Percent className="text-emerald-500" />} iconColor="" label="Period NRW Loss"
        value={stats.totalProd > 0 ? `${stats.nrwPct.toFixed(1)}%` : '—'} />
    </>
  );
}
