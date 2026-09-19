import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type AddTrainFormData = {
  train_number: number; name: string;
  num_afm: number; num_booster_pumps: number; num_cartridge_filters: number;
  num_controllers: number; num_filter_housings: number; num_hp_pumps: number;
};

export function AddTrainDialog({ open, onOpenChange, defaultTrainNumber, onSubmit, loading,
  plantFilterType = 'Cartridge Filter', plantMediaType = 'AFM',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTrainNumber: number;
  onSubmit: (form: AddTrainFormData) => void;
  loading: boolean;
  plantFilterType?: 'Cartridge Filter' | 'Bag Filter';
  plantMediaType?: 'AFM' | 'MMF';
}) {
  const isBagFilter = plantFilterType === 'Bag Filter';

  const blank = (): AddTrainFormData => ({
    train_number: defaultTrainNumber, name: '',
    num_afm: 2, num_booster_pumps: 1, num_cartridge_filters: 1,
    num_controllers: 1,
    num_filter_housings: isBagFilter ? 0 : 1,
    num_hp_pumps: 1,
  });
  const [form, setForm] = useState<AddTrainFormData>(blank);

  useEffect(() => {
    if (open) setForm({ ...blank(), train_number: defaultTrainNumber });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTrainNumber]);

  const num = (field: keyof AddTrainFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: parseInt(e.target.value) || 0 }));

  const afmLabel = `${plantMediaType} Units`;
  const housingLabel = isBagFilter ? 'Filter Housing' : 'Cartridge Filter Housing';
  const fields: { key: keyof AddTrainFormData; label: string; hide?: boolean }[] = [
    { key: 'num_afm',               label: afmLabel         },
    { key: 'num_booster_pumps',     label: 'Booster Pumps'  },
    { key: 'num_cartridge_filters', label: housingLabel      },
    { key: 'num_controllers',       label: 'Controllers'    },
    { key: 'num_filter_housings',   label: 'Filter Housings', hide: true },
    { key: 'num_hp_pumps',          label: 'High Pressure Pumps' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add RO Train</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="trainslist-train-number">Train Number</Label>
              <Input type="number" min={1} value={form.train_number} onChange={num('train_number')} id="trainslist-train-number"/>
            </div>
            <div>
              <Label htmlFor="trainslist-name-optional">Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input placeholder="e.g. Train A" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} id="trainslist-name-optional"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {fields.filter(f => !f.hide).map(({ key, label }) => (
              <div key={key}>
                <Label htmlFor="trainslist-field">{label}</Label>
                <Input type="number" min={0} value={form[key] as number} onChange={num(key)} id="trainslist-field"/>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={loading}>
            {loading ? 'Adding…' : 'Add Train'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
