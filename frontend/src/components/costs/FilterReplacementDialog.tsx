// src/components/costs/FilterReplacementDialog.tsx
//
// "+ Log Replacement" dialog for the Costs → Filters tab. Modeled on
// AddStockDialog's shape (quantity / unit price / supplier / auto-total).
// Gate rendering of this component's trigger at the call site to
// Manager/Admin only — see CostsFiltersTab.tsx's `canEdit` prop.
//
// ⚠ Adjust the useToast import path if this repo's toast hook lives
//   somewhere else.
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  FilterHousingType,
  getLastUnitPrice,
  logFilterReplacement,
} from "@/lib/filterReplacements";

interface Props {
  plantId: string;
  plantName: string;
  /** Read-only — sourced from plants.filter_housing_type or the train's
   * override, not user-selectable. */
  filterHousingType: FilterHousingType;
  trainId?: string | null;
  trainName?: string | null;
  onLogged?: () => void;
}

export function FilterReplacementDialog({
  plantId,
  plantName,
  filterHousingType,
  trainId,
  trainName,
  onLogged,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [replacementDate, setReplacementDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [avgDp, setAvgDp] = useState("");
  const [supplier, setSupplier] = useState("");
  const [remarks, setRemarks] = useState("");

  // Prefill unit price with whatever was last paid for this plant + housing
  // type, so Manager/Admin isn't retyping a known price every time.
  useEffect(() => {
    if (!open) return;
    getLastUnitPrice(plantId, filterHousingType)
      .then((price) => {
        if (price != null) setUnitPrice(String(price));
      })
      .catch(() => {
        /* non-fatal — leave blank for manual entry */
      });
  }, [open, plantId, filterHousingType]);

  const qtyNum = Number(quantity) || 0;
  const priceNum = Number(unitPrice) || 0;
  const totalCost = qtyNum * priceNum;

  const resetForm = () => {
    setReplacementDate(new Date().toISOString().slice(0, 10));
    setQuantity("1");
    setUnitPrice("");
    setAvgDp("");
    setSupplier("");
    setRemarks("");
  };

  const handleSubmit = async () => {
    if (qtyNum <= 0 || priceNum < 0 || !replacementDate) {
      toast({
        variant: "destructive",
        title: "Check the form",
        description: "Quantity must be at least 1 and unit price can't be negative.",
      });
      return;
    }

    setSubmitting(true);
    try {
      await logFilterReplacement({
        plant_id: plantId,
        train_id: trainId ?? null,
        replacement_date: replacementDate,
        filter_housing_type: filterHousingType,
        quantity_replaced: qtyNum,
        unit_price: priceNum,
        avg_dp_psi: avgDp ? Number(avgDp) : null,
        supplier: supplier || null,
        remarks: remarks || null,
      });

      toast({
        title: "Replacement logged",
        description: `₱${totalCost.toLocaleString()} recorded for ${plantName}.`,
      });
      resetForm();
      setOpen(false);
      onLogged?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't save",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="log-filter-replacement-btn">+ Log Replacement</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Filter Replacement</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {trainName ? `${plantName} — ${trainName}` : plantName}
            </span>
            <Badge variant="secondary" data-testid="filter-housing-type-badge">
              {filterHousingType}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="replacement-date">Date</Label>
              <Input
                id="replacement-date"
                type="date"
                value={replacementDate}
                onChange={(e) => setReplacementDate(e.target.value)}
                data-testid="filter-replacement-date"
              />
            </div>
            <div>
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                data-testid="filter-replacement-qty"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="unit-price">Unit price (₱)</Label>
              <Input
                id="unit-price"
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                data-testid="filter-replacement-unit-price"
              />
            </div>
            <div>
              <Label htmlFor="avg-dp">ΔP at change (psi, optional)</Label>
              <Input
                id="avg-dp"
                type="number"
                step="0.1"
                value={avgDp}
                onChange={(e) => setAvgDp(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            Total cost:{" "}
            <span className="font-semibold" data-testid="filter-replacement-total">
              ₱{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div>
            <Label htmlFor="supplier">Supplier (optional)</Label>
            <Input id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="remarks">Remarks (optional)</Label>
            <Textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="filter-replacement-save">
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
