import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface OperatorCountStepProps {
  email: string;
  operatorCount: number;
  onCountChange: (v: number) => void;
}

export function OperatorCountStep({ email, operatorCount, onCountChange }: OperatorCountStepProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground leading-relaxed">
        All operators receive password reset links and notifications at <strong>{email}</strong>.
        Each operator will have their own distinct login address and username.
      </div>
      <div>
        <Label htmlFor="operator-count">How many Operators will use this email? *</Label>
        <Input id="operator-count" type="number" min={1} max={20} value={operatorCount}
          onChange={(e) => onCountChange(Math.max(1, Math.min(20, +e.target.value)))} />
        <p className="text-xs text-muted-foreground mt-1">Maximum 20 per shared email</p>
      </div>
    </div>
  );
}
