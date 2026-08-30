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
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  FilterHousingType,
  getLastUnitPrice,
  getPriceListEntry,
  logFilterReplacement,
  syncPriceToPriceList,
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
  const { user } = useAuth();
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

  // Where the prefilled unit price came from — shown as a small hint so
  // Manager/Admin knows whether they're looking at the maintained Prices
  // list or a guess from past replacements.
  const [priceSource, setPriceSource] = useState<"price-list" | "history" | null>(null);
  const [priceListUnit, setPriceListUnit] = useState<string>("pcs");

  // Prefill unit price. Tries the Costs → Prices tab first (the shared,
  // Manager/Admin-maintained price list — see lib/filterReplacements.ts's
  // getPriceListEntry), and only falls back to whatever was last paid on
  // THIS plant's own replacement history if nothing's listed there yet.
  useEffect(() => {
    if (!open) return;
    setPriceSource(null);
    let cancelled = false;

    getPriceListEntry(filterHousingType)
      .then((entry) => {
        if (cancelled) return;
        if (entry) {
          setUnitPrice(String(entry.price));
          setPriceListUnit(entry.unit);
          setPriceSource("price-list");
          return;
        }
        return getLastUnitPrice(plantId, filterHousingType).then((price) => {
          if (cancelled || price == null) return;
          setUnitPrice(String(price));
          setPriceSource("history");
        });
      })
      .catch(() => {
        /* non-fatal — leave blank for manual entry */
      });

    return () => {
      cancelled = true;
    };
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
    setPriceSource(null);
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

      // Two-way wiring: mirror this price back into the Prices tab if it's
      // new information (no entry yet, or it differs from the one on file).
      // Non-fatal if it fails — the replacement itself is already saved.
      let priceSynced = false;
      try {
        priceSynced = await syncPriceToPriceList({
          housingType: filterHousingType,
          unitPrice: priceNum,
          effectiveDate: replacementDate,
          updatedBy: user?.id ?? null,
        });
      } catch {
        /* non-fatal */
      }

      toast({
        title: "Replacement logged",
        description: priceSynced
          ? `₱${totalCost.toLocaleString()} recorded for ${plantName}. Prices tab updated too.`
          : `₱${totalCost.toLocaleString()} recorded for ${plantName}.`,
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
    <>
      <Button size="sm" className="h-8 px-3 text-xs gap-1.5 font-medium shadow-xs" data-testid="log-filter-replacement-btn" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Log Replacement
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Log Filter Replacement"
        className="sm:max-w-md"
        footer={(
          <div className="flex gap-2 justify-end w-full">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} data-testid="filter-replacement-save">
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      >
        <div className="space-y-4 pb-4">
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
              <DatePicker
                id="replacement-date"
                value={replacementDate}
                onChange={(d) => setReplacementDate(d)}
                className="w-full mt-1.5"
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
                onChange={(e) => {
                  setUnitPrice(e.target.value);
                  setPriceSource(null); // manually overridden — no longer "from" either source
                }}
                data-testid="filter-replacement-unit-price"
              />
              {priceSource === "price-list" && (
                <p className="text-xs text-muted-foreground mt-1">
                  From Prices tab (₱/{priceListUnit})
                </p>
              )}
              {priceSource === "history" && (
                <p className="text-xs text-muted-foreground mt-1">
                  From last replacement — not yet in Prices tab
                </p>
              )}
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
      </ResponsiveDialog>
    </>
  );
}
