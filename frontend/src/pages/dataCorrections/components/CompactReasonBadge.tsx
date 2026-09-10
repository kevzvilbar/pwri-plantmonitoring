import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tag, FileQuestion, Loader2, CheckCircle2 } from 'lucide-react';
import { FlaggedRow, fmtDt } from '../types';

export const QUICK_ANOMALY_REASONS = [
  { label: 'Demand Surge', icon: '⚡', text: 'Unusually high operational demand / production surge' },
  { label: 'Line Flushing / Leak', icon: '💧', text: 'Pipeline flushing / leak test conducted' },
  { label: 'Plant Downtime', icon: '🛑', text: 'Plant downtime / pump stopped during interval' },
  { label: 'Pump Maintenance', icon: '🔧', text: 'Pump or meter serviced / calibrated' },
  { label: 'Meter Rollover', icon: '🔄', text: 'Meter exceeded maximum register and rolled over' },
  { label: 'Data Entry Typo', icon: '✏️', text: 'Operator typo corrected or re-verified' },
];

export function CompactReasonBadge({
  row,
  customReason,
  onSaveReason,
}: {
  row: FlaggedRow;
  customReason: string;
  onSaveReason: (row: FlaggedRow, reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(customReason || '');
  const [saving, setSaving] = useState(false);

  const existingReason = row.anomaly_remark?.text || row.edit_reason?.text || customReason;

  const handlePresetClick = async (presetText: string) => {
    setInputVal(presetText);
    setSaving(true);
    await onSaveReason(row, presetText);
    setSaving(false);
    setOpen(false);
  };

  const handleSaveManual = async () => {
    if (!inputVal.trim()) return;
    setSaving(true);
    await onSaveReason(row, inputVal.trim());
    setSaving(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {existingReason ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors font-medium max-w-[240px] truncate cursor-pointer"
            title={`Reason: "${existingReason}" (Click to view or edit)`}
          >
            <Tag className="h-3 w-3 shrink-0 text-emerald-500" />
            <span className="truncate">Reason: "{existingReason}"</span>
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors font-medium animate-pulse cursor-pointer"
            title="Set anomaly reason (required for approval)"
          >
            <FileQuestion className="h-3 w-3 shrink-0 text-amber-500" />
            <span>Set Reason</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2.5 text-xs shadow-xl z-50" align="start">
        <div className="flex items-center justify-between pb-1 border-b border-border/50">
          <span className="font-semibold text-xs flex items-center gap-1.5 text-foreground">
            <Tag className="h-3.5 w-3.5 text-primary" />
            {existingReason ? 'Anomaly Reason' : 'Set Anomaly Reason'}
          </span>
          {row.anomaly_remark?.tier && (
            <Badge variant="outline" className="text-3xs px-1 py-0 uppercase">
              {row.anomaly_remark.tier}
            </Badge>
          )}
        </div>

        {existingReason && !saving && (
          <div className="p-2 rounded bg-muted/40 border border-border/50 text-2xs text-foreground space-y-1">
            <div className="italic">"{existingReason}"</div>
            <div className="text-3xs text-muted-foreground flex justify-between pt-1 border-t border-border/40">
              <span>{row.anomaly_remark ? 'Operator Entry Remark' : row.edit_reason ? 'Edit Audit Log' : 'Supervisor Tag'}</span>
              {row.anomaly_remark?.logged_at && <span>{fmtDt(row.anomaly_remark.logged_at)}</span>}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-3xs font-medium uppercase text-muted-foreground tracking-wider">
            {existingReason ? 'Change Reason / Quick Presets:' : 'Quick Select Preset Reason:'}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {QUICK_ANOMALY_REASONS.map(preset => (
              <button
                key={preset.label}
                type="button"
                disabled={saving}
                onClick={() => handlePresetClick(preset.text)}
                className="text-left px-2 py-1 rounded bg-muted/30 hover:bg-primary/10 hover:text-primary text-2xs transition-colors border border-border/40 truncate flex items-center gap-1 disabled:opacity-50"
              >
                <span>{preset.icon}</span>
                <span className="truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 pt-1 border-t border-border/40">
          <Input
            placeholder="Or enter custom reason…"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            className="h-7 text-xs"
            disabled={saving}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveManual();
            }}
          />
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-2xs"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 text-2xs gap-1"
              disabled={saving || !inputVal.trim() || inputVal === existingReason}
              onClick={handleSaveManual}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Save Reason
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}