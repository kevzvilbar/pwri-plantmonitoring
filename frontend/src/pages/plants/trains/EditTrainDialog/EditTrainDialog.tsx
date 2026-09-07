import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useTrainForm } from './useTrainForm';
import { ComponentCounts } from './ComponentCounts';
import { TypeOverrides } from './TypeOverrides';

export type EditTrainDialogProps = {
  train: any;
  plant: any;
  onClose: () => void;
};

export function EditTrainDialog({
  train,
  plant,
  onClose,
}: {
  train: any;
  plant: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const state = useTrainForm({ train, plant, onClose });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Train {train.train_number}{train.name ? ` · ${train.name}` : ''}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="traindetail-train-label-name-optional" className="text-xs">Train label / name (optional)</Label>
            <Input
              value={state.form.name}
              onChange={(e) => state.setForm({ ...state.form, name: e.target.value })}
              placeholder="e.g. North Wing"
              disabled={!state.isManager}
              data-testid="train-name-input"
            id="traindetail-train-label-name-optional"/>
          </div>

          <div>
            <Label htmlFor="traindetail-source-well-used-for-per-well-source-labels-on-d" className="text-xs">Source well <span className="text-muted-foreground font-normal">(used for "Per Well Source" labels on Dashboard)</span></Label>
            <Select
              value={state.form.well_id || '__none__'}
              onValueChange={(v) => state.setForm({ ...state.form, well_id: v === '__none__' ? '' : v })}
              disabled={!state.isManager}
            >
              <SelectTrigger data-testid="train-well-select" id="traindetail-source-well-used-for-per-well-source-labels-on-d">
                <SelectValue placeholder="— not linked —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— not linked —</SelectItem>
                {state.plantWells.map((w: { id: string; name: string }) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ComponentCounts state={state} />
          <TypeOverrides state={state} />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={state.saving}>
            {state.isManager ? 'Cancel' : 'Close'}
          </Button>
          {state.isManager && (
            <Button onClick={state.save} disabled={state.saving} data-testid="save-train-btn">
              {state.saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Save Train
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
