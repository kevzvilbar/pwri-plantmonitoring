// src/components/costs/FilterUsageHistory.tsx
//
// Read-only — there's nothing to edit or delete here. Each row is derived
// from a Pre-Treatment & RO log entry; corrections happen there, not here.
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FilterUsageDay } from "@/lib/filterUsage";

interface Props {
  rows: FilterUsageDay[];
}

export function FilterUsageHistory({ rows }: Props) {
  return (
    <Table data-testid="filter-usage-history">
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Qty Changed</TableHead>
          <TableHead className="text-right">Cost (₱)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground">
              No filter changes logged in this period.
            </TableCell>
          </TableRow>
        )}
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.reading_date}</TableCell>
            <TableCell>
              <Badge variant="secondary">{r.filter_housing_type}</Badge>
            </TableCell>
            <TableCell className="text-right">{r.quantity_changed}</TableCell>
            <TableCell className="text-right font-medium">
              {r.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
