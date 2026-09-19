import { Button } from '@/components/ui/button';
import { Trash2, Loader2 } from 'lucide-react';

interface PriceDeleteConfirmProps {
  p: any;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PriceDeleteConfirm({ p, deleting, onConfirm, onCancel }: PriceDeleteConfirmProps) {
  return (
    <div className="py-2 border-b last:border-0">
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-2">
        <p className="text-xs text-destructive font-medium">
          Delete <strong>{p.chemical_name}</strong> — ₱{(+p.unit_price).toFixed(2)} ({p.effective_date})?
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs flex-1 gap-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={onConfirm} disabled={deleting}>
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
