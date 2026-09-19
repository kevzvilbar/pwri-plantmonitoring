import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, MapPin, Gauge } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/DataState';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { ReplPill } from '@/components/readingHistory/ReplPill';
import { MeterDetailButton, EntityHistoryChart } from '../../charts/EntityHistoryChart';
import { ReplaceMeterDialog } from '../LocatorDialogs/ReplaceMeterDialog';
import { MeterReplacementDetailDialog } from '@/components/readingHistory/MeterReplacementDetailDialog';
import { normalizeReplacementRow } from '@/components/readingHistory/replacementLookup';
import { replacementToInitial } from '@/components/readingHistory/replacementEdit';
import type { NormalizedReplacement, ReplacementDetailHost } from '@/components/readingHistory/replacementTypes';

export function LocatorDetail({ locatorId, onBack }: { locatorId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [replaceOpen, setReplaceOpen] = useState(false);
  /** Option A: which logged swap the user clicked in Replacement History. */
  const [detailRec, setDetailRec] = useState<NormalizedReplacement | null>(null);
  const [editInitial, setEditInitial] = useState<any | null>(null);
  const { data: locator, isLoading, error, refetch } = useQuery({
    queryKey: ['locator', locatorId],
    queryFn: async () => {
      const { data, error } = await supabase.from('locators').select('*').eq('id', locatorId).single();
      if (error) throw error;
      return data;
    },
  });
  const { data: replacements } = useQuery({
    queryKey: ['locator-replacements', locatorId],
    queryFn: async () => (await supabase.from('locator_meter_replacements')
      .select('*, replacer:user_profiles!locator_meter_replacements_replaced_by_fkey(first_name,last_name)')
      .eq('locator_id', locatorId).order('replacement_date', { ascending: false })).data ?? [],
  });
  if (isLoading || error || !locator) return (
    <div className="p-3">
      <DataState
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        isEmpty={!isLoading && !error}
        emptyTitle="Locator not found"
        emptyDescription="This locator may have been deleted."
      />
    </div>
  );

  const hasCoords = locator.gps_lat != null && locator.gps_lng != null;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${locator.gps_lat},${locator.gps_lng}` : null;

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" /> Back to Locators
      </button>

      <Card className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-base">{locator.name}</h3>
            {locator.address && <p className="text-xs text-muted-foreground mt-0.5">{locator.address}</p>}
            {hasCoords && (
              <a href={mapsUrl!} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                <MapPin className="h-3 w-3" />
                {(+locator.gps_lat!).toFixed(5)}, {(+locator.gps_lng!).toFixed(5)}
              </a>
            )}
          </div>
          <span className={`inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${
            locator.status === 'Active'
              ? 'text-accent bg-accent-soft border-accent/30'
              : 'text-muted-foreground bg-muted border-border'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${locator.status === 'Active' ? 'bg-accent' : 'bg-muted-foreground'}`} />
            {locator.status ?? 'Active'}
          </span>
        </div>
      </Card>

      <MeterDetailButton
        label="Meter Details"
        icon={<Gauge className="h-4 w-4" />}
        fields={[
          { label: 'Brand', value: locator.meter_brand },
          { label: 'Size', value: locator.meter_size ? `${locator.meter_size} in` : null },
          { label: 'Serial No.', value: locator.meter_serial },
          { label: 'Installed', value: locator.meter_installed_date },
        ]}
      >
        <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setReplaceOpen(true)}>
          <ChangeMeterIcon className="h-3.5 w-3.5" /> Replace Meter
        </Button>
      </MeterDetailButton>

      <Card className="p-3">
        <EntityHistoryChart entityId={locatorId} entityType="locator" entityName={locator.name} defaultInputMode={locator.default_input_mode === 'direct' ? 'direct' : 'raw'} />
      </Card>

      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <ChangeMeterIcon className="h-3.5 w-3.5 text-muted-foreground" /> Replacement History
        </h4>
        {replacements?.length ? (
          <div className="space-y-0">
            {(replacements as any[]).map((r: any) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setDetailRec(normalizeReplacementRow('locator', r))}
                title="View replacement details"
                className="w-full text-left border-t py-2 text-xs grid grid-cols-2 gap-x-3 gap-y-0.5 hover:bg-muted/40 transition-colors rounded-sm px-1 -mx-1 cursor-pointer"
              >
                <div className="col-span-2 font-medium text-foreground flex items-center gap-1.5">
                  {r.replacement_date}
                  <ReplPill title="View replacement details" />
                </div>
                <div className="text-muted-foreground">Old: SN {r.old_meter_serial ?? '—'} <span className="font-mono">({r.old_meter_final_reading ?? '—'})</span></div>
                <div className="text-muted-foreground">New: SN {r.new_meter_serial ?? '—'} <span className="font-mono">({r.new_meter_initial_reading ?? '—'})</span></div>
              </button>
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">No replacements recorded</p>}
      </Card>

      <MeterReplacementDetailDialog
        host={detailRec ? ({
          target: {
            kind: 'locator',
            readingId: (detailRec.raw?.reading_id ?? null) as string | null,
            entityId: locatorId, plantId: locator.plant_id ?? null,
            entityName: locator.name, readingDatetime: detailRec.replacementDate ?? null,
          },
          settingsHref: null,
          canEdit: true,
        } satisfies ReplacementDetailHost) : null}
        records={detailRec ? [detailRec] : []}
        isLoading={false}
        onClose={() => setDetailRec(null)}
        onEdit={(rec) => {
          setDetailRec(null);
          if (rec) setEditInitial(replacementToInitial(rec));
          else setReplaceOpen(true);
        }}
      />

      {editInitial && (
        <ReplaceMeterDialog
          kind="locator" assetId={locatorId} plantId={locator.plant_id} oldSerial={locator.meter_serial}
          readingId={(editInitial.readingId ?? undefined) as string | undefined}
          initial={editInitial}
          onSuccess={() => {
            setEditInitial(null);
            qc.invalidateQueries({ queryKey: ['locator', locatorId] });
            qc.invalidateQueries({ queryKey: ['locator-replacements', locatorId] });
            qc.invalidateQueries({ queryKey: ['meter-replacement-detail'] });
          }}
          onClose={() => setEditInitial(null)}
        />
      )}

      {replaceOpen && (
        <ReplaceMeterDialog
          kind="locator" assetId={locatorId} plantId={locator.plant_id} oldSerial={locator.meter_serial}
          onClose={() => { setReplaceOpen(false); qc.invalidateQueries({ queryKey: ['locator', locatorId] }); qc.invalidateQueries({ queryKey: ['locator-replacements', locatorId] }); }}
        />
      )}
    </div>
  );
}