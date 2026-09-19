import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Check, X, Loader2 } from 'lucide-react';

interface PriceEditRowProps {
  p: any;
  editV: { chemical_name: string; unit_price: string; effective_date: string };
  setEditV: (v: any) => void;
  saving: boolean;
  onSave: (id: string) => void;
  onCancel: () => void;
}

export function PriceEditRow({ p, editV, setEditV, saving, onSave, onCancel }: PriceEditRowProps) {
  return (
    <div className="py-2 border-b last:border-0 space-y-2">
      <div className="grid grid-cols-[1fr_90px_80px] gap-2 items-start">
        <Input
          className="h-7 text-xs"
          value={editV.chemical_name}
          onChange={(e) => setEditV({ ...editV, chemical_name: e.target.value })}
          placeholder="Item name"
        />
        <Input
          className="h-7 text-xs font-mono-num"
          type="number"
          step="any"
          min="0"
          value={editV.unit_price}
          onChange={(e) => setEditV({ ...editV, unit_price: e.target.value })}
          placeholder="Price"
        />
        <DatePicker
          value={editV.effective_date}
          onChange={(d) => setEditV({ ...editV, effective_date: d })}
          size="sm"
          className="h-7 text-xs"
        />
      </div>
      <div className="flex gap-1.5 justify-end">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onCancel} disabled={saving}>
          <X className="h-3 w-3" /> Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs gap-1 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => onSave(p.id)} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Save
        </Button>
      </div>
    </div>
  );
}
