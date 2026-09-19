import { useState } from 'react';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DesignationCombobox,
  OPERATOR_DESIGNATION,
} from '@/components/DesignationCombobox';
import { Users, User, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const emailSchema = z.string().trim().email('Enter a valid email').max(255);
const passSchema = z.string().min(8, 'Min 8 characters').max(72);

interface DesignationStepProps {
  email: string;
  password: string;
  confirmPassword: string;
  designation: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onConfirmPasswordChange: (v: string) => void;
  onDesignationChange: (v: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
}

export function DesignationStep({
  email, password, confirmPassword, designation,
  showPassword, showConfirmPassword,
  onEmailChange, onPasswordChange, onConfirmPasswordChange, onDesignationChange,
  onTogglePassword, onToggleConfirmPassword,
}: DesignationStepProps) {
  const isOperator = designation === OPERATOR_DESIGNATION;

  const validate = () => {
    const ve = emailSchema.safeParse(email);
    if (!ve.success) { toast.error(ve.error.issues[0].message); return false; }
    const vp = passSchema.safeParse(password);
    if (!vp.success) { toast.error(vp.error.issues[0].message); return false; }
    if (password !== confirmPassword) { toast.error('Passwords do not match'); return false; }
    return true;
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="signup-email">Email *</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="user@example.com"
        />
      </div>
      <div>
        <Label htmlFor="signup-password">Password *</Label>
        <div className="relative">
          <Input
            id="signup-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="Min 8 characters"
            minLength={8}
            className="pr-10"
          />
          <button
            type="button"
            onClick={onTogglePassword}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded p-0.5"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div>
        <Label htmlFor="signup-confirm-password">Confirm password *</Label>
        <div className="relative">
          <Input
            id="signup-confirm-password"
            type={showConfirmPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            placeholder="Repeat password"
            minLength={8}
            className="pr-10"
          />
          <button
            type="button"
            onClick={onToggleConfirmPassword}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded p-0.5"
            aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
          >
            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div>
        <Label htmlFor="signup-designation">Designation *</Label>
        <DesignationCombobox id="signup-designation" value={designation} onChange={onDesignationChange} placeholder="Select designation…" data-testid="signup-designation" />
      </div>
      {designation && (
        <div className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
          isOperator ? 'bg-warn-soft border border-warn text-warn' : 'bg-info-soft border border-info text-info'
        }`}>
          {isOperator ? <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <User className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          {isOperator
            ? "Operator accounts share one email inbox. Each operator receives an individual login address routed to this email. Only one plant is allowed."
            : 'This designation uses a unique email and can be assigned to multiple plants.'}
        </div>
      )}
    </div>
  );
}
