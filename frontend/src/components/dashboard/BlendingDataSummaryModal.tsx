import React from 'react';
import { Download, TableProperties, Waves } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PivotTable } from './TrendChartTables/PivotTable';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';

export interface BlendingDataSummaryModalProps {
  open: boolean;
  onClose: () => void;
  rangeLabel: string;
  dates: string[];
  entities: { id: string; label: string }[];
  pivot: Map<string, Map<string, number>>;
  total: number;
  dailyAvg: number;
  today: number;
  isFetching?: boolean;
}

export function BlendingDataSummaryModal({
  open,
  onClose,
  rangeLabel,
  dates,
  entities,
  pivot,
  total,
  dailyAvg,
  today,
  isFetching,
}: BlendingDataSummaryModalProps) {
  const handleExportCsv = () => {
    if (!dates.length || !entities.length) {
      toast.info('No blending data available to export.');
      return;
    }

    const headers = ['Date', ...entities.map((e) => `"${e.label.replace(/"/g, '""')} (m³)"`), '"Total Blending (m³)"'];
    const rows: string[] = [];

    const colSums: Record<string, number> = {};
    entities.forEach((e) => { colSums[e.id] = 0; });
    let grandTotal = 0;

    // Dates descending (newest first)
    [...dates].reverse().forEach((d) => {
      let dayTotal = 0;
      const rowVals = entities.map((e) => {
        const v = pivot.get(d)?.get(e.id) ?? 0;
        colSums[e.id] += v;
        dayTotal += v;
        return v > 0 ? v.toFixed(2) : '0.00';
      });
      grandTotal += dayTotal;
      rows.push([d, ...rowVals, dayTotal.toFixed(2)].join(','));
    });

    const totalRow = [
      '"Total"',
      ...entities.map((e) => (colSums[e.id] ?? 0).toFixed(2)),
      grandTotal.toFixed(2),
    ].join(',');

    const csvContent = [headers.join(','), ...rows, totalRow].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `blending_volume_summary_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Blending volume summary exported to CSV.');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[94vw] w-full max-h-[90vh] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid="dsm-popup-blending"
      >
        <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0 bg-card">
          <div className="flex items-center justify-between gap-3 pb-2 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                  <TableProperties className="h-4 w-4 text-primary" />
                  Data Summary — Blending Volume
                </DialogTitle>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-3xs font-medium bg-muted text-muted-foreground border border-border/60">
                  Daily audit trail · {rangeLabel}
                </span>
                {isFetching && <span className="text-2xs text-muted-foreground">Updating…</span>}
              </div>
              <p className="text-3xs text-muted-foreground">
                Verified day-level blending injection records and per-well volume deltas across the period.
              </p>
            </div>

            <div className="flex items-center gap-2 mr-8">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportCsv}
                className="h-7 px-2.5 text-2xs gap-1.5 font-semibold text-muted-foreground hover:text-foreground shadow-xs"
              >
                <Download className="h-3 w-3 text-primary" />
                <span>Export CSV</span>
              </Button>
            </div>
          </div>

          <DialogDescription className="sr-only">
            Multi-day data summary table for Blending Volume.
          </DialogDescription>

          {/* Quick Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <div className="p-2 rounded-lg bg-muted/40 border border-border/60">
              <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Today</span>
              <div className="text-xs font-mono font-bold text-foreground mt-0.5">
                {fmtNum(today, 2)} <span className="text-3xs font-sans text-muted-foreground">m³</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-muted/40 border border-border/60">
              <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Total ({dates.length}d)</span>
              <div className="text-xs font-mono font-bold text-primary mt-0.5">
                {fmtNum(total, 2)} <span className="text-3xs font-sans text-muted-foreground">m³</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-muted/40 border border-border/60">
              <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Daily Avg</span>
              <div className="text-xs font-mono font-bold text-foreground mt-0.5">
                {fmtNum(dailyAvg, 2)} <span className="text-3xs font-sans text-muted-foreground">m³</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-muted/40 border border-border/60">
              <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Blending Wells</span>
              <div className="text-xs font-mono font-bold text-foreground mt-0.5">
                {entities.length} <span className="text-3xs font-sans text-muted-foreground">active</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden min-h-0 flex flex-col bg-background">
          {entities.length > 0 ? (
            <PivotTable
              dates={dates}
              entities={entities}
              pivot={pivot}
              totalLabel="Total Blending (m³)"
              unit="m³"
              colorClass="text-kpi-ro"
              entityType="blending"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-xs text-muted-foreground">
              <Waves className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="font-medium text-foreground">No blending data recorded in this period</p>
              <p className="text-2xs text-muted-foreground mt-1 max-w-xs">
                No blending injection events are on file for {rangeLabel}.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
