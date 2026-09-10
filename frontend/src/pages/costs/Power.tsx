import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';
import { BILLING_SCHEMA, BILLING_TEMPLATE_ROW } from './Power/constants';
import { validateBillingRow, insertBillingRows, type BillingFormValues } from './Power/usePowerBilling';
import { BillingForm } from './Power/BillingForm';
import { BillsList } from './Power/BillsList';
import { TariffHistory } from './Power/TariffHistory';
import { MultiplierDialog } from './Power/MultiplierDialog';
import { ImportReadingsDialog } from './ImportReadingsDialog';

export function Power() {
  const qc = useQueryClient();
  const { user, isManager, isAdmin } = useAuth();
  const canEdit = usePermission('costs', 'edit');
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');

  const [v, setV] = useState<BillingFormValues>({
    billing_month: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    period_start: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    period_end: format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    previous_reading: '', current_reading: '', multiplier: '1',
    generation_charge: '', distribution_charge: '', other_charges: '',
    total_amount: '', remarks: '', provider: '',
  });

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = subMonths(now, i);
      opts.push({ value: format(startOfMonth(d), 'yyyy-MM-dd'), label: format(d, 'MMMM yyyy') });
    }
    return opts;
  }, []);

  const totalKwh = useMemo(() => {
    if (!v.previous_reading || !v.current_reading) return null;
    return (+v.current_reading - +v.previous_reading) * (+v.multiplier || 1);
  }, [v.previous_reading, v.current_reading, v.multiplier]);

  const derivedRate = useMemo(() => {
    if (!totalKwh || totalKwh <= 0 || !v.total_amount) return null;
    return +v.total_amount / totalKwh;
  }, [totalKwh, v.total_amount]);

  const { data: bills } = useQuery({
    queryKey: ['bills', plantId],
    queryFn: async () => plantId ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false }).limit(12)).data ?? [] : [],
    enabled: !!plantId,
  });

  const { data: tariffs } = useQuery({
    queryKey: ['tariffs', plantId],
    queryFn: async () => plantId ? (await supabase.from('power_tariffs').select('*').eq('plant_id', plantId).order('effective_date', { ascending: false }).limit(12)).data ?? [] : [],
    enabled: !!plantId,
  });

  useEffect(() => {
    if (bills && bills.length > 0 && bills[0].multiplier != null) {
      setV(prev => ({ ...prev, multiplier: String(bills[0].multiplier) }));
    }
  }, [bills]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingMultiplier, setPendingMultiplier] = useState<string | null>(null);

  const handleMultiplierChange = (val: string) => {
    const prev = bills?.[0]?.multiplier;
    if (prev != null && +val !== +prev && val !== '') {
      setPendingMultiplier(val);
      setConfirmOpen(true);
    } else {
      setV({ ...v, multiplier: val });
    }
  };

  const submit = async () => {
    if (!plantId) { toast.error('Select a plant first'); return; }
    if (!v.total_amount) { toast.error('Total amount is required'); return; }
    if (totalKwh !== null && totalKwh < 0) { toast.error('Current reading is less than previous — check meter values'); return; }

    const payload: Record<string, any> = {
      plant_id: plantId,
      billing_month: v.billing_month,
      period_start: v.period_start || null,
      period_end: v.period_end || null,
      previous_reading: v.previous_reading ? +v.previous_reading : null,
      current_reading: v.current_reading ? +v.current_reading : null,
      multiplier: +v.multiplier || 1,
      generation_charge: v.generation_charge ? +v.generation_charge : null,
      distribution_charge: v.distribution_charge ? +v.distribution_charge : null,
      other_charges: v.other_charges ? +v.other_charges : null,
      total_amount: +v.total_amount,
      remarks: v.remarks || null,
      recorded_by: user?.id,
    };

    const billRes = await supabase.from('electric_bills').insert(payload as any);
    if (billRes.error) { toast.error(friendlyError(billRes.error)); return; }

    if (derivedRate) {
      await supabase.from('power_tariffs').insert({
        plant_id: plantId, effective_date: v.period_start || v.billing_month,
        rate_per_kwh: derivedRate, multiplier: +v.multiplier || 1,
        provider: v.provider || null,
        remarks: `Derived from bill ${format(parseISO(v.billing_month), 'MMM yyyy')}`,
        created_by: user?.id,
      });
    }
    toast.success(derivedRate ? 'Bill saved · tariff auto-derived' : 'Bill saved');
    setV(prev => ({ ...prev, previous_reading: '', current_reading: '', total_amount: '', generation_charge: '', distribution_charge: '', other_charges: '', remarks: '' }));
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['tariffs'] });
  };

  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="space-y-4">
      {importOpen && (
        <ImportReadingsDialog
          title="Import Power Billing from CSV"
          module="power_billing"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={BILLING_SCHEMA}
          templateFilename="power_billing_template.csv"
          templateRow={BILLING_TEMPLATE_ROW}
          validateRow={validateBillingRow}
          insertRows={(rows, pid) => insertBillingRows(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            qc.invalidateQueries({ queryKey: ['bills'] });
            qc.invalidateQueries({ queryKey: ['tariffs'] });
          }}
        />
      )}

      <div className="p-1.5 rounded-xl border border-border/50 bg-card flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
          <div className="flex-1">
            <PlantPicker value={plantId} onChange={setPlantId} id="costs-plant-3" />
          </div>
        </div>
        {plantId && (
          <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs gap-1.5 font-medium shadow-xs" onClick={() => setImportOpen(true)}>
            <UploadCloud className="h-3.5 w-3.5" />
            Import CSV
          </Button>
        )}
      </div>

      {!plantId && (
        <Card className="p-8 text-center space-y-1 rounded-xl border border-dashed shadow-none">
          <p className="text-xs font-semibold text-foreground">Select a plant</p>
          <p className="text-3xs text-muted-foreground">Choose a facility from the picker above to record power bills and inspect tariffs.</p>
        </Card>
      )}

      {plantId && (
        <>
          <BillingForm
            plantId={plantId}
            v={v}
            setV={setV}
            totalKwh={totalKwh}
            derivedRate={derivedRate}
            canEdit={canEdit}
            monthOptions={monthOptions}
            onSubmit={submit}
            onMultiplierChange={handleMultiplierChange}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <BillsList plantId={plantId} />
            <TariffHistory plantId={plantId} />
          </div>
        </>
      )}

      <MultiplierDialog
        confirmOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        currentMultiplier={v.multiplier}
        pendingMultiplier={pendingMultiplier}
        onApply={() => {
          if (pendingMultiplier !== null) setV(prev => ({ ...prev, multiplier: pendingMultiplier }));
          setPendingMultiplier(null);
          setConfirmOpen(false);
        }}
        onCancel={() => setPendingMultiplier(null)}
      />
    </div>
  );
}
