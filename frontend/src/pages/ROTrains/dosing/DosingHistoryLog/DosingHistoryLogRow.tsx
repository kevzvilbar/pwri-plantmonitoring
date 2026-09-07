import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-picker';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fmtNum } from '@/lib/calculations';
import { DOSING_KEYS } from '../../../ro-trains/constants';
import { canEditEntry } from '../../../ro-trains/helpers';
import { useDosingHistoryEdit } from './useDosingHistoryEdit';
import { useDosingHistoryDelete } from './useDosingHistoryDelete';

const FIELD_LABELS: { key: string; label: string; unit: string }[] = [
  { key: 'chlorine_kg',               label: 'Chlorine',    unit: 'kg' },
  { key: 'smbs_kg',                   label: 'SMBS',        unit: 'kg' },
  { key: 'anti_scalant_l',            label: 'Anti Scalant',unit: 'L'  },
  { key: 'soda_ash_kg',               label: 'Soda Ash',    unit: 'kg' },
  { key: 'free_chlorine_reagent_pcs', label: 'Free Cl',     unit: 'pcs'},
  { key: 'product_water_free_cl_ppm', label: 'Avg Cl ppm',  unit: 'ppm'},
];

interface DosingHistoryLogRowProps {
  row: any;
  prices: Record<string, number> | undefined;
  isManager: boolean;
  activeOperatorId: string | undefined;
  plantName: (id: string) => string;
}

export function DosingHistoryLogRow({ row, prices, isManager, activeOperatorId, plantName }: DosingHistoryLogRowProps) {
  const edit = useDosingHistoryEdit(prices);
  const del  = useDosingHistoryDelete();

  const isEditing      = edit.editId === row.id;
  const isPendingDelete = del.pendingDeleteId === row.id;
  const rowCost = useMemo(() =>
    DOSING_KEYS.reduce((s, c) => s + (+row[c.key] || 0) * (prices?.[c.name] ?? 0), 0),
    [row, prices],
  );
  const canEdit = canEditEntry(row, isManager, activeOperatorId);

  return (
    <Card key={row.id} className={cn(
      'p-3 space-y-2 transition-colors',
      isEditing && 'border-primary bg-primary-soft/30',
    )}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          {isEditing ? (
            <DateTimePicker
              value={edit.editV.log_datetime}
              onChange={(val) => edit.setEditV({ ...edit.editV, log_datetime: val })}
              placeholder="Select log datetime..."
              size="sm"
              className="h-8 text-xs w-56 font-mono-num"
            />
          ) : (
            <p className="text-xs font-semibold text-foreground font-mono-num">
              {row.log_datetime ? format(new Date(row.log_datetime), 'MMM dd, yyyy  HH:mm') : '—'}
            </p>
          )}
          <p className="text-2xs text-muted-foreground">{plantName(row.plant_id)}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isEditing && (
            <span className="text-xs font-bold font-mono-num text-primary bg-primary-soft border border-primary rounded px-1.5 py-0.5">
              ₱ {fmtNum(+row.calculated_cost > 0 ? row.calculated_cost : rowCost, 2)}
            </span>
          )}

          {canEdit && !isEditing && !isPendingDelete && (
            <button
              onClick={() => edit.startEdit(row)}
              disabled={!!edit.editId || del.deleting}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              title="Edit record"
              aria-label="Edit record"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {isEditing && (
            <>
              <Button
                size="sm"
                className="h-6 px-2 text-2xs bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={edit.saveEdit}
                disabled={edit.saving}
              >
                {edit.saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Save'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-2xs"
                onClick={edit.cancelEdit}
                disabled={edit.saving}
              >
                Cancel
              </Button>
            </>
          )}

          {canEdit && !isEditing && (
            isPendingDelete ? (
              <>
                <button
                  onClick={() => del.deleteRow(row)}
                  disabled={del.deleting}
                  className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-2xs font-semibold"
                >
                  {del.deleting ? <Loader2 className="h-2.5 w-2.5 animate-spin inline" /> : 'Yes'}
                </button>
                <button
                  onClick={() => del.setPendingDeleteId(null)}
                  className="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground text-2xs"
                >
                  No
                </button>
              </>
            ) : (
              <button
                onClick={() => del.setPendingDeleteId(row.id)}
                disabled={!!edit.editId || del.deleting}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
                title="Delete record"
                aria-label="Delete record"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )
          )}
        </div>
      </div>

      {isEditing ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-border/40">
            {FIELD_LABELS.map(({ key, label, unit }) => (
              <div key={key}>
                <Label htmlFor="dosinghistorylog-field" className="text-2xs text-muted-foreground">{label}</Label>
                <div className="relative">
                  <Input
                    type="number" step="any"
                    value={edit.editV[key] ?? ''}
                    onChange={e => edit.setEditV({ ...edit.editV, [key]: e.target.value })}
                    className="h-7 text-xs pr-7"
                    placeholder="0"
                    id="dosinghistorylog-field"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground pointer-events-none">{unit}</span>
                </div>
              </div>
            ))}
          </div>
          <CorrectionReasonField
            reason={edit.editReason} onReasonChange={edit.setEditReason}
            customReason={edit.editCustomReason} onCustomReasonChange={edit.setEditCustomReason}
          />
        </>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {DOSING_KEYS.map(({ key, name, unit }) => {
            const val = +row[key] || 0;
            if (!val) return null;
            return (
              <span key={key} className="text-xs text-foreground font-mono-num">
                <span className="text-muted-foreground">{name}: </span>
                {fmtNum(val, 2)} {unit}
              </span>
            );
          })}
          {(+row.free_chlorine_reagent_pcs || 0) > 0 && (
            <span className="text-xs text-foreground font-mono-num">
              <span className="text-muted-foreground">Free Cl: </span>
              {row.free_chlorine_reagent_pcs} pcs
            </span>
          )}
          {row.product_water_free_cl_ppm != null && (
            <span className="text-xs text-foreground font-mono-num">
              <span className="text-muted-foreground">Avg ppm: </span>
              {fmtNum(+row.product_water_free_cl_ppm, 2)}
            </span>
          )}
          {DOSING_KEYS.every(({ key }) => !+row[key]) && (
            <span className="text-xs text-muted-foreground italic">No chemicals logged</span>
          )}
        </div>
      )}
    </Card>
  );
}
