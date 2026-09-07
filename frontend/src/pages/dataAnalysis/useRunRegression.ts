import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { type RawReading, type CorrectionRow, runOLS } from '@/lib/regressionCorrection';
import { detectGaps } from '@/lib/gapDetection';
import { SOURCE_TABLES, TABLES_WITHOUT_NORM_STATUS, ENTITY_CONFIG, ROW_LIMIT } from './shared';

interface UseRunRegressionParams {
  sourceTable: string;
  column: string;
  plantId: string;
  entityId: string;
  dateFrom: string;
  dateTo: string;
  entityOptionsData: Record<string, unknown>[] | null | undefined;
  isAdmin: boolean;
  roles: string[];
  session: { user?: { id: string } } | null;
  refetchResults: () => void;
}

export function useRunRegression({
  sourceTable,
  column,
  plantId,
  entityId,
  dateFrom,
  dateTo,
  entityOptionsData,
  isAdmin,
  roles,
  session,
  refetchResults,
}: UseRunRegressionParams) {
  const qc = useQueryClient();

  const handleRunRegression = useCallback(async () => {
    if (!sourceTable || !column) { toast.error('Select a table and column first'); return; }
    const entityCfg = ENTITY_CONFIG[sourceTable];
    const hasNorm   = !TABLES_WITHOUT_NORM_STATUS.has(sourceTable);
    const selectCols = [
      'id', 'reading_datetime', column,
      hasNorm ? 'norm_status' : null,
      'plant_id',
      entityCfg ? entityCfg.fkColumn : null,
      (sourceTable === 'ro_train_readings') ? 'is_meter_replacement' : null,
    ].filter(Boolean).join(',');

    let q = supabase
      .from(sourceTable.replace('well_readings','well_readings_clean').replace('locator_readings','locator_readings_clean') as any)
      .select(selectCols)
      .order('reading_datetime', { ascending: true })
      .limit(ROW_LIMIT + 1);
    if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
    if (entityCfg && entityId && entityId !== 'all') q = q.eq(entityCfg.fkColumn as never, entityId);
    if (dateFrom) q = q.gte('reading_datetime', dateFrom);
    if (dateTo)   q = q.lte('reading_datetime', dateTo + 'T23:59:59');

    const { data: fetchedRows, error: readErr } = await q;
    if (readErr) throw new Error(readErr.message);

    const truncated = (fetchedRows?.length ?? 0) > ROW_LIMIT;
    const readings = truncated ? (fetchedRows as any[]).slice(0, ROW_LIMIT) : fetchedRows;

    const { corrections, stats, resetCount } = runOLS((readings || []) as unknown as RawReading[], column);

    const directModeIds = sourceTable === 'locator_readings'
      ? new Set(
          (entityOptionsData ?? [])
            .filter((r: Record<string, unknown>) => r.default_input_mode === 'direct' || Boolean(r.is_derived))
            .map((r: Record<string, unknown>) => String(r.id)),
        )
      : undefined;

    const gapFills     = detectGaps(
      (readings || []) as unknown as RawReading[],
      column,
      sourceTable,
      t => ENTITY_CONFIG[t]?.fkColumn ?? null,
      { directModeIds },
    );
    const allCorrections = [...corrections, ...gapFills];

    if (sourceTable === 'ro_train_readings') {
      const replIds = new Set(
        ((readings || []) as any[])
          .filter((r: any) => r.is_meter_replacement)
          .map((r: any) => String(r.id)),
      );
      if (replIds.size > 0) {
        corrections.forEach(c => {
          if (replIds.has(c.reading_id)) {
            const warning =
              '⚠️ Meter replacement flag is active on this row — ' +
              'permeate_meter_delta will remain 0 even after correcting the meter value. ' +
              'Uncheck the replacement flag in the Operator Log to trigger a full delta recalculation.';
            c.note = c.note ? `${warning} | ${c.note}` : warning;
          }
        });
      }
    }
    const resultId     = crypto.randomUUID();
    const outlierCount = corrections.filter(c => c.is_outlier).length;
    const userRole     = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');

    const doc = {
      id:            resultId,
      source_table:  sourceTable,
      column_name:   column,
      plant_id:      (plantId && plantId !== 'all') ? plantId : null,
      date_from:     dateFrom || null,
      date_to:       dateTo   || null,
      created_by:    session?.user?.id ?? null,
      created_role:  userRole,
      row_count:     (readings || []).length,
      truncated,
      r_squared:     stats.r_squared,
      slope:         stats.slope,
      intercept:     stats.intercept,
      corrections:   allCorrections,
      outlier_count: outlierCount,
      status:        'pending',
    };

    const { error: insertErr } = await supabase
      .from('regression_results')
      .insert(doc as any);
    if (insertErr) throw new Error(insertErr.message);

    const resetMsg = resetCount > 0 ? `, ${resetCount} reset anomaly fix(es)` : '';
    const olsMsg   = (outlierCount - resetCount) > 0 ? `, ${outlierCount - resetCount} statistical outlier(s)` : '';
    const gapMsg   = gapFills.length > 0 ? `, ${gapFills.length} gap date(s) to fill` : '';
    toast.success(`Analysis complete — ${outlierCount} anomaly(s) found${resetMsg}${olsMsg}${gapMsg}`);
    if (truncated) {
      toast.warning(
        `This date range has more than ${ROW_LIMIT.toLocaleString()} readings — the analysis only covers the earliest ${ROW_LIMIT.toLocaleString()} rows. Narrow the date range to analyze the rest.`,
        { duration: 10000 },
      );
    }
    refetchResults();
    qc.invalidateQueries({ queryKey: ['raw-readings'] });
  }, [sourceTable, column, plantId, entityId, dateFrom, dateTo, entityOptionsData, isAdmin, roles, session, refetchResults, qc]);

  return { handleRunRegression };
}
