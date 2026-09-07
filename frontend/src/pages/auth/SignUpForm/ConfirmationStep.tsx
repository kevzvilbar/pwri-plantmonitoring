import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import type { OperatorEntry } from './types';

interface ConfirmationStepProps {
  isOperator: boolean;
  email: string;
  designation: string;
  operatorCount: number;
  operators: OperatorEntry[];
  plantId: string;
  plantIds: string[];
  completedIndices: Set<number>;
  plants: { id: string; name: string; address?: string }[];
  busy: boolean;
  single?: { username: string; first_name: string; last_name: string };
  onSubmit: () => void;
  onBack: () => void;
}

export function ConfirmationStep({
  isOperator, email, designation, operatorCount, operators,
  plantId, plantIds, completedIndices, plants, busy, single, onSubmit, onBack,
}: ConfirmationStepProps) {
  const label = busy
    ? 'Creating…'
    : isOperator && completedIndices.size > 0
      ? `Retry remaining ${operatorCount - completedIndices.size} account${operatorCount - completedIndices.size > 1 ? 's' : ''}`
      : `Create ${isOperator && operatorCount > 1 ? `${operatorCount} accounts` : 'account'}`;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border divide-y text-sm">
        <div className="p-3 flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{email}</span></div>
        <div className="p-3 flex justify-between"><span className="text-muted-foreground">Designation</span><Badge variant="outline">{designation}</Badge></div>
        {isOperator ? (
          <>
            <div className="p-3 flex justify-between"><span className="text-muted-foreground">Operators</span><span className="font-medium">{operatorCount}</span></div>
            <div className="p-3">
              <span className="text-muted-foreground text-xs font-medium">Operator Accounts &amp; Login Addresses</span>
              <div className="mt-1 space-y-1.5">
                {operators.slice(0, operatorCount).map((o, i) => {
                  const acctEmail = i === 0 ? email : email.replace('@', `+op${i}@`);
                  const isCompleted = completedIndices.has(i);
                  return (
                    <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/40 border">
                      <div>
                        <span className="font-semibold text-foreground">@{o.username}</span>
                        <span className="text-muted-foreground ml-1.5">— {o.first_name} {o.last_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
                        <span>{acctEmail}</span>
                        {isCompleted && <Badge className="bg-success text-success-foreground text-2xs py-0 px-1">Created</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="p-3 flex justify-between"><span className="text-muted-foreground">Plant</span><span className="font-medium">{(plants ?? []).find((p) => p.id === plantId)?.name ?? plantId}</span></div>
          </>
            ) : (
              <>
                <div className="p-3 flex justify-between"><span className="text-muted-foreground">Username</span><span className="font-medium">@{single?.username ?? ''}</span></div>
                <div className="p-3 flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{single?.first_name ?? ''} {single?.last_name ?? ''}</span></div>
            <div className="p-3"><span className="text-muted-foreground text-xs">Plants</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {plantIds.map((id) => <Badge key={id} variant="secondary" className="text-xs">{(plants ?? []).find((p) => p.id === id)?.name ?? id}</Badge>)}
              </div>
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Account{isOperator && operatorCount > 1 ? 's' : ''} will be placed in the approval queue until an Admin activates {isOperator && operatorCount > 1 ? 'them' : 'it'}.
      </p>
      <Button onClick={onSubmit} disabled={busy} className="w-full">
        {label}
      </Button>
      <Button variant="ghost" size="sm" className="w-full" onClick={onBack}>
        <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
      </Button>
    </div>
  );
}
