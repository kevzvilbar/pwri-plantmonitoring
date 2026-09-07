import { type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function ReasonField({
  value, onChange, testId,
}: { value: string; onChange: (v: string) => void; testId: string }) {
  const tooShort = value.length > 0 && value.trim().length < 5;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="locatordialogs-reason-min-5-chars-required-for-audit-log" className="text-xs text-muted-foreground">
        Reason <span className="text-danger">*</span>
        <span className="ml-1 text-2xs">(min 5 chars — required for audit log)</span>
      </Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Decommissioned after Q1 2026 inspection"
        maxLength={500}
        rows={2}
        data-testid={testId}
        aria-invalid={tooShort}
        className={tooShort ? 'border-danger' : ''}
      id="locatordialogs-reason-min-5-chars-required-for-audit-log"/>
      {tooShort && (
        <p className="text-2xs text-danger">
          Reason must be at least 5 characters ({value.trim().length}/5).
        </p>
      )}
    </div>
  );
}
