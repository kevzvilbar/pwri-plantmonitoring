/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';

export function ReadingHistoryBulkActions({
  selectedIds, setSelectedIds, bulkDeleting, bulkDeletePending, setBulkDeletePending,
  handleSelectOne, handleSelectAll, handleBulkDelete, anyEditable,
}: any) {
  return (
    <>
      {anyEditable && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-xs font-medium text-destructive flex-1">
            {selectedIds.size} row{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          <Button size="sm" variant="destructive" className="h-7 px-3 text-xs gap-1.5"
            onClick={() => setBulkDeletePending(true)} disabled={bulkDeleting}>
            {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Delete selected
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
            onClick={() => { setSelectedIds(new Set()); setBulkDeletePending(false); }}>
            Clear
          </Button>
        </div>
      )}
    </>
  );
}
