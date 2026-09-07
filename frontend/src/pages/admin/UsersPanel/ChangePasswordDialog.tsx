import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { friendlyError } from '@/lib/supabaseErrors';
import { SETUP_SQL } from './constants';

function ChangePasswordDialog({ open, onClose, userId, userName }: {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
}) {
  const [password, setPassword]     = useState('');
  const [confirm, setConfirm]       = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [busy, setBusy]             = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [copied, setCopied]         = useState(false);

  const handleClose = () => {
    setPassword('');
    setConfirm('');
    setShowPass(false);
    setBusy(false);
    setNeedsSetup(false);
    setCopied(false);
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(SETUP_SQL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSubmit = async () => {
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirm)  { toast.error('Passwords do not match'); return; }
    setBusy(true);
    const { error } = await (supabase.rpc as any)('admin_set_user_password', {
      _user_id: userId, _new_password: password,
    });
    setBusy(false);
    if (error) {
      if (error.message.includes('function') || error.message.includes('does not exist') || error.code === 'PGRST202') {
        setNeedsSetup(true);
        return;
      }
      toast.error(friendlyError(error));
      return;
    }
    toast.success(`Password updated for ${userName}`);
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            Change password
          </DialogTitle>
        </DialogHeader>

        {needsSetup ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-warn bg-warn-soft p-3 text-xs text-warn space-y-1">
              <p className="font-semibold">One-time database setup required</p>
              <p>Run the SQL below once in your <strong>Supabase Dashboard → SQL Editor</strong>, then try again.</p>
            </div>
            <div className="relative">
              <pre className="rounded-lg border bg-muted text-2xs font-mono p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">{SETUP_SQL}</pre>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 px-2 py-1 rounded text-2xs font-medium border border-border/60 bg-background hover:bg-muted transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button onClick={() => setNeedsSetup(false)}>Try again</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Setting a new password for <span className="font-medium text-foreground">{userName}</span>
            </p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="userspanel-new-password">New password</Label>
                <div className="relative">
                  <Input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="pr-10"
                    autoFocus
                    id="userspanel-new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="userspanel-confirm-new-password">Confirm new password</Label>
                <Input
                  type={showPass ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  id="userspanel-confirm-new-password"
                />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={handleClose} disabled={busy}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={busy || !password || !confirm}>
                {busy ? 'Updating…' : 'Update password'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { ChangePasswordDialog };
