import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { recalculateTrainDeltas } from '@/pages/ro-trains/helpers';
import { type CorrectionRow } from '@/lib/regressionCorrection';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { fmtIsoDate, fmtTime } from '@/lib/format';
import { format, parseISO } from 'date-fns';
import { CheckCircle2, Undo2, TrendingUp, Database, AlertCircle, RefreshCw, ChevronDown, ChevronUp, Zap, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TABLES_WITHOUT_NORM_STATUS, TABLE_LABELS, ENTITY_CONFIG, RegressionResult, Plant } from './shared';
import { GAP_FILL_PREFIX, GapFillMeta } from '@/lib/gapDetection';
import { StatusBadge } from './StatusBadge';
import { LinearRegressionChart } from './LinearRegressionChart';

// ── Regression Results Detail ──────────────────────────────────────────────────

export function RegressionDetail({
  result, canEdit, onRefresh,
}: { result: RegressionResult; canEdit: boolean; onRefresh: () => void }) {
  const { session, isAdmin, roles } = useAuth();
  const [applying, setApplying]     = useState(false);
  const [retracting, setRetracting] = useState(false);
  const [expanded, setExpanded]     = useState(false);
  const [applyingOne, setApplyingOne]           = useState<string | null>(null);
  const [individuallyApplied, setIndividuallyApplied] = useState<Set<string>>(new Set());
  const [insertingGaps, setInsertingGaps] = useState(false);
  const [gapsInserted,  setGapsInserted]  = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // Separate gap-fill pseudo-rows from real outlier corrections
  const gapFillRows = result.corrections.filter(c => c.reading_id.startsWith(GAP_FILL_PREFIX));
  const outliers    = result.corrections.filter(c => c.is_outlier && !c.reading_id.startsWith(GAP_FILL_PREFIX));

  const userRole = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');

  // ── Entity & plant name lookups (no DB schema changes needed) ─────────────
  const entityCfgRD = ENTITY_CONFIG[result.source_table];

  // Try to pull entity FK from gap fill meta first (already encoded, free)
  const gapMeta: GapFillMeta | null = (() => {
    if (!gapFillRows.length) return null;
    try { return JSON.parse(gapFillRows[0].note.replace('[gap-fill] ', '')); } catch { return null; }
  })();

  // Fallback: reading_id of the first real (non-gap) correction row
  const firstRealCorrId = result.corrections.find(
    c => !c.reading_id.startsWith(GAP_FILL_PREFIX),
  )?.reading_id ?? null;

  /** Resolves to the display name of the entity (well / locator / meter / train) */
  const { data: entityName } = useQuery({
    queryKey: ['reg-entity-name', result.result_id, result.source_table],
    queryFn: async (): Promise<string | null> => {
      if (!entityCfgRD) return null;

      // 1. Try gap meta first (fastest — already in memory)
      let fkVal = gapMeta?.entity_fk_val ?? null;

      // 2. Fall back to fetching the FK from the source row
      if (!fkVal && firstRealCorrId) {
        const { data } = await (supabase.from(result.source_table as never) as any)
          .select(entityCfgRD.fkColumn)
          .eq('id', firstRealCorrId)
          .maybeSingle();
        fkVal = data?.[entityCfgRD.fkColumn] ? String(data[entityCfgRD.fkColumn]) : null;
      }

      if (!fkVal) return null;

      const { data: entityRow } = await (supabase.from(entityCfgRD.lookupTable as never) as any)
        .select(entityCfgRD.selectCols)
        .eq('id', fkVal)
        .maybeSingle();

      return entityRow ? entityCfgRD.labelFn(entityRow as Record<string, unknown>) : null;
    },
    enabled: !!entityCfgRD,
    staleTime: 300_000,
  });

  /** Plant display name */
  const { data: plantName } = useQuery({
    queryKey: ['reg-plant-name', result.plant_id],
    queryFn: async (): Promise<string | null> => {
      if (!result.plant_id) return null;
      const { data } = await supabase
        .from('plants')
        .select('id, name')
        .eq('id', result.plant_id)
        .maybeSingle();
      return data?.name ? String(data.name) : null;
    },
    enabled: !!result.plant_id,
    staleTime: 300_000,
  });

  /** Map of entity FK → display name for gap fill rows (may span multiple entities) */
  const { data: gapEntityNames } = useQuery({
    queryKey: ['reg-gap-entity-names', result.result_id, result.source_table],
    queryFn: async (): Promise<Record<string, string>> => {
      if (!entityCfgRD || !gapFillRows.length) return {};

      // Collect unique FK values from gap fill meta
      const fkVals = new Set<string>();
      gapFillRows.forEach(g => {
        try {
          const m: GapFillMeta = JSON.parse(g.note.replace('[gap-fill] ', ''));
          if (m.entity_fk_val) fkVals.add(m.entity_fk_val);
        } catch { /* skip */ }
      });

      if (!fkVals.size) return {};

      const { data: rows } = await (supabase.from(entityCfgRD.lookupTable as never) as any)
        .select(entityCfgRD.selectCols)
        .in('id', [...fkVals]);

      const map: Record<string, string> = {};
      (rows ?? []).forEach((r: Record<string, unknown>) => {
        map[String(r.id)] = entityCfgRD.labelFn(r);
      });
      return map;
    },
    enabled: !!entityCfgRD && gapFillRows.length > 0,
    staleTime: 300_000,
  });

  // ── Insert gap-fill rows into the source table ─────────────────────────────
  const handleInsertGaps = async () => {
    if (!gapFillRows.length) return;
    setInsertingGaps(true);
    try {
      const rows = gapFillRows.map(g => {
        const rawMeta = g.note.replace('[gap-fill] ', '');
        const meta: GapFillMeta = JSON.parse(rawMeta);
        const row: Record<string, unknown> = {
          reading_datetime: g.reading_datetime,
          [result.column_name]: g.corrected_value,
        };
        if (meta.plant_id) row.plant_id = meta.plant_id;
        if (meta.entity_fk_col && meta.entity_fk_val) {
          row[meta.entity_fk_col] = meta.entity_fk_val;
        }
        if (!TABLES_WITHOUT_NORM_STATUS.has(result.source_table)) {
          row.norm_status = 'normal';
        }
        return row;
      });

      const { data: inserted, error: insertErr } = await (supabase.from(result.source_table as never) as any)
        .insert(rows)
        .select('id');
      if (insertErr) throw new Error(insertErr.message);

      // Log each inserted row to reading_normalizations
      if (inserted?.length) {
        const normRows = (inserted as { id: string }[]).map((ins, idx) => ({
          source_table:   result.source_table,
          source_id:      ins.id,
          action:         'gap-fill',
          original_value: null,
          adjusted_value: gapFillRows[idx]?.corrected_value ?? null,
          note:           `Gap-fill interpolated (result_id=${result.result_id})`,
          performed_by:   session?.user?.id ?? null,
          performed_role: userRole,
          retractable:    false,
        }));
        await (supabase.from('reading_normalizations' as never) as any).insert(normRows);
      }

      setGapsInserted(true);
      toast.success(`${gapFillRows.length} missing date(s) inserted`);
      onRefresh();
    } catch (e: unknown) {
      toast.error(friendlyError(e));
    } finally {
      setInsertingGaps(false);
    }
  };

  // ── Apply a single correction row ──────────────────────────────────────────
  const handleApplyOne = async (correction: CorrectionRow) => {
    if (result.status === 'retracted') return;
    if (individuallyApplied.has(correction.reading_id)) return;
    setApplyingOne(correction.reading_id);
    try {
      const hasNormStatus = !TABLES_WITHOUT_NORM_STATUS.has(result.source_table);
      const updatePayload: Record<string, unknown> = { [result.column_name]: correction.corrected_value };
      if (hasNormStatus) updatePayload.norm_status = 'normalized';

      await (supabase.from(result.source_table as never) as any)
        .update(updatePayload)
        .eq('id', correction.reading_id);

      await (supabase.from('reading_normalizations' as never) as any).insert({
        source_table:   result.source_table,
        source_id:      correction.reading_id,
        action:         'normalize',
        original_value: correction.original_value,
        adjusted_value: correction.corrected_value,
        note:           correction.note || `Individual regression correction (result_id=${result.result_id})`,
        performed_by:   session?.user?.id ?? null,
        performed_role: userRole,
        retractable:    true,
      });

      setIndividuallyApplied(prev => new Set([...prev, correction.reading_id]));
      toast.success('Correction applied');
      onRefresh();
    } catch (e: unknown) {
      toast.error(friendlyError(e));
    } finally {
      setApplyingOne(null);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      // Fetch full row (corrections may be truncated in list view)
      const { data: row, error: fetchErr } = await supabase
        .from('regression_results')
        .select('*')
        .eq('id', result.result_id)
        .maybeSingle();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? 'Result not found');
      if (row.status !== 'pending') throw new Error(`Result is '${row.status}' — can only apply pending results`);

      // RACE-CONDITION FIX (D6): the status check above reads a snapshot that
      // can go stale if two admins click Apply at nearly the same time — both
      // would pass the check and both would apply corrections, doubling the
      // reading_normalizations audit rows and re-writing already-corrected
      // values. Claim the result with a conditional UPDATE (only succeeds if
      // status is still 'pending') before doing any other writes, so exactly
      // one caller proceeds even under concurrent clicks.
      const { data: claimed, error: claimErr } = await supabase
        .from('regression_results')
        .update({ status: 'applied' })
        .eq('id', result.result_id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (claimErr) throw new Error(claimErr.message);
      if (!claimed) throw new Error('This result was already applied or retracted by someone else — refresh and try again.');

      const toApply: CorrectionRow[] = ((row.corrections ?? []) as unknown as CorrectionRow[]).filter(
        (c: CorrectionRow) => c.is_outlier && c.corrected_value != null,
      );

      // Update norm_status AND write the corrected column value to the source row.
      // Previously only norm_status was set, leaving the raw (bad) value in place so
      // Dashboard / TrendChart continued to read it and show spikes.
      const hasNormStatus = !TABLES_WITHOUT_NORM_STATUS.has(row.source_table);

      // For ro_train_readings.permeate_meter corrections: collect all affected train IDs
      // so we can run a full cascade recalculation once all writes are done.
      const trainsToRecalculate = new Set<string>();

      for (const c of toApply) {
        const updatePayload: Record<string, unknown> = {
          [row.column_name]: c.corrected_value,
        };
        if (hasNormStatus) updatePayload.norm_status = 'normalized';

        await (supabase.from(row.source_table as never) as any)
          .update(updatePayload)
          .eq('id', c.reading_id);

        // Queue affected train for full delta cascade after all values are written
        if (row.source_table === 'ro_train_readings' && row.column_name === 'permeate_meter') {
          try {
            const { data: thisRow } = await (supabase.from('ro_train_readings_clean' as any) as any)
              .select('train_id')
              .eq('id', c.reading_id)
              .maybeSingle();
            if (thisRow?.train_id) trainsToRecalculate.add(String(thisRow.train_id));
          } catch { /* non-critical */ }
        }
      }

      // Full cascade delta recalculation for every affected train.
      // This handles is_meter_replacement rows (delta=0), insertions in the middle,
      // and any chain of rows whose baseline shifted due to the correction.
      for (const tid of trainsToRecalculate) {
        await recalculateTrainDeltas(tid);
      }

      // Insert reading_normalizations rows
      if (toApply.length > 0) {
        const normRows = toApply.map((c: CorrectionRow) => ({
          source_table:   row.source_table,
          source_id:      c.reading_id,
          action:         'normalize',
          original_value: c.original_value,
          adjusted_value: c.corrected_value,
          note:           c.note || `Regression correction (result_id=${result.result_id})`,
          performed_by:   session?.user?.id ?? null,
          performed_role: userRole,
          retractable:    true,
        }));
        await (supabase.from('reading_normalizations' as never) as any).insert(normRows);
      }

      // Status was already flipped to 'applied' by the atomic claim above —
      // no further status write needed here.

      toast.success(`Applied ${toApply.length} correction(s)`);
      onRefresh();
    } catch (e: unknown) {
      toast.error(friendlyError(e));
    } finally {
      setApplying(false);
    }
  };

  const handleRetract = async () => {
    setRetracting(true);
    try {
      const { data: row, error: fetchErr } = await supabase
        .from('regression_results')
        .select('*')
        .eq('id', result.result_id)
        .maybeSingle();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? 'Result not found');
      if (row.status !== 'applied') throw new Error(`Result is '${row.status}' — can only retract applied results`);

      // RACE-CONDITION FIX (D6): same compare-and-swap pattern as handleApply
      // — claim the result before doing any other writes so two concurrent
      // retract clicks can't both proceed.
      const { data: claimed, error: claimErr } = await supabase
        .from('regression_results')
        .update({ status: 'retracted' })
        .eq('id', result.result_id)
        .eq('status', 'applied')
        .select('id')
        .maybeSingle();
      if (claimErr) throw new Error(claimErr.message);
      if (!claimed) throw new Error('This result was already retracted or is no longer applied — refresh and try again.');

      const toRetract: CorrectionRow[] = ((row.corrections ?? []) as unknown as CorrectionRow[]).filter(
        (c: CorrectionRow) => c.is_outlier,
      );

      // DATA-INTEGRITY FIX (D2): retract previously only flipped norm_status
      // to 'retracted' and left the regression-corrected value permanently
      // in the source row — "retracted" implied reversibility that never
      // actually happened. Now restore original_value back onto the source
      // column, matching what was actually captured at correction time.
      const hasNormStatusR = !TABLES_WITHOUT_NORM_STATUS.has(row.source_table);
      for (const c of toRetract) {
        const restorePayload: Record<string, unknown> = {};
        if (c.original_value != null) restorePayload[row.column_name] = c.original_value;
        if (hasNormStatusR) restorePayload.norm_status = 'retracted';
        if (Object.keys(restorePayload).length === 0) continue;
        await (supabase.from(row.source_table as never) as any)
          .update(restorePayload)
          .eq('id', c.reading_id);
      }

      if (toRetract.length > 0) {
        const normRows = toRetract.map((c: CorrectionRow) => ({
          source_table:   row.source_table,
          source_id:      c.reading_id,
          action:         'retract',
          original_value: c.original_value,
          adjusted_value: null,
          note:           `Retracted regression correction (result_id=${result.result_id})`,
          performed_by:   session?.user?.id ?? null,
          performed_role: userRole,
          retractable:    false,
        }));
        await (supabase.from('reading_normalizations' as never) as any).insert(normRows);
      }

      // Status was already flipped to 'retracted' by the atomic claim above.

      toast.success(`Retracted ${toRetract.length} correction(s)`);
      onRefresh();
    } catch (e: unknown) {
      toast.error(friendlyError(e));
    } finally {
      setRetracting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex flex-col min-w-0 gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <TrendingUp className="h-4 w-4 text-primary shrink-0" />
            <span className="font-medium text-sm truncate">
              {TABLE_LABELS[result.source_table] ?? result.source_table} ·{' '}
              <span className="font-mono">{result.column_name}</span>
            </span>
            <StatusBadge status={result.status} />
          </div>
          {/* Plant + entity name subtitle */}
          {(plantName || entityName) && (
            <div className="flex items-center gap-1.5 pl-6 text-xs text-muted-foreground">
              {plantName && (
                <span className="inline-flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  {plantName}
                </span>
              )}
              {plantName && entityName && <span className="opacity-40">·</span>}
              {entityName && (
                <span className="font-medium text-foreground/70">{entityName}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && result.status === 'pending' && outliers.length > 0 && (
            <Button size="sm" onClick={handleApply} disabled={applying} className="h-7 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {applying ? 'Applying…' : `Apply (${outliers.length})`}
            </Button>
          )}
          {canEdit && gapFillRows.length > 0 && !gapsInserted && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleInsertGaps}
              disabled={insertingGaps}
              className="h-7 text-xs border-info text-info hover:bg-info-soft"
            >
              <Zap className="h-3 w-3 mr-1" />
              {insertingGaps ? 'Inserting…' : `Insert gaps (${gapFillRows.length})`}
            </Button>
          )}
          {gapsInserted && (
            <span className="inline-flex items-center gap-1 text-xs text-info font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" /> Gaps inserted
            </span>
          )}
          {canEdit && result.status === 'applied' && (
            <Button size="sm" variant="outline" onClick={handleRetract} disabled={retracting} className="h-7 text-xs">
              <Undo2 className="h-3 w-3 mr-1" />
              {retracting ? 'Retracting…' : 'Retract'}
            </Button>
          )}
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={expanded ? 'Collapse result' : 'Expand result'}
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 bg-destructive/10 border border-destructive/30 rounded-md px-2 py-1">
              <span className="text-xs text-destructive font-medium whitespace-nowrap">Delete?</span>
              <button
                className="text-xs font-semibold text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    // .select('id') so a silently-blocked delete (e.g. missing
                    // RLS permission) can be told apart from a real success —
                    // Supabase resolves a 0-row RLS block without throwing.
                    const { data, error } = await supabase
                      .from('regression_results')
                      .delete()
                      .eq('id', result.result_id)
                      .select('id');
                    if (error) throw error;
                    if (!data || data.length === 0) {
                      throw new Error('Delete was blocked — you may not have permission to delete this result.');
                    }
                    onRefresh();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to delete regression result.');
                  } finally {
                    // Always reset, success or failure, so the button never
                    // gets stuck on "Deleting…" — previously this only ran
                    // in the catch branch.
                    setDeleting(false);
                    setConfirmDelete(false);
                  }
                }}
              >
                {deleting ? 'Deleting…' : 'Yes'}
              </button>
              <span className="text-muted-foreground/50 text-xs">·</span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setConfirmDelete(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              className="text-muted-foreground hover:text-destructive transition-colors"
              title="Delete this regression result"
              aria-label="Delete this regression result"
              onClick={() => setConfirmDelete(true)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-y-2 sm:gap-y-0 divide-x-0 sm:divide-x text-center px-0 py-2 border-b">
        {(() => {
          const resetCount = outliers.filter(c => c.note?.includes('reset anomaly')).length;
          const olsCount   = outliers.length - resetCount;
          return [
            { label: 'Rows',    value: result.row_count, color: result.truncated ? 'text-warn' : '' },
            { label: 'Resets',  value: resetCount,         color: resetCount  > 0 ? 'text-kpi-solar' : '' },
            { label: 'OLS',     value: olsCount,           color: olsCount    > 0 ? 'text-warn'  : '' },
            { label: 'Gaps',    value: gapFillRows.length, color: gapFillRows.length > 0 ? 'text-info' : '' },
            { label: 'R²',      value: result.r_squared != null ? result.r_squared.toFixed(4) : '—', color: '' },
            { label: 'Run at',  value: result.created_at ? format(parseISO(result.created_at), 'MMM d HH:mm') : '—', color: '' },
          ];
        })().map(s => (
          <div key={s.label} className="px-3 py-1">
            <div className="text-2xs text-muted-foreground uppercase tracking-wide">{s.label}</div>
            <div className={cn('font-mono text-sm font-semibold', s.color)}>{s.value}</div>
          </div>
        ))}
      </div>
      {result.truncated && (
        <div className="px-4 py-2 text-xs bg-warn-soft text-warn border-b flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          This date range has more readings than the analysis row cap — only the earliest {result.row_count.toLocaleString()} rows were analyzed. Narrow the date range to cover the rest.
        </div>
      )}

      {/* Linear regression chart — always visible */}
      {result.slope != null && result.corrections.length > 0 && (
        <div className="px-3 py-2 border-b">
          <LinearRegressionChart
            corrections={result.corrections}
            slope={result.slope}
            intercept={result.intercept}
            rSquared={result.r_squared}
          />
        </div>
      )}

      {/* Corrections table (collapsible) */}
      {expanded && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Original</TableHead>
                <TableHead className="text-right">Corrected</TableHead>
                <TableHead className="text-right">Z-score</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Note</TableHead>
                {canEdit && result.status !== 'retracted' && (
                  <TableHead className="text-center w-24">Apply</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...outliers].sort((a, b) => b.reading_datetime.localeCompare(a.reading_datetime)).map(c => {
                const isReset    = c.note?.includes('reset anomaly');
                const isApplied  = individuallyApplied.has(c.reading_id) || result.status === 'applied';
                const isApplying = applyingOne === c.reading_id;
                return (
                  <TableRow key={c.reading_id} className={cn('text-xs', isReset && 'bg-kpi-solar/60')}>
                    <TableCell className="font-mono">{fmtIsoDate(c.reading_datetime)} {fmtTime(c.reading_datetime)}</TableCell>
                    <TableCell className="text-right font-mono text-danger">
                      {c.original_value?.toFixed(2) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-primary">
                      {c.corrected_value?.toFixed(2) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.z_score != null ? (
                        <span className={Math.abs(c.z_score) > 3 ? 'text-danger font-bold' : ''}>
                          {c.z_score.toFixed(2)}
                        </span>
                      ) : <span className="text-muted-foreground text-2xs">n/a</span>}
                    </TableCell>
                    <TableCell>
                      {isReset ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium border bg-kpi-solar/15 text-kpi-solar border-kpi-solar">
                          <Zap className="h-2.5 w-2.5" /> Reset
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium border bg-warn-soft text-warn border-warn">
                          OLS
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate" title={c.note}>{c.note}</TableCell>
                    {canEdit && result.status !== 'retracted' && (
                      <TableCell className="text-center">
                        {isApplied ? (
                          <span className="inline-flex items-center gap-1 text-2xs font-medium text-primary">
                            <CheckCircle2 className="h-3 w-3" /> Applied
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-2xs px-2 border-primary text-primary hover:bg-primary-soft"
                            disabled={isApplying || !!applyingOne}
                            onClick={() => handleApplyOne(c)}
                          >
                            {isApplying ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Apply'}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {outliers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit && result.status !== 'retracted' ? 7 : 6} className="text-center text-xs text-muted-foreground py-4">
                    No anomalies detected in this run.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Gap Fills table (collapsible, shown when gaps exist) */}
      {expanded && gapFillRows.length > 0 && (
        <div className="border-t">
          <div className="px-4 py-2 bg-info-soft/60 border-b flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-info" />
            <span className="text-xs font-semibold text-info">
              Missing Dates — Linear Interpolation ({gapFillRows.length} row{gapFillRows.length !== 1 ? 's' : ''})
            </span>
            <span className="text-2xs text-info/70">
              Click "Insert gaps" in the header to write these into the source table.
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Missing Date</TableHead>
                  {entityCfgRD && <TableHead>{entityCfgRD.filterLabel}</TableHead>}
                  <TableHead className="text-right">Interpolated Value</TableHead>
                  <TableHead>Boundary From</TableHead>
                  <TableHead>Boundary To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gapFillRows.map(g => {
                  let meta: GapFillMeta | null = null;
                  try { meta = JSON.parse(g.note.replace('[gap-fill] ', '')); } catch { /* skip */ }
                  const entityLabel = meta?.entity_fk_val
                    ? (gapEntityNames?.[meta.entity_fk_val] ?? meta.entity_fk_val)
                    : null;
                  return (
                    <TableRow key={g.reading_id} className="text-xs bg-info-soft/30">
                      <TableCell className="font-mono">{g.reading_datetime?.slice(0, 10)}</TableCell>
                      {entityCfgRD && (
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {entityLabel ?? <span className="opacity-40">—</span>}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono text-info font-semibold">
                        {g.corrected_value?.toFixed(3) ?? '—'}
                      </TableCell>
                      <TableCell className="text-2xs text-muted-foreground font-mono">
                        {meta ? `${meta.from_date} = ${meta.from_value}` : '—'}
                      </TableCell>
                      <TableCell className="text-2xs text-muted-foreground font-mono">
                        {meta ? `${meta.to_date} = ${meta.to_value}` : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

