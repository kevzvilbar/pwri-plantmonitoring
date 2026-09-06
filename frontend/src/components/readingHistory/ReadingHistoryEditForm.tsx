/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { isReasonComplete } from '@/lib/correctionReasons';

export function ReadingHistoryEditForm({
  editRow, editReason, editCustomReason, saving,
  setEditRow, setEditReason, setEditCustomReason,
  cancelEdit, saveEdit,
  module, isDirectMode, isSolarDirectMode, meterFilter, solarInputMode,
  getHistGridLabel,
  replaceReadingId, setReplaceReadingId,
  entityId, plantId, assetMeterSerial, queryKey, qc,
}: any) {
  if (!editRow) return null;

  const disabled = saving || (module === 'power' && meterFilter?.type === 'solar' ? !editRow.value2 : !editRow.value) || !isReasonComplete(editReason, editCustomReason);

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
      <p className="font-medium text-foreground">Editing reading</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="readinghistorydialog-date-amp-time" className="text-2xs">Date &amp; Time</Label>
          <Input type="datetime-local" value={editRow.datetime}
            onChange={e => setEditRow({ ...editRow, datetime: e.target.value })}
            className="h-8 text-xs" id="readinghistorydialog-date-amp-time"/>
        </div>
        {!(module === 'power' && meterFilter?.type === 'solar') && (
          <div>
            <Label htmlFor="readinghistorydialog-reading-kwh" className="text-2xs">
              {module === 'well' ? (isDirectMode ? 'Volume (m³)' : 'Water (unitless)') : module === 'locator' ? (isDirectMode ? 'Volume (m³)' : 'Reading') : module === 'blending' ? 'Reading (cumulative)' : `${meterFilter?.type === 'grid' ? getHistGridLabel(meterFilter.idx) : 'Grid'} Reading (kWh)`}
            </Label>
            <Input type="number" step="any" value={editRow.value}
              onChange={e => setEditRow({ ...editRow, value: e.target.value })}
              className="h-8 text-xs" id="readinghistorydialog-reading-kwh"/>
          </div>
        )}
        {module === 'well' && (
          <div>
            <Label htmlFor="readinghistorydialog-power-meter-kwh" className="text-2xs">Power Meter (kWh)</Label>
            <Input type="number" step="any" value={editRow.value2 ?? ''}
              onChange={e => setEditRow({ ...editRow, value2: e.target.value })}
              className="h-8 text-xs" placeholder="optional" id="readinghistorydialog-power-meter-kwh"/>
          </div>
        )}
        {module === 'well' && (
          <div>
            <Label htmlFor="readinghistorydialog-tds-ppm" className="text-2xs">TDS (ppm)</Label>
            <Input type="number" step="any" value={editRow.value4 ?? ''}
              onChange={e => setEditRow({ ...editRow, value4: e.target.value })}
              className="h-8 text-xs" placeholder="optional" id="readinghistorydialog-tds-ppm"/>
          </div>
        )}
        {module === 'well' && (
          <div>
            <Label htmlFor="readinghistorydialog-ntu" className="text-2xs">NTU</Label>
            <Input type="number" step="any" value={editRow.value6 ?? ''}
              onChange={e => setEditRow({ ...editRow, value6: e.target.value })}
              className="h-8 text-xs" placeholder="optional" id="readinghistorydialog-ntu"/>
          </div>
        )}
        {module === 'well' && (
          <div>
            <Label htmlFor="readinghistorydialog-pressure-psi" className="text-2xs">Pressure (psi)</Label>
            <Input type="number" step="any" value={editRow.value5 ?? ''}
              onChange={e => setEditRow({ ...editRow, value5: e.target.value })}
              className="h-8 text-xs" placeholder="optional" id="readinghistorydialog-pressure-psi"/>
          </div>
        )}
        {module === 'power' && meterFilter?.type === 'solar' && (
          <div>
            <Label htmlFor="readinghistorydialog-field" className="text-2xs">{isSolarDirectMode ? 'Solar Generation (kWh, direct)' : 'Solar Meter Reading (kWh)'}</Label>
            <Input type="number" step="any" value={editRow.value2 ?? ''}
              onChange={e => setEditRow({ ...editRow, value2: e.target.value })}
              className="h-8 text-xs" id="readinghistorydialog-field"/>
          </div>
        )}
      </div>
      {module !== 'power' && (
        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={!!editRow.isMeterReplacement}
            onChange={e => {
              if (e.target.checked && (module === 'well' || module === 'locator')) {
                setReplaceReadingId(editRow.id);
                return;
              }
              setEditRow({ ...editRow, isMeterReplacement: e.target.checked });
            }}
            className="h-3.5 w-3.5 accent-kpi-solar"
          />
          <span className="text-2xs text-muted-foreground">Meter replacement / PMS (zeroes Δ)</span>
        </label>
      )}
      <CorrectionReasonField
        reason={editReason} onReasonChange={setEditReason}
        customReason={editCustomReason} onCustomReasonChange={setEditCustomReason}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={saveEdit} disabled={disabled}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs px-3">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save changes'}
        </Button>
        <Button size="sm" variant="outline" onClick={cancelEdit}
          disabled={saving} className="h-7 text-xs px-3">
          Cancel
        </Button>
      </div>
    </div>
  );
}
