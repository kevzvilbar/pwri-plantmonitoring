import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import type { OperatorEntry } from './types';

const userSchema = z.string().trim().min(2, 'Min 2 characters').max(64)
  .regex(/^[a-z0-9_.-]+$/i, 'Username: letters, numbers, _ . - only');

interface OperatorEntriesStepProps {
  email: string;
  operatorCount: number;
  operators: OperatorEntry[];
  completedIndices: Set<number>;
  onOperatorChange: (i: number, k: keyof OperatorEntry, v: string) => void;
}

export function OperatorEntriesStep({
  email, operatorCount, operators, completedIndices, onOperatorChange,
}: OperatorEntriesStepProps) {
  const updateOp = (i: number, k: keyof OperatorEntry, v: string) =>
    onOperatorChange(i, k, v);

  const handleValidate = useMemo(() => {
    return () => {
      for (let i = 0; i < operatorCount; i++) {
        const o = operators[i];
        const vu = userSchema.safeParse(o.username);
        if (!vu.success) { toast.error(`Op ${i + 1} username: ${vu.error.issues[0].message}`); return false; }
        if (!o.first_name || !o.last_name) { toast.error(`Op ${i + 1}: first and last name required`); return false; }
      }
      const unames = operators.slice(0, operatorCount).map((o) => o.username.toLowerCase());
      if (new Set(unames).size !== unames.length) { toast.error('Each operator must have a unique username'); return false; }
      return true;
    };
  }, [operators, operatorCount]);

  return { updateOp, handleValidate };
}

export function OperatorEntriesView({
  email, operatorCount, operators, completedIndices, onOperatorChange,
}: OperatorEntriesStepProps) {
  const { updateOp } = OperatorEntriesStep({
    email, operatorCount, operators, completedIndices, onOperatorChange,
  });

  return (
    <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
      <div className="rounded-lg bg-info-soft border border-info/30 p-2.5 text-xs text-info flex items-start gap-2">
        <Users className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="leading-relaxed">
          <strong>Individual Login Addresses:</strong> Operator 1 signs in using <code>{email}</code>. Additional operators use plus-aliased addresses (e.g. <code>{email.replace('@', '+op1@')}</code>) so each operator can independently reset passwords, with all notifications arriving in the shared inbox.
        </div>
      </div>

      {Array.from({ length: operatorCount }, (_, i) => {
        const acctEmail = i === 0 ? email : email.replace('@', `+op${i}@`);
        const isCompleted = completedIndices.has(i);
        return (
          <div key={i} className={`border rounded-lg p-3 space-y-2 transition-all ${isCompleted ? 'bg-muted/40 border-success/40' : ''}`}>
            <div className="flex items-center justify-between flex-wrap gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Operator {i + 1}</span>
                {isCompleted && <Badge className="bg-success text-success-foreground text-2xs py-0">✓ Account Created</Badge>}
              </div>
              <Badge variant="outline" className="text-2xs font-mono">
                Login: {acctEmail} {i === 0 ? '(Primary)' : `(Alias → ${email})`}
              </Badge>
            </div>
            <div>
              <Label className="text-xs" htmlFor={`op-${i}-username`}>Username *</Label>
              <Input
                id={`op-${i}-username`}
                autoComplete="username"
                disabled={isCompleted}
                value={operators[i]?.username ?? ''}
                onChange={(e) => updateOp(i, 'username', e.target.value)}
                placeholder="e.g. jdelacruz"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs" htmlFor={`op-${i}-first`}>First name *</Label>
                <Input
                  id={`op-${i}-first`}
                  autoComplete="given-name"
                  disabled={isCompleted}
                  value={operators[i]?.first_name ?? ''}
                  onChange={(e) => updateOp(i, 'first_name', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor={`op-${i}-last`}>Last name *</Label>
                <Input
                  id={`op-${i}-last`}
                  autoComplete="family-name"
                  disabled={isCompleted}
                  value={operators[i]?.last_name ?? ''}
                  onChange={(e) => updateOp(i, 'last_name', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor={`op-${i}-middle`}>Middle name</Label>
                <Input
                  id={`op-${i}-middle`}
                  autoComplete="additional-name"
                  disabled={isCompleted}
                  value={operators[i]?.middle_name ?? ''}
                  onChange={(e) => updateOp(i, 'middle_name', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor={`op-${i}-suffix`}>Suffix</Label>
                <Input
                  id={`op-${i}-suffix`}
                  autoComplete="honorific-suffix"
                  disabled={isCompleted}
                  value={operators[i]?.suffix ?? ''}
                  onChange={(e) => updateOp(i, 'suffix', e.target.value)}
                  placeholder="Jr., Sr.…"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
