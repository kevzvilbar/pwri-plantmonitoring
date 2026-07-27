/**
 * ro-trains/EditPretreatReadingDialog.tsx
 *
 * Dialog for editing an existing Pre-Treatment reading.
 * Extracted from ROTrains.tsx (§4 item 2 decomposition).
 *
 * Every field that appears in the Operator Log table is editable here —
 * HPP target pressure, bag/cartridge filters changed, AFM/MMF pressure IN
 * and OUT per unit (not just the derived ΔP), booster pump targets, and
 * cartridge/bag + standard filter housing pressures. Backwash windows and
 * MMF meter start/end are preserved as-is (not surfaced for editing here —
 * submit a new entry for those).
 *
 * Permission model (see helpers.ts canEditEntry): Managers, Admins, and
 * Data Analysts can edit any reading at any time. Operators can only edit
 * their own entries within EDIT_WINDOW_HOURS of submission; after that,
 * use "Request correction" instead.
 */
import { useState, type Dispatch, type SetStateAction } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { canEditEntry, diffFields, logReadingEdit, EDIT_WINDOW_HOURS } from './helpers';

interface Props {
  row: any;
  trainId: string;
  onClose: () => void;
  onSaved: () => void;
}

// ─── Per-unit editable state shapes ───────────────────────────────────────────
// String-valued (not number) so inputs can hold '' while the operator is
// mid-edit — converted to number | null only when building the save payload.

interface AfmUnitState {
  unit: number;
  in_psi: string;
  out_psi: string;
  /** Preserved verbatim — not editable in this dialog. */
  backwash_start: string | null;
  backwash_end: string | null;
}
interface BoosterState {
  unit: number;
  target_pressure_psi: string;
  target_hz: string;
  amperage: string;
}
interface HousingState {
  unit: number;
  in_psi: string;
  out_psi: string;
}

const toStr = (v: unknown): string => (v != null ? String(v) : '');
const toNum = (s: string): number | null => (s !== '' ? +s : null);

/** Updates one item in a unit-array state list by index, keeping the rest untouched. */
function updateAt<T>(setter: Dispatch<SetStateAction<T[]>>, idx: number, patch: Partial<T>) {
  setter((arr) => arr.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
}

export function EditPretreatReadingDialog({ row, trainId, onClose, onSaved }: Props) {
  const { isManager, isDataAnalyst, activeOperator, user } = useAuth();
  const hasFullAccess = isManager || isDataAnalyst;
  const [saving, setSaving]         = useState(false);
  const [dt, setDt]                 = useState(row.reading_datetime
    ? format(new Date(row.reading_datetime), "yyyy-MM-dd'T'HH:mm") : '');
  const [hpp, setHpp]               = useState(toStr(row.hpp_target_pressure_psi));
  const [bagFilters, setBagFilters] = useState(toStr(row.bag_filters_changed));
  const [remarks, setRemarks]       = useState(row.remarks ?? '');

  const [afmUnits, setAfmUnits] = useState<AfmUnitState[]>(() =>
    (Array.isArray(row.afm_units) ? row.afm_units : []).map((u) => ({
      unit:           u.unit,
      in_psi:         toStr(u.in_psi),
      out_psi:        toStr(u.out_psi),
      backwash_start: u.backwash_start ?? null,
      backwash_end:   u.backwash_end ?? null,
    })),
  );
  const [boosterPumps, setBoosterPumps] = useState<BoosterState[]>(() =>
    (Array.isArray(row.booster_pumps) ? row.booster_pumps : []).map((p) => ({
      unit:                 p.unit,
      target_pressure_psi:  toStr(p.target_pressure_psi),
      target_hz:            toStr(p.target_hz),
      amperage:             toStr(p.amperage),
    })),
  );
  const [cartHousings, setCartHousings] = useState<HousingState[]>(() =>
    (Array.isArray(row.cartridge_filter_housings) ? row.cartridge_filter_housings : []).map((h) => ({
      unit: h.unit, in_psi: toStr(h.in_psi), out_psi: toStr(h.out_psi),
    })),
  );
  const [filterHousings, setFilterHousings] = useState<HousingState[]>(() =>
    (Array.isArray(row.filter_housings) ? row.filter_housings : []).map((h) => ({
      unit: h.unit, in_psi: toStr(h.in_psi), out_psi: toStr(h.out_psi),
    })),
  );

  const canSave = canEditEntry(row, hasFullAccess, activeOperator?.id);

  const handleSave = async () => {
    if (!canSave) { toast.error('You no longer have permission to edit this entry.'); return; }
    setSaving(true);

    const payload = {
      reading_datetime:        new Date(dt).toISOString(),
      hpp_target_pressure_psi: toNum(hpp),
      bag_filters_changed:     toNum(bagFilters),
      remarks:                 remarks || null,
      afm_units: afmUnits.map((u) => {
        const inP  = toNum(u.in_psi);
        const outP = toNum(u.out_psi);
        return {
          unit:           u.unit,
          in_psi:         inP,
          out_psi:        outP,
          dp_psi:         inP != null && outP != null ? +(inP - outP).toFixed(2) : null,
          backwash_start: u.backwash_start,
          backwash_end:   u.backwash_end,
        };
      }),
      booster_pumps: boosterPumps.map((p) => {
        const targetPsi = toNum(p.target_pressure_psi);
        return {
          unit:                 p.unit,
          target_pressure_psi:  targetPsi,
          target_hz:             toNum(p.target_hz),
          hz_mode:               targetPsi == null,
          amperage:              toNum(p.amperage),
        };
      }),
      cartridge_filter_housings: cartHousings.map((h) => ({
        unit: h.unit, in_psi: toNum(h.in_psi), out_psi: toNum(h.out_psi),
      })),
      filter_housings: filterHousings.map((h) => ({
        unit: h.unit, in_psi: toNum(h.in_psi), out_psi: toNum(h.out_psi),
      })),
    };

    const { error } = await (supabase.from('ro_pretreatment_readings' as any) as any)
      .update(payload).eq('id', row.id);
    if (error) { setSaving(false); toast.error(friendlyError(error)); return; }

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    await logReadingEdit({
      table_name:    'ro_pretreatment_readings',
      record_id:     row.id,
      plant_id:      row.plant_id ?? null,
      train_id:      trainId,
      actor_user_id: user?.id ?? null,
      actor_label:   actorLabel,
      changes:       diffFields(row, payload),
    });

    setSaving(false);
    toast.success('Reading updated');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Pre-Treatment Reading</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <Label className="text-xs">Date / Time</Label>
            <Input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} className="h-9" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">HPP Pressure (psi)</Label>
              <Input type="number" step="any" value={hpp} onChange={(e) => setHpp(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Bag/Cartridge Filters Changed (count)</Label>
              <Input type="number" step="1" value={bagFilters} onChange={(e) => setBagFilters(e.target.value)} className="h-9" />
            </div>
          </div>

          {afmUnits.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">AFM / MMF Units — Pressure In / Out</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                {afmUnits.map((u, idx) => {
                  const inP  = toNum(u.in_psi);
                  const outP = toNum(u.out_psi);
                  return (
                    <div key={u.unit} className="rounded-md border p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted-foreground">Unit U{u.unit}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {inP != null && outP != null ? `ΔP ${(inP - outP).toFixed(1)} psi` : '—'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">In (psi)</Label>
                          <Input type="number" step="any" value={u.in_psi} className="h-8"
                            onChange={(e) => updateAt(setAfmUnits, idx, { in_psi: e.target.value })} />
                        </div>
                        <div>
                          <Label className="text-[10px]">Out (psi)</Label>
                          <Input type="number" step="any" value={u.out_psi} className="h-8"
                            onChange={(e) => updateAt(setAfmUnits, idx, { out_psi: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {boosterPumps.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">Booster Pumps</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                {boosterPumps.map((p, idx) => (
                  <div key={p.unit} className="rounded-md border p-2.5 space-y-2">
                    <span className="text-[11px] font-semibold text-muted-foreground">Pump P{p.unit}</span>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[10px]">Target (psi)</Label>
                        <Input type="number" step="any" value={p.target_pressure_psi} className="h-8"
                          onChange={(e) => updateAt(setBoosterPumps, idx, { target_pressure_psi: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-[10px]">Target (Hz)</Label>
                        <Input type="number" step="any" value={p.target_hz} className="h-8"
                          onChange={(e) => updateAt(setBoosterPumps, idx, { target_hz: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-[10px]">Amperage (A)</Label>
                        <Input type="number" step="any" value={p.amperage} className="h-8"
                          onChange={(e) => updateAt(setBoosterPumps, idx, { amperage: e.target.value })} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {cartHousings.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">Cartridge / Bag Filter Housings — Pressure In / Out</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                {cartHousings.map((h, idx) => {
                  const inP  = toNum(h.in_psi);
                  const outP = toNum(h.out_psi);
                  return (
                    <div key={h.unit} className="rounded-md border p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted-foreground">Housing H{h.unit}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {inP != null && outP != null ? `ΔP ${(inP - outP).toFixed(1)} psi` : '—'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">In (psi)</Label>
                          <Input type="number" step="any" value={h.in_psi} className="h-8"
                            onChange={(e) => updateAt(setCartHousings, idx, { in_psi: e.target.value })} />
                        </div>
                        <div>
                          <Label className="text-[10px]">Out (psi)</Label>
                          <Input type="number" step="any" value={h.out_psi} className="h-8"
                            onChange={(e) => updateAt(setCartHousings, idx, { out_psi: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {filterHousings.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">Filter Housings — Pressure In / Out</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                {filterHousings.map((h, idx) => {
                  const inP  = toNum(h.in_psi);
                  const outP = toNum(h.out_psi);
                  return (
                    <div key={h.unit} className="rounded-md border p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted-foreground">Housing F{h.unit}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {inP != null && outP != null ? `ΔP ${(inP - outP).toFixed(1)} psi` : '—'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">In (psi)</Label>
                          <Input type="number" step="any" value={h.in_psi} className="h-8"
                            onChange={(e) => updateAt(setFilterHousings, idx, { in_psi: e.target.value })} />
                        </div>
                        <div>
                          <Label className="text-[10px]">Out (psi)</Label>
                          <Input type="number" step="any" value={h.out_psi} className="h-8"
                            onChange={(e) => updateAt(setFilterHousings, idx, { out_psi: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[60px]" />
          </div>

          <p className="text-[11px] text-muted-foreground">
            {hasFullAccess
              ? 'As a Manager, Data Analyst, or Admin, you can edit any reading at any time.'
              : `You can edit your own entries within ${EDIT_WINDOW_HOURS} hours of submission. After that, use "Request correction" instead. Backwash windows and MMF meter start/end aren't editable here — submit a new entry to correct those.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
