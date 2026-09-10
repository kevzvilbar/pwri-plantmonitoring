import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { DataState } from '@/components/DataState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import {
  CheckCircle2, XCircle, RefreshCw, Loader2,
  ChevronDown, ChevronUp, Pencil,
} from 'lucide-react';
import { SourceTable, FlaggedRow, tableLabel, fmtNum, fmtDt, pickDisplayRole } from '../types';
import { supersedeOtherCorrectionRequests } from '../api';
import { fetchCorrectionInbox } from '@/data/queries/corrections';
import { DeltaBadge } from '../components/DeltaBadge';
import { ChainContext } from '../components/ChainContext';
import { RecentCorrectionsPanel, useRecentCorrections } from '../components/RecentCorrectionsPanel';
import { EditValueModal } from '../components/EditValueModal';

export function CorrectionInboxTab() {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const qc = useQueryClient();
  const [editRow, setEditRow] = useState<FlaggedRow | null>(null);
  const [plantFilter, setPlantFilter] = useState('all');
  const [tableFilter, setTableFilter] = useState<'all' | SourceTable>('all');
  const recent = useRecentCorrections();

  const { data: allRows = [], isLoading, error, refetch } = useQuery({
    queryKey: ['correction-inbox', tableFilter],
    queryFn: () => fetchCorrectionInbox(tableFilter === 'all' ? undefined : tableFilter),
    staleTime: 60_000,
  });

  const plants = useMemo(() => [...new Set(allRows.map(r => r.plant_name))].sort(), [allRows]);
  const rows = useMemo(() => {
    if (plantFilter === 'all') return allRows;
    return allRows.filter(r => r.plant_name === plantFilter);
  }, [allRows, plantFilter]);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const retractOne = async (row: FlaggedRow) => {
    setBusy(p => ({ ...p, [row.id]: true }));
    try {
      if (row.source_table === 'locator_readings') {
        const { error } = await supabase.from('locator_readings').update({ norm_status: 'retracted' }).eq('id', row.id);
        if (error) throw error;
      } else if (row.source_table === 'well_readings') {
        const { error } = await supabase.from('well_readings').update({ norm_status: 'retracted' }).eq('id', row.id);
        if (error) throw error;
      } else if (row.source_table === 'product_meter_readings') {
        const { error } = await supabase.from('product_meter_readings').update({ norm_status: 'retracted' }).eq('id', row.id);
        if (error) throw error;
      }

      const { error: normError } = await supabase.from('reading_normalizations').insert({
        source_table: row.source_table,
        source_id: row.id,
        action: 'retract',
        original_value: row.current_reading,
        note: 'Retracted from correction inbox',
        performed_by: user?.id ?? null,
        performed_role: actorRole,
      });
      if (normError) throw normError;

      await supersedeOtherCorrectionRequests(
        row.source_table,
        row.id,
        user?.id,
        'Superseded — reading retracted directly from Correction Inbox',
      );
      toast.success(`${row.entity_name}: retracted`);
      qc.invalidateQueries({ queryKey: ['correction-inbox'] });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(p => ({ ...p, [row.id]: false }));
    }
  };

  const markReplacement = async (row: FlaggedRow) => {
    setBusy(p => ({ ...p, [row.id]: true }));
    try {
      if (row.source_table === 'locator_readings') {
        const { error } = await supabase.from('locator_readings').update({ is_meter_replacement: true, norm_status: 'normalized' }).eq('id', row.id);
        if (error) throw error;
      } else if (row.source_table === 'well_readings') {
        const { error } = await supabase.from('well_readings').update({ is_meter_replacement: true, norm_status: 'normalized' }).eq('id', row.id);
        if (error) throw error;
      } else if (row.source_table === 'product_meter_readings') {
        const { error } = await supabase.from('product_meter_readings').update({ is_meter_replacement: true, norm_status: 'normalized' }).eq('id', row.id);
        if (error) throw error;
      }
      toast.success(`${row.entity_name}: marked as meter replacement`);
      qc.invalidateQueries({ queryKey: ['correction-inbox'] });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(p => ({ ...p, [row.id]: false }));
    }
  };

  if (isLoading) return <DataState loading />;
  if (error) return <DataState error={error} onRetry={refetch} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={plantFilter} onValueChange={setPlantFilter}>
          <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue placeholder="All plants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plants</SelectItem>
            {plants.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={tableFilter} onValueChange={v => setTableFilter(v as any)}>
          <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="locator_readings">Locator</SelectItem>
            <SelectItem value="well_readings">Well</SelectItem>
            <SelectItem value="product_meter_readings">Product Meter</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}><RefreshCw className="h-3 w-3" /></Button>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} active backward readings</span>
      </div>

      <RecentCorrectionsPanel items={recent.items} onClear={recent.clear} />

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-accent" />
          No active backward readings — inbox clear.
        </Card>
      ) : rows.map(row => {
        const isBusy = busy[row.id] ?? false;
        const isExp = expanded === row.id;
        return (
          <Card key={row.id} className="p-4 border-destructive/20">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium">{row.entity_name}</span>
                    <Badge variant="outline" className="text-2xs px-1.5 py-0">{row.plant_name}</Badge>
                    <Badge variant="outline" className="text-2xs px-1.5 py-0">{tableLabel[row.source_table]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{fmtDt(row.reading_datetime)} · Submitted by <span className="font-medium text-foreground">{row.operator_username ?? '—'}</span></div>
                </div>
                <button onClick={() => setExpanded(isExp ? null : row.id)} aria-label={isExp ? 'Collapse details' : 'Expand details'} className="text-muted-foreground hover:text-foreground p-0.5">
                  {isExp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div><div className="text-muted-foreground">Previous</div><div className="font-mono font-medium">{fmtNum(row.previous_reading)}</div></div>
                <div><div className="text-muted-foreground">Current</div><div className="font-mono font-medium">{fmtNum(row.current_reading)}</div></div>
                <div><div className="text-muted-foreground">Delta</div><DeltaBadge vol={row.daily_volume} /></div>
              </div>
              {isExp && <ChainContext focusedId={row.id} sourceTable={row.source_table} entityId={row.id} plantId="" />}
              <div className="flex gap-1.5 flex-wrap">
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={isBusy} onClick={() => setEditRow(row)}>
                  <Pencil className="h-3 w-3" />Edit value
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-warn border-warn/40" disabled={isBusy} onClick={() => markReplacement(row)}>
                  Mark as meter replacement
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-destructive border-destructive/30" disabled={isBusy} onClick={() => retractOne(row)}>
                  {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}Retract
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
      {editRow && (
        <EditValueModal row={editRow} onClose={() => setEditRow(null)}
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
            qc.invalidateQueries({ queryKey: ['correction-inbox'] });
          }} />
      )}
    </div>
  );
}