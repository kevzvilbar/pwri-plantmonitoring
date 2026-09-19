import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { DerivedMeterOverrideDialog } from '@/components/DerivedMeterOverrideDialog';
import { ImportReadingsDialog } from '@/components/ReadingImportDialog';
import { History, RefreshCw, PencilLine, Upload, Loader2 } from 'lucide-react';
import { DerivedMeterIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import { friendlyError } from '@/lib/supabaseErrors';
import {
  insertDerivedOverrideRows, HAMAS_OVERRIDE_SCHEMA, HAMAS_OVERRIDE_TEMPLATE_ROW,
  syncDerivedLocatorMirrors,
} from '@/data/mutations/locators';
import { validateDerivedOverrideRow } from '@/lib/readingValidation';
import { toast } from 'sonner';

interface DerivedMeterPanelProps {
  locator: any;
  plantId: string;
  latestReading: any | null | undefined;
  userId: string | undefined;
  isManagerOrAdmin: boolean;
  recalcSaving: boolean;
  overrideSaving: boolean;
  overrideOpen: boolean;
  importOverrideOpen: boolean;
  reviewFlag: any;
  actorLabel: string;
  showHistory: boolean;
  onRecalcNow: () => void;
  onSaveOverride: (value: number, reason: string) => void;
  onSetShowHistory: (show: boolean) => void;
  onSetOverrideOpen: (open: boolean) => void;
  onSetImportOverrideOpen: (open: boolean) => void;
  onSaved: () => void;
}

export function DerivedMeterPanel({
  locator, plantId, latestReading, userId, isManagerOrAdmin,
  recalcSaving, overrideSaving, overrideOpen, importOverrideOpen, reviewFlag,
  actorLabel, showHistory,
  onRecalcNow, onSaveOverride,
  onSetShowHistory, onSetOverrideOpen, onSetImportOverrideOpen, onSaved,
}: DerivedMeterPanelProps) {
  const qc = useQueryClient();

  const { data: derivedReviewFlag } = useQuery({
    queryKey: ['derived-review-flag', locator.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from('locator_derived_review_flags' as any) as any)
        .select('id, date_key, flagged_at')
        .eq('locator_id', locator.id)
        .is('resolved_at', null)
        .order('flagged_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; date_key: string; flagged_at: string } | null;
    },
    enabled: !!locator.is_derived,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (!locator.is_derived) return null;

  const activeReviewFlag = derivedReviewFlag || reviewFlag;

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground break-words">{locator.name}</div>
          <span className="inline-flex items-center gap-1 text-3xs font-bold uppercase tracking-widest bg-warn-soft text-warn px-1.5 py-0.5 rounded-full shrink-0">
            <DerivedMeterIcon className="h-2.5 w-2.5" /> Derived
          </span>
        </div>
        {isManagerOrAdmin && (
          <Button variant="ghost" size="sm"
            className="h-9 w-9 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => onSetShowHistory(true)} title="View computed reading history">
            <History className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {(activeReviewFlag as any) && (
        <div className="flex items-center gap-1.5 text-xs text-warn bg-warn-soft border border-warn/40 rounded-lg px-3 py-2">
          <span className="shrink-0">⚠️</span>
          <span>
            Needs review — a sibling locator or the mother meter changed for {new Date((activeReviewFlag as any).date_key).toLocaleDateString()} since this was last computed.
          </span>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border/60 rounded-lg px-3 py-2">
        <DerivedMeterIcon className="h-3.5 w-3.5 shrink-0 text-warn" />
        <span>
          No physical meter — volume is auto-computed as mother meter minus other locators.
          {latestReading ? (
            latestReading.is_estimated === false ? (
              <> Manually overridden: <span className="font-mono-num font-medium text-foreground/80">{fmtNum(latestReading.daily_volume)} m³</span> on {new Date(latestReading.reading_datetime).toLocaleDateString()}.</>
            ) : (
              <> Last computed: <span className="font-mono-num font-medium text-foreground/80">{fmtNum(latestReading.daily_volume)} m³</span> on {new Date(latestReading.reading_datetime).toLocaleDateString()}.</>
            )
          ) : (
            <> Not yet computed — waiting on the next sweep (runs every 8h), or recalculate now below.</>
          )}
        </span>
      </div>

      {isManagerOrAdmin && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" disabled={recalcSaving} onClick={onRecalcNow}>
            {recalcSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Recalculating…</> : <><RefreshCw className="h-3.5 w-3.5" /> Recalculate now</>}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => onSetOverrideOpen(true)}>
            <PencilLine className="h-3.5 w-3.5" />
            Override
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => onSetImportOverrideOpen(true)}>
            <Upload className="h-3.5 w-3.5" />
            Import CSV
          </Button>
        </div>
      )}

      {overrideOpen && (
        <DerivedMeterOverrideDialog
          open={overrideOpen}
          onOpenChange={onSetOverrideOpen}
          locatorName={locator.name}
          currentValue={latestReading?.daily_volume ?? null}
          busy={overrideSaving}
          onConfirm={onSaveOverride}
        />
      )}
      {importOverrideOpen && (
        <ImportReadingsDialog
          title={`Bulk Override ${locator.name} from CSV`}
          module="Derived Meter Override"
          plantId={plantId}
          userId={userId ?? null}
          schemaHint={HAMAS_OVERRIDE_SCHEMA}
          templateFilename={`${locator.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_override_template.csv`}
          templateRow={HAMAS_OVERRIDE_TEMPLATE_ROW}
          validateRow={validateDerivedOverrideRow}
          insertRows={(rows, pid) => insertDerivedOverrideRows(rows, pid, locator.id, userId ?? null, actorLabel)}
          onClose={() => onSetImportOverrideOpen(false)}
          onImported={() => {
            onSetImportOverrideOpen(false);
            qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
            qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
            qc.invalidateQueries({ queryKey: ['reading-history', 'locator', locator.id] });
            onSaved();
          }}
        />
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={locator.name}
          module="locator"
          entityId={locator.id}
          plantId={plantId}
          assetMeterSerial={locator.meter_serial}
          defaultInputMode={locator.default_input_mode === 'direct' ? 'direct' : 'raw'}
          onClose={() => onSetShowHistory(false)}
        />
      )}
    </div>
  );
}

