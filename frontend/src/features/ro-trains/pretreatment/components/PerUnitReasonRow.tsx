import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function PerUnitReasonRow({
  unitLabel,
  options,
  value,
  customValue,
  onChange,
  onCustomChange,
  onApplyAll,
  applyAllLabel,
}: {
  unitLabel: string;
  options: string[];
  value?: string;
  customValue?: string;
  onChange: (val: string) => void;
  onCustomChange: (val: string) => void;
  onApplyAll?: () => void;
  applyAllLabel?: string;
}) {
  const isOther = value === 'Other';
  return (
    <div className="mt-2 pt-2 border-t border-warn/30 bg-warn-soft/50 p-2.5 rounded-lg space-y-1.5 animate-fade-in">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-2xs font-bold text-warn uppercase tracking-wider flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />
          {unitLabel} Reason for Missing Value <span className="text-danger">*</span>
        </span>
        {onApplyAll && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onApplyAll}
            className="h-5 text-3xs px-2 py-0 border-warn/40 text-warn hover:bg-warn-soft font-medium"
          >
            {applyAllLabel ?? 'Apply reason to all missing'}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Select value={value || ''} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs bg-background border-warn/40 focus:ring-warn">
            <SelectValue placeholder="Select reason for missing reading..." />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt} className="text-xs">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isOther && (
          <Input
            value={customValue ?? ''}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="Specify reason details..."
            className="h-8 text-xs bg-background border-warn/50"
          />
        )}
      </div>
    </div>
  );
}
