import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2 } from 'lucide-react';
import { PriceEditRow } from './PriceEditRow';
import { PriceDeleteConfirm } from './PriceDeleteConfirm';
import { isFilterPriceEntry } from '@/lib/filterReplacements';

interface PriceHistoryListProps {
  data: any[];
  isLoading: boolean;
  canEdit: boolean;
  edit: ReturnType<typeof import('./useChemicalPriceEdit').useChemicalPriceEdit>;
  del: ReturnType<typeof import('./useChemicalPriceDelete').useChemicalPriceDelete>;
  onStartEdit: (p: any) => void;
  onRequestDelete: (id: string) => void;
}

export function PriceHistoryList({ data, isLoading, canEdit, edit, del, onStartEdit, onRequestDelete }: PriceHistoryListProps) {
  return (
    <>
      <div className={`grid gap-2 text-3xs uppercase tracking-wider font-semibold text-muted-foreground pb-2 border-b ${canEdit ? 'grid-cols-[1fr_100px_90px_60px]' : 'grid-cols-[1fr_110px_100px]'}`}>
        <div>Item</div>
        <div className="text-right">Price</div>
        <div className="text-right">Date</div>
        {canEdit && <div className="text-right">Actions</div>}
      </div>

      {isLoading && Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`grid gap-2 items-center py-2 border-b last:border-0 ${canEdit ? 'grid-cols-[1fr_90px_80px_56px]' : 'grid-cols-[1fr_100px_90px]'}`}>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-14 justify-self-end" />
          <Skeleton className="h-3 w-16 justify-self-end" />
          {canEdit && <Skeleton className="h-3 w-10 justify-self-end" />}
        </div>
      ))}

      {data?.map((p: any) => {
        if (edit.editId === p.id) {
          return <PriceEditRow key={p.id} p={p} editV={edit.editV} setEditV={edit.setEditV} saving={edit.saving} onSave={edit.saveEdit} onCancel={edit.cancelEdit} />;
        }
        if (del.deleteId === p.id) {
          return <PriceDeleteConfirm key={p.id} p={p} deleting={del.deleting} onConfirm={del.confirmDelete} onCancel={() => del.setDeleteId(null)} />;
        }

        const isFilter = isFilterPriceEntry(p.chemical_name);
        return (
          <div key={p.id} className={`grid gap-2 text-xs py-1.5 border-b last:border-0 items-center ${canEdit ? 'grid-cols-[1fr_90px_80px_56px]' : 'grid-cols-[1fr_100px_90px]'}`}>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{p.chemical_name}</span>
              <Badge variant="outline" className={`shrink-0 text-2xs px-1.5 py-0 font-normal ${isFilter ? 'border-warn/50 text-warn bg-warn-soft' : 'border-info/50 text-info bg-info-soft'}`}>
                {isFilter ? 'Filter' : 'Chemical'}
              </Badge>
            </span>
            <span className="font-mono-num font-semibold text-right">₱{(+p.unit_price).toFixed(2)}</span>
            <span className="text-muted-foreground font-mono-num text-right">{p.effective_date}</span>
            {canEdit && (
              <div className="flex gap-1 justify-end">
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="Edit" aria-label="Edit" onClick={() => onStartEdit(p)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" title="Delete" aria-label="Delete" onClick={() => onRequestDelete(p.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {!data?.length && !isLoading && <p className="text-xs text-muted-foreground py-2 text-center">No prices yet</p>}
    </>
  );
}
