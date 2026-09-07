import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { recalculateTrainDeltas } from '@/pages/ro-trains/helpers';
import { type CorrectionRow } from '@/lib/regressionCorrection';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { AlertCircle } from 'lucide-react';
import { LinearRegressionChart } from './LinearRegressionChart';
import { RegressionDetailHeader } from './RegressionDetail/RegressionDetailHeader';
import { RegressionDetailStats } from './RegressionDetail/RegressionDetailStats';
import { RegressionDetailCorrectionsTable } from './RegressionDetail/RegressionDetailCorrectionsTable';
import { RegressionDetailGapFillsTable } from './RegressionDetail/RegressionDetailGapFillsTable';
import { TABLES_WITHOUT_NORM_STATUS, TABLE_LABELS, ENTITY_CONFIG, RegressionResult } from './shared';
import { GAP_FILL_PREFIX, GapFillMeta } from '@/lib/gapDetection';

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

  const gapFillRows = result.corrections.filter(c => c.reading_id.startsWith(GAP_FILL_PREFIX));
  const outliers    = result.corrections.filter(c => c.is_outlier && !c.reading_id.startsWith(GAP_FILL_PREFIX));

  const userRole = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');

  const entityCfgRD = ENTITY_CONFIG[result.source_table];

  const gapMeta: GapFillMeta | null = (() => {
    if (!gapFillRows.length) return null;
    try { return JSON.parse(gapFillRows[0].note.replace('[gap-fill] ', '')); } catch { return null; }
  })();

  const firstRealCorrId = result.corrections.find(
    c => !c.reading_id.startsWith(GAP_FILL_PREFIX),
  )?.reading_id ?? null;

  const { data: entityName } = useQuery({
    queryKey: ['reg-entity-name', result.result_id, result.source_table],
    queryFn: async (): Promise<string | null> => {
      if (!entityCfgRD) return null;

      let fkVal = gapMeta?.entity_fk_val ?? null;

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

  const { data: gapEntityNames } = useQuery({
    queryKey: ['reg-gap-entity-names', result.result_id, result.source_table],
    queryFn: async (): Promise<Record<string, string>> => {
      if (!entityCfgRD || !gapFillRows.length) return {};

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
          is_estimated: true,
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
      const { data: row, error: fetchErr } = await supabase
        .from('regression_results')
        .select('*')
        .eq('id', result.result_id)
        .maybeSingle();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? 'Result not found');
      if (row.status !== 'pending') throw new Error(`Result is '${row.status}' — can only apply pending results`);

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

      const hasNormStatus = !TABLES_WITHOUT_NORM_STATUS.has(row.source_table);

      const trainsToRecalculate = new Set<string>();

      for (const c of toApply) {
        const updatePayload: Record<string, unknown> = {
          [row.column_name]: c.corrected_value,
        };
        if (hasNormStatus) updatePayload.norm_status = 'normalized';

        await (supabase.from(row.source_table as never) as any)
          .update(updatePayload)
          .eq('id', c.reading_id);

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

      for (const tid of trainsToRecalculate) {
        await recalculateTrainDeltas(tid);
      }

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
      <RegressionDetailHeader
        result={result}
        canEdit={canEdit}
        plantName={plantName}
        entityName={entityName}
        outliers={outliers}
        gapFillRows={gapFillRows}
        gapsInserted={gapsInserted}
        applying={applying}
        retracting={retracting}
        insertingGaps={insertingGaps}
        confirmDelete={confirmDelete}
        deleting={deleting}
        expanded={expanded}
        onApply={handleApply}
        onRetract={handleRetract}
        onInsertGaps={handleInsertGaps}
        onConfirmDelete={() => setConfirmDelete(true)}
        onCancelDelete={() => setConfirmDelete(false)}
        onDelete={async () => {
          setDeleting(true);
          try {
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
            setDeleting(false);
            setConfirmDelete(false);
          }
        }}
        onToggleExpand={() => setExpanded(v => !v)}
      />

      <RegressionDetailStats result={result} outliers={outliers} gapFillRows={gapFillRows} />

      {result.truncated && (
        <div className="px-4 py-2 text-xs bg-warn-soft text-warn border-b flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          This date range has more readings than the analysis row cap — only the earliest {result.row_count.toLocaleString()} rows were analyzed. Narrow the date range to cover the rest.
        </div>
      )}

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

      {expanded && (
        <RegressionDetailCorrectionsTable
          outliers={outliers}
          canEdit={canEdit}
          result={result}
          individuallyApplied={individuallyApplied}
          applyingOne={applyingOne}
          onApplyOne={handleApplyOne}
        />
      )}

      {expanded && gapFillRows.length > 0 && (
        <RegressionDetailGapFillsTable
          gapFillRows={gapFillRows}
          entityCfgRD={entityCfgRD}
          gapEntityNames={gapEntityNames}
        />
      )}
    </div>
  );
}
