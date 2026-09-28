import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Droplets, Loader2, Cylinder } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { fmtNum } from '@/lib/calculations';
import { useChemCatalog, ChemicalCatalogItem } from '@/features/ro-trains/dosing/useChemCatalog';

interface PlantDayTanksSectionProps {
  plantId: string;
  canEdit: boolean;
}

export function PlantDayTanksSection({ plantId, canEdit }: PlantDayTanksSectionProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tankName, setTankName] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [capacityL, setCapacityL] = useState('500');
  const [neatPer100L, setNeatPer100L] = useState('10');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: catData, isLoading } = useChemCatalog(plantId);
  const catalog = (catData?.catalog ?? []).filter((c) => c.category === 'process');
  const dayTanks = catData?.dayTanks ?? [];

  const handleAddTank = async () => {
    if (!plantId || !catalogId || !tankName.trim() || !neatPer100L) {
      toast.error('Tank name, chemical product, and neat concentration are required');
      return;
    }

    setSaving(true);
    try {
      const { error } = await (supabase
        .from('plant_day_tanks' as any) as any)
        .insert({
          plant_id: plantId,
          catalog_id: catalogId,
          name: tankName.trim(),
          capacity_l: capacityL ? +capacityL : null,
          neat_per_100l: +neatPer100L,
          is_active: true,
        });

      if (error) throw error;

      toast.success('Day tank added');
      setOpen(false);
      setTankName('');
      setCatalogId('');
      setCapacityL('500');
      setNeatPer100L('10');
      qc.invalidateQueries({ queryKey: ['chemical-catalog', plantId] });
    } catch (err: any) {
      toast.error(friendlyError(err) || err.message || 'Failed to add day tank');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTank = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await (supabase
        .from('plant_day_tanks' as any) as any)
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Day tank deleted');
      qc.invalidateQueries({ queryKey: ['chemical-catalog', plantId] });
    } catch (err: any) {
      toast.error(friendlyError(err) || err.message || 'Failed to delete day tank');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="pt-3 border-t border-border/40 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plant Day Tanks
          </span>
        </div>

        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-2xs gap-1">
                <Plus className="h-3 w-3" /> Add Day Tank
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Configure Plant Day Tank</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <div>
                  <Label>Tank Name</Label>
                  <Input
                    placeholder="e.g. Chlorine Day Tank 1"
                    className="mt-1"
                    value={tankName}
                    onChange={(e) => setTankName(e.target.value)}
                  />
                </div>

                <div>
                  <Label>Dosed Chemical Product</Label>
                  <Select value={catalogId} onValueChange={setCatalogId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.base_unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Tank Capacity (L)</Label>
                    <Input
                      type="number"
                      min="1"
                      placeholder="e.g. 500"
                      className="mt-1 font-mono"
                      value={capacityL}
                      onChange={(e) => setCapacityL(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Neat Base per 100 L Solution</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0.01"
                      placeholder="e.g. 10.0"
                      className="mt-1 font-mono"
                      value={neatPer100L}
                      onChange={(e) => setNeatPer100L(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-3xs text-muted-foreground">
                  When operators log a level drop from this day tank, the app uses this ratio to compute neat product consumption.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddTank} disabled={saving}>
                  {saving ? 'Adding...' : 'Save Day Tank'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <p className="text-2xs text-muted-foreground">
        Day tanks allow operators to log dosing directly via level drop (start level − end level) instead of counting containers.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 p-2 text-muted-foreground text-2xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading day tanks…
        </div>
      ) : dayTanks.length === 0 ? (
        <div className="p-3 text-center rounded-lg border border-dashed text-2xs text-muted-foreground bg-muted/20">
          No day tanks configured for this plant.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {dayTanks.map((tank) => {
            const product = catalog.find((c) => c.id === tank.catalog_id);
            return (
              <div
                key={tank.id}
                className="p-2.5 rounded-lg border bg-muted/30 flex justify-between items-center"
              >
                <div>
                  <div className="font-semibold text-foreground text-xs">{tank.name}</div>
                  <div className="text-3xs text-muted-foreground mt-0.5">
                    {product?.name ?? 'Chemical'} · {tank.capacity_l ? `${tank.capacity_l} L capacity · ` : ''}
                    <span className="font-mono font-medium text-foreground">
                      {tank.neat_per_100l} neat / 100 L
                    </span>
                  </div>
                </div>

                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteTank(tank.id)}
                    disabled={deletingId === tank.id}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
