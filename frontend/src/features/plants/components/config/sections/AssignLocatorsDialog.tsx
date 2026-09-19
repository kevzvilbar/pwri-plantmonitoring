import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Droplet } from 'lucide-react';
import { friendlyError } from '@/lib/supabaseErrors';

export function AssignLocatorsDialog({
  meter, plantId, onClose, onSaved,
}: {
  meter: any;
  plantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: locators, isLoading } = useQuery({
    queryKey: ['locators-assign', plantId],
    queryFn: async () => {
      let data: any, error: any;
      ({ data, error } = await supabase
        .from('locators')
        .select('id, name, status, product_meter_id, is_derived, derived_from_meter_id')
        .eq('plant_id', plantId).order('name'));
      if (error && error.message?.includes('column')) {
        ({ data, error } = await supabase
          .from('locators')
          .select('id, name, status, product_meter_id')
          .eq('plant_id', plantId).order('name'));
        if (!error && data) {
          data = (data as any[]).map((l) => ({ ...l, is_derived: false, derived_from_meter_id: null }));
        }
      }
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: allPlants } = useQuery({
    queryKey: ['all-plants'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').order('name');
      return (data ?? []) as any[];
    },
  });

  const locatorIds = (locators ?? []).map((l) => l.id);
  const { data: existingMirrors } = useQuery({
    queryKey: ['mirror-targets-for-locators', locatorIds.join(',')],
    enabled: locatorIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id, plant_id, derived_from_locator_id, is_derived')
        .in('derived_from_locator_id', locatorIds);
      return (data ?? []) as Array<{ id: string; plant_id: string; derived_from_locator_id: string; is_derived: boolean }>;
    },
  });

  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [derivedMap, setDerivedMap] = useState<Record<string, boolean>>({});
  const [mirrorMap,  setMirrorMap]  = useState<Record<string, { plantId: string; meterId: string }>>({});
  const [mirrorMeters, setMirrorMeters] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!locators) return;
    setSelected(new Set(locators.filter((l: any) => l.product_meter_id === meter.id).map((l: any) => l.id)));
    const dm: Record<string, boolean> = {};
    locators.forEach((l: any) => {
      if (l.product_meter_id === meter.id) dm[l.id] = !!l.is_derived;
    });
    setDerivedMap(dm);
  }, [locators, meter.id]);

  useEffect(() => {
    if (!existingMirrors?.length) return;
    const mm: Record<string, { plantId: string; meterId: string }> = {};
    for (const row of existingMirrors) {
      mm[row.derived_from_locator_id] = { plantId: row.plant_id, meterId: row.id };
    }
    setMirrorMap(prev => ({ ...mm, ...prev }));
    const plantIds = [...new Set(existingMirrors.map(r => r.plant_id))];
    plantIds.forEach(pid => { loadMirrorMeters(pid); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingMirrors]);

  const [busy, setBusy] = useState(false);

  const mirrorNeedsRepair = useMemo(
    () => new Set((existingMirrors ?? []).filter(r => !r.is_derived).map(r => r.derived_from_locator_id)),
    [existingMirrors],
  );

  const derivedCount = [...selected].filter(id => derivedMap[id]).length;

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleDerived = (id: string, val: boolean) => {
    if (val && derivedCount >= 1 && !derivedMap[id]) {
      toast.error('Only one derived (no-meter) locator is allowed per product meter.');
      return;
    }
    setDerivedMap(prev => ({ ...prev, [id]: val }));
  };

  const loadMirrorMeters = async (pid: string) => {
    if (mirrorMeters[pid]) return;
    const { data } = await (supabase.from('product_meters' as any) as any)
      .select('id, name').eq('plant_id', pid).order('name');
    setMirrorMeters(prev => ({ ...prev, [pid]: data ?? [] }));
  };

  const save = async () => {
    if (!locators) return;
    setBusy(true);
    const toAssign   = locators.filter((l: any) =>  selected.has(l.id) && l.product_meter_id !== meter.id);
    const toUnassign = locators.filter((l: any) => !selected.has(l.id) && l.product_meter_id === meter.id);

    try {
      for (const l of toAssign) {
        const isDer = !!derivedMap[l.id];
        const payload: any = { product_meter_id: meter.id, is_derived: isDer, derived_from_meter_id: isDer ? meter.id : null };
        if (isDer) payload.default_input_mode = 'direct';
        const { error } = await supabase
          .from('locators')
          .update(payload)
          .eq('id', l.id);
        if (error && !error.message.includes('column')) throw error;
      }

      for (const l of locators.filter((l: any) => selected.has(l.id) && l.product_meter_id === meter.id)) {
        const isDer = !!derivedMap[l.id];
        const wasD  = !!l.is_derived;
        if (isDer !== wasD) {
          await supabase.from('locators')
            .update({ is_derived: isDer, derived_from_meter_id: isDer ? meter.id : null, default_input_mode: isDer ? 'direct' : 'raw' } as any)
            .eq('id', l.id);
        }
      }

      if (toUnassign.length) {
        const { error } = await supabase.from('locators')
          .update({ product_meter_id: null, is_derived: false, derived_from_meter_id: null } as any)
          .in('id', toUnassign.map((l: any) => l.id));
        if (error && !error.message.includes('column')) throw error;

        const unassignWasDerivedIds = toUnassign.filter((l: any) => l.is_derived).map((l: any) => l.id);
        if (unassignWasDerivedIds.length) {
          await supabase.from('locators')
            .update({ default_input_mode: 'raw' } as any)
            .in('id', unassignWasDerivedIds);
        }
      }

      for (const [locId, mirror] of Object.entries(mirrorMap)) {
        if (!selected.has(locId) || !derivedMap[locId]) continue;
        if (!mirror.meterId) continue;
        const { error } = await supabase.rpc('fn_set_product_meter_mirror' as any, {
          p_meter_id: mirror.meterId,
          p_derived_from_locator_id: locId,
        } as any);
        if (error) {
          throw new Error(
            `Could not wire the mirror target for "${locators.find((l: any) => l.id === locId)?.name ?? locId}": ${error.message}`,
          );
        }
      }

      toast.success('Locator assignments saved');
      onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplet className="h-4 w-4 text-primary" />
            Assign Locators
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Select locators supplied by <span className="font-medium text-foreground">{meter.name ?? 'this meter'}</span>.
          Toggle <span className="font-medium">Has physical meter</span> off for derived (residual) locators.
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <span className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Loading locators…
          </div>
        ) : !locators?.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No locators in this plant yet.</p>
        ) : (
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {locators.map((l: any) => {
              const checked      = selected.has(l.id);
              const takenByOther = l.product_meter_id && l.product_meter_id !== meter.id;
              const isDer        = !!derivedMap[l.id];
              const mirror       = mirrorMap[l.id];

              return (
                <div key={l.id} className={`rounded-md border transition-colors ${
                  checked ? 'border-primary bg-primary-soft/60' : 'border-border'
                }`}>
                  <label className="flex items-center gap-2.5 p-2.5 cursor-pointer">
                    <Checkbox
                      checked={checked}
                      disabled={!!takenByOther && !checked}
                      onCheckedChange={() => toggle(l.id)}
                      className="shrink-0 h-5 w-5 sm:h-4 sm:w-4 [&]:rounded-full sm:[&]:rounded-sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{l.name}</div>
                      {takenByOther && (
                        <div className="text-2xs text-warn">
                          Assigned to another meter
                        </div>
                      )}
                    </div>
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${l.status === 'Active' ? 'bg-accent' : 'bg-muted-foreground/40'}`} />
                  </label>

                  {checked && (
                    <div className="border-t border-border/60 px-3 pb-2.5 pt-2 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium">Has physical meter</p>
                          <p className="text-2xs text-muted-foreground">
                            Turn off for derived locators (residual = mother meter − siblings)
                          </p>
                        </div>
                        <Switch
                          checked={!isDer}
                          onCheckedChange={(v) => toggleDerived(l.id, !v)}
                          aria-label="Has physical meter"
                        />
                      </div>

                      {isDer && (
                        <div className="rounded-md bg-muted/40 border border-border/60 px-2.5 py-2 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Counts as production elsewhere?
                          </p>
                          <p className="text-2xs text-muted-foreground leading-relaxed">
                            Mirror this derived value into a product meter on another plant so both plants&apos; NRW calculations remain consistent.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor="productmeters-target-plant" className="text-2xs">Target plant</Label>
                              <Select
                                value={mirror?.plantId ?? ''}
                                onValueChange={async (pid) => {
                                  setMirrorMap(prev => ({ ...prev, [l.id]: { plantId: pid, meterId: '' } }));
                                  await loadMirrorMeters(pid);
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs" id="productmeters-target-plant">
                                  <SelectValue placeholder="Select plant" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(allPlants ?? [])
                                    .filter((p: any) => p.id !== plantId)
                                    .map((p: any) => (
                                      <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label htmlFor="productmeters-target-meter" className="text-2xs">Target meter</Label>
                              <Select
                                value={mirror?.meterId ?? ''}
                                disabled={!mirror?.plantId}
                                onValueChange={(mid) =>
                                  setMirrorMap(prev => ({ ...prev, [l.id]: { ...prev[l.id], meterId: mid } }))
                                }
                              >
                                <SelectTrigger className="h-7 text-xs" id="productmeters-target-meter">
                                  <SelectValue placeholder="Select meter" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(mirrorMeters[mirror?.plantId ?? ''] ?? []).map((m: any) => (
                                    <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {derivedCount > 1 ? (
                            <p className="text-2xs text-danger">
                              ⚠ More than one locator here is marked derived — only one is allowed per product meter. Turn the others back on (&quot;Has physical meter&quot;).
                            </p>
                          ) : mirrorNeedsRepair.has(l.id) ? (
                            <p className="text-2xs text-danger">
                              ⚠ This mirror link is broken — the target meter isn&apos;t marked derived, so it&apos;s still showing an editable input and won&apos;t receive HAMAS-style
                              mirrored values. Click Save below to repair it.
                            </p>
                          ) : (
                            <p className="text-2xs text-muted-foreground">
                              ✓ Using this product meter&apos;s one allowed derived-locator slot.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || isLoading}>
            {busy && <span className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin mr-1" />}
            Save ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
