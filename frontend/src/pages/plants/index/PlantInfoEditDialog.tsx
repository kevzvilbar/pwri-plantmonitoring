import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

export function PlantInfoEditDialog({
  open, infoSaving, infoForm, onOpenChange, onFieldChange, onSave,
}: {
  open: boolean;
  infoSaving: boolean;
  infoForm: { name: string; address: string; capacity: string };
  onOpenChange: (v: boolean) => void;
  onFieldChange: (field: string, value: string) => void;
  onSave: () => void;
}) {
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onFieldChange(field, e.target.value);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !infoSaving) onOpenChange(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Plant Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="index-plant-name" className="text-xs">Plant Name</Label>
            <Input
              value={infoForm.name}
              onChange={set('name')}
              placeholder="e.g. Guizo"
              data-testid="edit-plant-name"
              id="index-plant-name"
            />
          </div>
          <div>
            <Label htmlFor="index-address" className="text-xs">Address</Label>
            <Input
              value={infoForm.address}
              onChange={set('address')}
              placeholder="e.g. Guizo, Mandaue City"
              data-testid="edit-plant-address"
              id="index-address"
            />
          </div>
          <div>
            <Label htmlFor="index-capacity-mld" className="text-xs">Capacity (MLD)</Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={infoForm.capacity}
              onChange={set('capacity')}
              placeholder="e.g. 8"
              data-testid="edit-plant-capacity"
              id="index-capacity-mld"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={infoSaving}>Cancel</Button>
          <Button onClick={onSave} disabled={infoSaving} data-testid="save-plant-info-btn">
            {infoSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
