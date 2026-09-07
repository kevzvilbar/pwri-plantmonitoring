import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Zap } from 'lucide-react';
import { GapFillMeta } from '@/lib/gapDetection';
import { ENTITY_CONFIG } from '../shared';

interface RegressionDetailGapFillsTableProps {
  gapFillRows: any[];
  entityCfgRD: { filterLabel: string } | undefined;
  gapEntityNames: Record<string, string> | undefined;
}

export function RegressionDetailGapFillsTable({
  gapFillRows,
  entityCfgRD,
  gapEntityNames,
}: RegressionDetailGapFillsTableProps) {
  return (
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
  );
}
