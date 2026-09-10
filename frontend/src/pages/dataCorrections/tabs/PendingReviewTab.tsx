import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataState } from '@/components/DataState';
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2, Search } from 'lucide-react';
import { usePendingReviewActions } from './PendingReviewTab/usePendingReviewActions';
import { CorrectionRequestCard } from './PendingReviewTab/CorrectionRequestCard';
import { FlaggedReadingRow } from './PendingReviewTab/FlaggedReadingRow';
import { RecentCorrectionsPanel } from '../components/RecentCorrectionsPanel';
import { EditValueModal } from '../components/EditValueModal';
import { MarkRolloverModal } from '../components/MarkRolloverModal';
import { PENDING_FETCH_LIMIT_PER_TABLE } from '../api';

export function PendingReviewTab() {
  const {
    rows, isLoading, error, refetch, truncated,
    selected, setSelected, expanded, setExpanded,
    editRow, setEditRow, rolloverRow, setRolloverRow,
    busy, bulkBusy,
    searchQ, setSearchQ, plantFilter, setPlantFilter,
    notes, setNotes, customReasons, setCustomReasons, reqNotes, setReqNotes,
    plants, filtered, allSelected,
    toggleAll, toggleOne, invalidate, corrReqs,
    handleSaveReason, approveRequest, rejectRequest, unlockReading, resolveOne, bulkResolve, recent,
  } = usePendingReviewActions();

  if (isLoading) return <DataState loading />;
  if (error) return <DataState error={error} onRetry={refetch} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search locator or operator…" className="pl-8 h-8 text-xs" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        </div>
        <Select value={plantFilter} onValueChange={setPlantFilter}>
          <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plants</SelectItem>
            {plants.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}><RefreshCw className="h-3 w-3" /></Button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <div className="flex gap-1.5 ml-auto">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-accent/40 text-accent hover:bg-accent-soft"
              disabled={bulkBusy} onClick={() => bulkResolve('normal')}>
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Approve all
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
              disabled={bulkBusy} onClick={() => bulkResolve('retracted')}>
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Reject all
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <RecentCorrectionsPanel items={recent.items} onClear={recent.clear} />

      {corrReqs.length > 0 && (
        <div className="space-y-2.5 pb-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">
                Operator Correction Requests
              </p>
              <Badge className="h-5 px-2 text-3xs font-bold bg-amber-500 text-white animate-pulse">
                {corrReqs.length} Awaiting Approval
              </Badge>
            </div>
            <span className="text-3xs text-muted-foreground">Action required by Manager or Admin</span>
          </div>

          <div className="grid gap-3">
            {corrReqs.map(req => (
              <CorrectionRequestCard
                key={req.id}
                req={req}
                reqNotes={reqNotes}
                onReqNotesChange={setReqNotes}
                onApprove={approveRequest}
                onReject={rejectRequest}
              />
            ))}
          </div>
        </div>
      )}

      {truncated && (
        <div className="flex items-center gap-2 px-3 py-2 bg-warn-soft border border-warn/30 rounded-lg text-xs text-warn">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          One or more tables have more than {PENDING_FETCH_LIMIT_PER_TABLE.toLocaleString()} pending readings —
          showing the most recent {PENDING_FETCH_LIMIT_PER_TABLE.toLocaleString()} per table. Use the plant filter
          to narrow this down, or work through the newest ones first.
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-accent" />
          {rows.length === 0 ? 'No readings pending review — all clear.' : 'No results match the current filters.'}
        </Card>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1 pt-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">
                Flagged Field Readings (Anomaly Quarantine)
              </p>
              <Badge variant="outline" className="h-5 px-2 text-3xs font-semibold">
                {filtered.length} Quarantined
              </Badge>
            </div>
            <span className="text-3xs text-muted-foreground">Original submissions held by validation guards for supervisor review</span>
          </div>

          <div className="flex items-center gap-2 px-1">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} className="h-4 w-4" />
            <span className="text-xs text-muted-foreground">{filtered.length} reading{filtered.length !== 1 ? 's' : ''} pending</span>
          </div>

          {filtered.map(row => (
            <FlaggedReadingRow
              key={row.id}
              row={row}
              isSelected={selected.has(row.id)}
              isExpanded={expanded === row.id}
              isBusy={!!busy[row.id]}
              customReasons={customReasons}
              notes={notes}
              onToggleSelect={toggleOne}
              onToggleExpand={(id) => setExpanded(id)}
              onSaveReason={handleSaveReason}
              onNoteChange={setNotes}
              onResolve={resolveOne}
              onEdit={setEditRow}
              onRollover={setRolloverRow}
              onUnlock={unlockReading}
              onCustomReasonChange={setCustomReasons}
            />
          ))}
        </div>
      )}

      {editRow && (
        <EditValueModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onDone={(result) => {
            if (result) {
              recent.add({
                label: editRow.entity_name,
                plantName: editRow.plant_name,
                sourceTable: editRow.source_table,
                oldValue: result.oldValue,
                newValue: result.newValue,
              });
            }
            setEditRow(null);
            invalidate();
          }}
        />
      )}
      {rolloverRow && (
        <MarkRolloverModal
          row={rolloverRow}
          onClose={() => setRolloverRow(null)}
          onDone={() => { setRolloverRow(null); invalidate(); }}
        />
      )}
    </div>
  );
}
