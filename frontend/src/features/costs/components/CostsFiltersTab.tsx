import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/StatCard";
import { Banknote, CalendarClock, History, Layers } from "lucide-react";
import {
  FilterReplacement,
  aggregateMonthly,
  averageDaysBetween,
  listFilterReplacements,
} from "@/lib/filterReplacements";
import { FilterCostChart } from "./FilterCostChart";
import { FilterReplacementDialog } from "./FilterReplacementDialog";
import { FilterReplacementHistory } from "./FilterReplacementHistory";

interface Props {
  plantId: string;
  plantName: string;
  /** plants.filter_housing_type, or the relevant train override. */
  filterHousingType: "Cartridge Filter" | "Bag Filter";
  /** Pass your existing Manager/Admin role check in from the parent —
   * gates both the "+ Log Replacement" button and row delete controls. */
  canEdit: boolean;
}

export function CostsFiltersTab({ plantId, plantName, filterHousingType, canEdit }: Props) {
  const [rows, setRows] = useState<FilterReplacement[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    listFilterReplacements({ plantId })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [plantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const monthly = aggregateMonthly(rows);
  const avgDays = averageDaysBetween(rows);
  const thisPeriodSpend = monthly.at(-1)?.total_cost ?? 0;
  const lastReplacement = rows[0]?.replacement_date ?? "—";

  return (
    <div className="space-y-3">
      {/* ── 3 KPI Cards ── */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <StatCard
          icon={Banknote}
          accent="text-primary"
          label="Spend this month"
          value={`₱${thisPeriodSpend.toLocaleString()}`}
          subtext="Latest monthly filter spend"
        />
        <StatCard
          icon={CalendarClock}
          accent="text-highlight"
          label="Avg. Days Between Changes"
          value={avgDays != null ? avgDays : "—"}
          unit={avgDays != null ? "days" : undefined}
          subtext="Calculated mean change interval"
        />
        <StatCard
          icon={History}
          accent="text-info"
          label="Last Replacement"
          value={lastReplacement}
          subtext={`Current housing: ${filterHousingType}`}
        />
      </div>

      {/* ── Monthly Filter Cost Chart ── */}
      <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Monthly Filter Cost</h4>
            <p className="text-2xs text-muted-foreground">Cartridge &amp; bag filter expenditures by month</p>
          </div>
          {canEdit && (
            <FilterReplacementDialog
              plantId={plantId}
              plantName={plantName}
              filterHousingType={filterHousingType}
              onLogged={reload}
            />
          )}
        </div>

        <div>
          {loading ? (
            <div className="py-12 text-center text-xs text-muted-foreground">Loading filter metrics…</div>
          ) : (
            <FilterCostChart data={monthly} />
          )}
        </div>
      </Card>

      {/* ── Replacement History ── */}
      <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Replacement History</h4>
          <p className="text-2xs text-muted-foreground">Log of cartridge &amp; bag filter changeouts</p>
        </div>
        <FilterReplacementHistory rows={rows} canDelete={canEdit} onChanged={reload} />
      </Card>
    </div>
  );
}
