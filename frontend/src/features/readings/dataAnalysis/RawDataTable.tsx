import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type RawReading } from '@/lib/regressionCorrection';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TABLES_WITHOUT_NORM_STATUS, TABLES_WITH_TIME, fmtDatetime, ENTITY_CONFIG, PAIRED_COL_TABLES } from './shared';
import { NormBadge } from './NormBadge';

// ── Raw Data Table ─────────────────────────────────────────────────────────────

export function RawDataTable({
  sourceTable, column, plantId, entityId, dateFrom, dateTo, canEdit, onEdit,
}: {
  sourceTable: string; column: string; plantId: string; entityId: string; dateFrom: string; dateTo: string;
  canEdit: boolean;
  onEdit: (reading: RawReading) => void;
}) {
  const entityCfgRT = ENTITY_CONFIG[sourceTable];
  const { data: entityRows } = useQuery({
    queryKey: ['entity-name-lookup', sourceTable],
    queryFn: async () => {
      if (!entityCfgRT) return [];
      const { data, error } = await (supabase.from(entityCfgRT.lookupTable as never) as any)
        .select(entityCfgRT.selectCols)
        .order('name');
      if (error) console.warn('[entity-name-lookup] error for', entityCfgRT.lookupTable, error.message);
      return (data ?? []) as Record<string, unknown>[];
    },
    enabled: !!entityCfgRT,
    staleTime: 60_000,
  });
  const entityLookup: Record<string, string> = Object.fromEntries(
    (entityRows ?? []).map(r => [String(r.id), entityCfgRT ? entityCfgRT.labelFn(r) : String(r.id)])
  );

  const hasNormStatus = !TABLES_WITHOUT_NORM_STATUS.has(sourceTable);

  // When viewing current_reading or previous_reading, show both columns together
  const isPairedColRT = (column === 'current_reading' || column === 'previous_reading')
    && PAIRED_COL_TABLES.has(sourceTable);
  const pairedColRT = column === 'current_reading' ? 'previous_reading' : 'current_reading';

  const { data, isLoading } = useQuery({
    queryKey: ['raw-readings', sourceTable, column, plantId, entityId, dateFrom, dateTo],
    queryFn: async () => {
      const entityCfg = ENTITY_CONFIG[sourceTable];
      const selectCols = [
        'id',
        'reading_datetime',
        column,
        isPairedColRT ? pairedColRT : null,
        hasNormStatus ? 'norm_status' : null,
        'plant_id',
        entityCfg ? entityCfg.fkColumn : null,
      ].filter(Boolean).join(',');

      let q = supabase.from(sourceTable.replace('well_readings','well_readings_clean').replace('locator_readings','locator_readings_clean') as any)
        .select(selectCols)
        .order('reading_datetime', { ascending: false })
        .limit(200);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      if (entityCfg && entityId && entityId !== 'all') q = q.eq(entityCfg.fkColumn as never, entityId);
      if (dateFrom) q = q.gte('reading_datetime', dateFrom);
      if (dateTo)   q = q.lte('reading_datetime', dateTo + 'T23:59:59');
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data || []).map((r: any) => ({ ...r, _sourceTable: sourceTable })) as RawReading[];
    },
    enabled: !!sourceTable && !!column,
  });

  // Delta: group rows by entity FK so we never diff across different trains/wells/etc.
  const deltaMap = new Map<string, number | null>();
  if (data) {
    const entityFk = ENTITY_CONFIG[sourceTable]?.fkColumn;
    if (entityFk) {
      const groups = new Map<string, RawReading[]>();
      data.forEach(row => {
        const key = String(row[entityFk] ?? '__none__');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      });
      groups.forEach(rows => {
        rows.forEach((row, i) => {
          const curr = row[column] as number | null;
          const prev = i + 1 < rows.length ? (rows[i + 1][column] as number | null) : null;
          deltaMap.set(row.id, curr != null && prev != null ? curr - prev : null);
        });
      });
    } else {
      data.forEach((row, i) => {
        const curr = row[column] as number | null;
        const prev = i + 1 < data.length ? (data[i + 1][column] as number | null) : null;
        deltaMap.set(row.id, curr != null && prev != null ? curr - prev : null);
      });
    }
  }

  if (isLoading) return (
    <div className="overflow-auto max-h-[560px] rounded border">
      <Table className="text-xs">
        <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
          <TableRow className="text-2xs uppercase tracking-wide text-muted-foreground">
            <TableHead className="whitespace-nowrap w-[88px]">Date</TableHead>
            {entityCfgRT && <TableHead className="whitespace-nowrap">{entityCfgRT.filterLabel}</TableHead>}
            <TableHead className="text-right whitespace-nowrap">{column}</TableHead>
            {isPairedColRT && <TableHead className="text-right whitespace-nowrap">{pairedColRT}</TableHead>}
            <TableHead className="text-right whitespace-nowrap">Δ Delta</TableHead>
            {hasNormStatus && <TableHead className="whitespace-nowrap">Status</TableHead>}
            {canEdit && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 10 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell className="py-1.5"><Skeleton className="h-3 w-16" /></TableCell>
              {entityCfgRT && <TableCell className="py-1.5"><Skeleton className="h-3 w-20" /></TableCell>}
              <TableCell className="py-1.5"><Skeleton className="h-3 w-14 ml-auto" /></TableCell>
              {isPairedColRT && <TableCell className="py-1.5"><Skeleton className="h-3 w-14 ml-auto" /></TableCell>}
              <TableCell className="py-1.5"><Skeleton className="h-3 w-10 ml-auto" /></TableCell>
              {hasNormStatus && <TableCell className="py-1.5"><Skeleton className="h-3 w-14" /></TableCell>}
              {canEdit && <TableCell className="py-1.5"><Skeleton className="h-3 w-3" /></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
  if (!data?.length) return <div className="py-8 text-center text-sm text-muted-foreground">No readings found for this selection.</div>;

  const showTime = TABLES_WITH_TIME.has(sourceTable);

  return (
    <div className="overflow-auto max-h-[560px] rounded border">
      <Table className="text-xs">
        <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
          <TableRow className="text-2xs uppercase tracking-wide text-muted-foreground">
            <TableHead className={cn('whitespace-nowrap', showTime ? 'w-[118px]' : 'w-[88px]')}>
              {showTime ? 'Date & Time' : 'Date'}
            </TableHead>
            {ENTITY_CONFIG[sourceTable] && <TableHead className="whitespace-nowrap">{ENTITY_CONFIG[sourceTable].filterLabel}</TableHead>}
            {/* When in paired mode show current_reading then previous_reading side by side */}
            {isPairedColRT ? (
              <>
                <TableHead className="text-right whitespace-nowrap">current_reading</TableHead>
                <TableHead className="text-right whitespace-nowrap">previous_reading</TableHead>
              </>
            ) : (
              <TableHead className="text-right whitespace-nowrap">{column}</TableHead>
            )}
            <TableHead className="text-right whitespace-nowrap">Δ Delta</TableHead>
            {hasNormStatus && <TableHead className="whitespace-nowrap">Status</TableHead>}
            {canEdit && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(row => {
            const delta = deltaMap.get(row.id) ?? null;
            const { date, time } = fmtDatetime(String(row.reading_datetime || ''), showTime);
            return (
              <TableRow key={row.id} className={cn(hasNormStatus && row.norm_status === 'erroneous' && 'bg-warn-soft/60')}>
                <TableCell className="font-mono whitespace-nowrap py-1.5">
                  {showTime ? (
                    <span className="flex flex-col leading-tight">
                      <span className="text-xs">{date}</span>
                      <span className="text-2xs text-muted-foreground">{time}</span>
                    </span>
                  ) : (
                    <span className="text-xs">{date}</span>
                  )}
                </TableCell>
                {ENTITY_CONFIG[sourceTable] && (
                  <TableCell className="text-xs text-muted-foreground font-mono py-1.5">
                    {entityLookup[row[ENTITY_CONFIG[sourceTable].fkColumn] as string] ?? <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                )}
                {/* Paired columns — current_reading then previous_reading */}
                {isPairedColRT ? (
                  <>
                    <TableCell className="text-right font-mono text-xs py-1.5">
                      {row['current_reading'] != null ? Number(row['current_reading']).toFixed(3) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs py-1.5 text-muted-foreground">
                      {row['previous_reading'] != null ? Number(row['previous_reading']).toFixed(3) : <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                  </>
                ) : (
                  <TableCell className="text-right font-mono text-xs py-1.5">
                    {row[column] != null ? Number(row[column]).toFixed(3) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                <TableCell className="text-right font-mono text-xs py-1.5">
                  {delta != null ? (
                    <span className={cn(
                      delta > 0  && 'text-primary',
                      delta < 0  && 'text-danger',
                      delta === 0 && 'text-muted-foreground',
                    )}>
                      {delta > 0 ? '+' : ''}{delta.toFixed(3)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                {hasNormStatus && <TableCell className="py-1.5"><NormBadge status={row.norm_status} /></TableCell>}
                {canEdit && (
                  <TableCell className="py-1.5">
                    <button
                      className="text-muted-foreground hover:text-primary transition-colors"
                      title="Edit raw value"
                      aria-label="Edit raw value"
                      onClick={() => onEdit(row)}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

