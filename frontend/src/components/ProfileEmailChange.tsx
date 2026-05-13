// src/components/ProfileEmailChange.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Self-service email change for NON-OPERATOR users (individual email accounts).
//
// Drop this inside your Profile / Account Settings page:
//
//   import { ProfileEmailChange } from '@/components/ProfileEmailChange';
//   <ProfileEmailChange />
//
// The component reads the current user from useAuth() and determines whether
// to show the change option:
//   • Operator designation → hidden (their email is managed by an Admin)
//   • All others           → shows the "Change email" button → EmailChangeDialog
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Mail, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { EmailChangeDialog } from '@/components/EmailChangeDialog';

const OPERATOR_DESIGNATION = 'Operator'; // keep in sync with DesignationCombobox

export function ProfileEmailChange() {
  const { user, profile } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Hide entirely for Operators — their email is shared and admin-managed
  if (profile?.designation === OPERATOR_DESIGNATION) {
    return (
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
        <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Email managed by Admin</p>
          <p>Operator accounts use a shared email address. Contact your Admin to update it.</p>
        </div>
      </div>
    );
  }

  // No session yet
  if (!user?.email) return null;

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Email address</p>
            <p className="text-sm font-medium truncate">{user.email}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-8 text-xs"
          onClick={() => setDialogOpen(true)}
        >
          Change
        </Button>
      </div>

      <EmailChangeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        target={{
          mode: 'self-confirm',
          currentEmail: user.email,
        }}
        // No onSuccess needed — Supabase handles state update after link click
      />
    </>
  );
}
