// src/components/EmailChangeDialog.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Reusable dialog for changing a user's email address.
//
// Two rendering modes controlled by the `target` prop:
//
//  • target.mode === 'admin-instant'
//    Admin is changing ANOTHER user's email (Operator or otherwise).
//    Shows a warning banner explaining the change is immediate.
//    Calls the Edge Function via useEmailChange.
//
//  • target.mode === 'self-confirm'
//    A non-operator user is changing their OWN email.
//    Shows an info banner explaining a confirmation email will be sent.
//    Calls supabase.auth.updateUser via useEmailChange.
//
// Props:
//   open          — controlled open state
//   onOpenChange  — handler to close/open
//   target        — { mode: 'admin-instant'; userId: string; currentEmail: string; displayName: string }
//                 | { mode: 'self-confirm'; currentEmail: string }
//   onSuccess     — called after a successful change (use to refresh parent data)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { z } from 'zod';
import { Mail, AlertTriangle, Info, CheckCircle2, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useEmailChange } from '@/hooks/useEmailChange';

// ─── Validators ───────────────────────────────────────────────────────────────
const emailSchema = z.string().trim().email('Enter a valid email address').max(255);

// ─── Target prop union ────────────────────────────────────────────────────────
export type EmailChangeTarget =
  | {
      mode: 'admin-instant';
      /** auth user id of the account being changed */
      userId: string;
      currentEmail: string;
      /** Human-readable name shown in the dialog, e.g. "@jdelacruz" */
      displayName: string;
    }
  | {
      mode: 'self-confirm';
      currentEmail: string;
    };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: EmailChangeTarget;
  onSuccess?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function EmailChangeDialog({ open, onOpenChange, target, onSuccess }: Props) {
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [doneImmediate, setDoneImmediate] = useState(false);

  const { changeEmail, loading, error: hookError } = useEmailChange();

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setNewEmail('');
      setConfirmEmail('');
      setValidationError(null);
      setDone(false);
      setDoneImmediate(false);
    }
  }, [open]);

  // ── Validation ──────────────────────────────────────────────────────────────
  const validate = (): boolean => {
    const parsed = emailSchema.safeParse(newEmail);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0].message);
      return false;
    }
    if (newEmail.trim().toLowerCase() === target.currentEmail.trim().toLowerCase()) {
      setValidationError('New email must be different from the current one.');
      return false;
    }
    if (newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setValidationError('Email addresses do not match.');
      return false;
    }
    setValidationError(null);
    return true;
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!validate()) return;

    const result = await changeEmail(
      target.mode === 'admin-instant'
        ? { mode: 'admin-instant', targetUserId: target.userId, newEmail }
        : { mode: 'self-confirm', newEmail },
    );

    if (result.ok) {
      setDone(true);
      setDoneImmediate(result.confirmedImmediately);
      onSuccess?.();
    }
  };

  // ── Success state ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-success" />
            </div>
            <h3 className="font-semibold text-base">
              {doneImmediate ? 'Email updated' : 'Confirmation sent'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-[260px]">
              {doneImmediate
                ? `The email address has been updated to ${newEmail.trim().toLowerCase()}. No confirmation was required.`
                : `A confirmation link has been sent to ${newEmail.trim().toLowerCase()}. The change takes effect once the link is clicked.`}
            </p>
            <Button className="w-full mt-1" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Main form ───────────────────────────────────────────────────────────────
  const isAdminMode = target.mode === 'admin-instant';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <DialogTitle className="text-base">
              {isAdminMode ? 'Change email address' : 'Update your email'}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            {isAdminMode
              ? `Editing account for ${(target as { displayName: string }).displayName}`
              : 'Enter a new email address for your account.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Current email — read only */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Current email</Label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/40 text-sm">
              <span className="truncate text-muted-foreground">{target.currentEmail}</span>
            </div>
          </div>

          {/* Mode banner */}
          {isAdminMode ? (
            <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="text-xs text-warning-foreground space-y-0.5">
                <p className="font-semibold">Immediate change — no confirmation</p>
                <p className="text-muted-foreground">
                  Because this is an Operator or admin-managed account, the email will be
                  updated instantly. The affected user will not receive a confirmation email.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex gap-2.5 rounded-lg border border-info/30 bg-info/5 p-3">
              <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <p className="font-semibold">Confirmation required</p>
                <p className="text-muted-foreground">
                  A verification link will be sent to your new email address. Your email
                  won't change until you click that link.
                </p>
              </div>
            </div>
          )}

          {/* New email input */}
          <div className="space-y-1.5">
            <Label htmlFor="new-email">New email address</Label>
            <Input
              id="new-email"
              type="email"
              placeholder="newaddress@example.com"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); setValidationError(null); }}
              disabled={loading}
              autoComplete="off"
            />
          </div>

          {/* Confirm email input */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-email">Confirm new email</Label>
            <Input
              id="confirm-email"
              type="email"
              placeholder="Repeat the new email"
              value={confirmEmail}
              onChange={(e) => { setConfirmEmail(e.target.value); setValidationError(null); }}
              disabled={loading}
              autoComplete="off"
              onPaste={(e) => e.preventDefault()} // force manual re-type
            />
            <p className="text-[11px] text-muted-foreground">Paste is disabled — type it again.</p>
          </div>

          {/* Validation / hook error */}
          {(validationError || hookError) && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {validationError ?? hookError}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !newEmail || !confirmEmail}
            className="flex-1"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Updating…
              </>
            ) : isAdminMode ? (
              'Update email'
            ) : (
              'Send confirmation'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
