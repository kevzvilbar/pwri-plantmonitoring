/**
 * CorrectionReasonField.tsx
 * ══════════════════════════
 * Reusable "why was this reading changed" field — same Select +
 * CORRECTION_REASONS + conditional free-text "Other" input already used by
 * CorrectionRequestDialog.tsx and DataCorrections.tsx's EditValueModal,
 * factored out so the direct "edit an already-saved reading" dialogs (RO
 * train, pretreatment, locator, well, product, blending, power, dosing/CIP
 * logs) render an identical field instead of each hand-rolling their own.
 *
 * Callers own the `reason`/`customReason` state (so they can gate their own
 * Save button on it) and pass resolveReason(reason, customReason) from
 * correctionReasons.ts into logReadingEdit()'s `reason` param at save time.
 */
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CORRECTION_REASONS, MIN_CUSTOM_REASON_LENGTH } from '@/lib/correctionReasons';

interface Props {
  reason: string;
  onReasonChange: (value: string) => void;
  customReason: string;
  onCustomReasonChange: (value: string) => void;
  label?: string;
  className?: string;
}

export function CorrectionReasonField({
  reason, onReasonChange, customReason, onCustomReasonChange,
  label = 'Reason for this edit', className,
}: Props) {
  return (
    <div className={className ?? 'space-y-1'}>
      <label className="text-xs font-medium">{label} *</label>
      <Select value={reason} onValueChange={onReasonChange}>
        <SelectTrigger className="h-9 text-xs">
          <SelectValue placeholder="Select reason…" />
        </SelectTrigger>
        <SelectContent>
          {CORRECTION_REASONS.map((r) => (
            <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {reason === 'Other' && (
        <>
          <Input
            placeholder="Describe the reason…"
            className="h-8 text-xs mt-1"
            value={customReason}
            onChange={(e) => onCustomReasonChange(e.target.value)}
          />
          {customReason.trim().length < MIN_CUSTOM_REASON_LENGTH && (
            <p className="text-2xs text-destructive">
              {customReason.trim()
                ? `Say a bit more — at least ${MIN_CUSTOM_REASON_LENGTH} characters needed.`
                : 'Describe the reason — this is required for "Other".'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
