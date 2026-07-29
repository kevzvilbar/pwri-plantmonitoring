// src/components/costs/CostsFiltersTab.tsx
//
// Content for the new "Costs → Filters" tab. Wire this in wherever the
// Rollup / Budget tab components are already registered as siblings —
// see PATCH_INSTRUCTIONS.md, section 3.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Spend this month
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold" data-testid="filter-spend-this-period">
            ₱{thisPeriodSpend.toLocaleString()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg. days between changes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{avgDays ?? "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last replacement
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{lastReplacement}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Monthly Filter Cost</CardTitle>
          {canEdit && (
            <FilterReplacementDialog
              plantId={plantId}
              plantName={plantName}
              filterHousingType={filterHousingType}
              onLogged={reload}
            />
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : (
            <FilterCostChart data={monthly} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Replacement History</CardTitle>
        </CardHeader>
        <CardContent>
          <FilterReplacementHistory rows={rows} canDelete={canEdit} onChanged={reload} />
        </CardContent>
      </Card>
    </div>
  );
}
