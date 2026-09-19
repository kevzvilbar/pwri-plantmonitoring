import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlantPicker } from '../shared/PlantPicker';
import { CIPVolumetric } from './CIPVolumetric';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { isReasonComplete } from '@/lib/correctionReasons';

import {
  useCipForm,
  useCipEdit,
  DosingAndTimeCard,
  RemarksPredictionCard,
  CipHistoryTable,
  CipEditDialog,
  CipSidebar,
  CipMobileSummary,
} from './CIPLog/index';

export function CIPLog() {
  const qc = useQueryClient();
  const { activeOperator, isManager, user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [trainId, setTrainId] = useState('');

  const handleCIPPlantChange = useCallback((p: string) => {
    setPlantId(p);
    setTrainId('');
  }, []);

  const {
    trains, cipChemicals, v, setV, setChemVal,
    totalMassKg, totalVolumeL, liveCost, formDuration,
    submit, clearForm,
    history, cipPrices, getHistoryCost, getChemType,
    selectedTrain, numVessels,
  } = useCipForm(plantId, trainId, activeOperator, qc);

  const {
    editId, setEditId, editRow, setEditRow,
    editChems, setEditChems, editStart, setEditStart, editEnd, setEditEnd,
    editRemarks, setEditRemarks, editReason, setEditReason, editCustomReason, setEditCustomReason,
    saving, pendingDeleteId, setPendingDeleteId, deleting,
    startEdit, saveEdit, deleteCipRow,
  } = useCipEdit(cipChemicals, isManager, activeOperator, qc, plantId, user);

  return (
    <div className="space-y-2.5">
      <Card className="p-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="ciplog-plant" className="text-xs text-muted-foreground">Plant</Label>
            <PlantPicker value={plantId} onChange={handleCIPPlantChange} id="ciplog-plant" />
          </div>
          <div>
            <Label htmlFor="ciplog-train" className="text-xs text-muted-foreground">Train</Label>
            <Select value={trainId} onValueChange={setTrainId}>
              <SelectTrigger id="ciplog-train"><SelectValue placeholder="Select train" /></SelectTrigger>
              <SelectContent>
                {trains?.map((t: any) => <SelectItem key={t.id} value={t.id}>Train {t.train_number}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {selectedTrain && (
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-sm font-bold">Train {selectedTrain.train_number}</span>
            <span className={cn('text-xs font-medium', selectedTrain.status === 'Running' ? 'text-accent' : selectedTrain.status === 'Maintenance' ? 'text-warn' : 'text-danger')}>
              ({selectedTrain.status === 'Running' ? 'Online - Optimal Health' : selectedTrain.status ?? ''})
            </span>
          </div>
        )}
      </Card>

      <div className="flex flex-col md:flex-row gap-2.5 items-start">
        <div className="flex-1 min-w-0 space-y-2.5">
          <DosingAndTimeCard
            cipChemicals={cipChemicals}
            chemicals={v.chemicals}
            setChemVal={setChemVal}
            start={v.start}
            setStart={val => setV({ ...v, start: val })}
            end={v.end}
            setEnd={val => setV({ ...v, end: val })}
            formDuration={formDuration}
          />
          <RemarksPredictionCard
            remarks={v.remarks}
            setRemarks={val => setV({ ...v, remarks: val })}
            comparisonPct={null}
            liveCost={liveCost}
          />
          <CIPVolumetric numVessels={numVessels} />
          <CipHistoryTable
            history={history ?? []}
            cipPrices={cipPrices}
            cipChemicals={cipChemicals}
            getHistoryCost={getHistoryCost}
            getChemType={getChemType}
            startEdit={startEdit}
            deleteCipRow={deleteCipRow}
            pendingDeleteId={pendingDeleteId}
            setPendingDeleteId={setPendingDeleteId}
            editId={editId}
            deleting={deleting}
            saving={saving}
            isManager={isManager}
            activeOperator={activeOperator}
            format={format}
            plantId={plantId}
            qc={qc}
            selectedTrain={selectedTrain}
          />
          {editId && editRow && (
            <CipEditDialog
              editId={editId}
              editRow={editRow}
              editChems={editChems}
              setEditChems={setEditChems}
              editStart={editStart}
              setEditStart={setEditStart}
              editEnd={editEnd}
              setEditEnd={setEditEnd}
              editRemarks={editRemarks}
              setEditRemarks={setEditRemarks}
              editReason={editReason}
              setEditReason={setEditReason}
              editCustomReason={editCustomReason}
              setEditCustomReason={setEditCustomReason}
              saving={saving}
              onClose={() => { setEditId(null); setEditRow(null); setEditReason(''); setEditCustomReason(''); }}
              cipChemicals={cipChemicals}
              isReasonComplete={isReasonComplete}
              saveEdit={saveEdit}
              format={format}
            />
          )}
        </div>
        <CipSidebar
          submit={() => submit(trainId)}
          clearForm={clearForm}
          liveCost={liveCost}
          totalMassKg={totalMassKg}
          totalVolumeL={totalVolumeL}
          comparisonPct={null}
        />
      </div>

      <CipMobileSummary
        submit={() => submit(trainId)}
        clearForm={clearForm}
        liveCost={liveCost}
        totalMassKg={totalMassKg}
        totalVolumeL={totalVolumeL}
        comparisonPct={null}
      />
    </div>
  );
}