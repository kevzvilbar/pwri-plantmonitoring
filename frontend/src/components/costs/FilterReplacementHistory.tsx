// src/components/costs/FilterReplacementHistory.tsx
import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Trash2 } from "lucide-react";
import { FilterReplacement, deleteFilterReplacement } from "@/lib/filterReplacements";
import { useToast } from "@/hooks/use-toast";

interface Props {
  rows: FilterReplacement[];
  canDelete?: boolean;
  onChanged?: () => void;
}

export function FilterReplacementHistory({ rows, canDelete, onChanged }: Props) {
  const { toast } = useToast();

  const csvHref = useMemo(() => {
    const header = "date,housing_type,quantity,unit_price,total_cost,supplier,remarks\n";
    const body = rows
      .map((r) =>
        [
          r.replacement_date,
          r.filter_housing_type,
          r.quantity_replaced,
          r.unit_price,
          r.total_cost,
          r.supplier ?? "",
          (r.remarks ?? "").replace(/,/g, ";"),
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    return URL.createObjectURL(blob);
  }, [rows]);

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        "Remove this replacement record? This will also reduce that day's filter cost."
      )
    ) {
      return;
    }
    try {
      await deleteFilterReplacement(id);
      toast({ title: "Removed" });
      onChanged?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't remove",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <a href={csvHref} download="filter_replacements.csv">
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </a>
      </div>

      <Table data-testid="filter-replacement-history">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit ₱</TableHead>
            <TableHead className="text-right">Total ₱</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Remarks</TableHead>
            {canDelete && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={canDelete ? 8 : 7}
                className="text-center text-muted-foreground"
              >
                No replacements logged yet.
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.replacement_date}</TableCell>
              <TableCell>
                <Badge variant="secondary">{r.filter_housing_type}</Badge>
              </TableCell>
              <TableCell className="text-right">{r.quantity_replaced}</TableCell>
              <TableCell className="text-right">
                {r.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell className="text-right font-medium">
                {r.total_cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell>{r.supplier ?? "—"}</TableCell>
              <TableCell className="max-w-[200px] truncate">{r.remarks ?? "—"}</TableCell>
              {canDelete && (
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
