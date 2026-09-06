import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ChevronLeft, Users, Eye, EyeOff } from 'lucide-react';
import { OPERATOR_DESIGNATION } from '@/components/DesignationCombobox';
import { EmailConfirmationNotice, PendingNotice } from './EmailConfirmation';
import { ForgotPasswordForm } from './PasswordResetForm';

const emailSchema = z.string().trim().email('Enter a valid email').max(255);
const passSchema  = z.string().min(8, 'Min 8 characters').max(72);

export type PickEntry = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  plant_assignments: string[];
};

function getDeviceId(): string {
  const key = 'pwri-device-id';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

async function logLoginAttempt(p: {
  emailAttempted: string;
  username?: string;
  success: boolean;
  userId?: string | null;
  plantId?: string | null;
  errorReason?: string | null;
}) {
  try {
    await supabase.from('login_attempts' as any).insert({
      email: p.emailAttempted,
      user_id: p.userId ?? null,
      username: p.username ?? null,
      plant_id: p.plantId ?? null,
      success: p.success,
      error_reason: p.errorReason ?? null,
      device_id: getDeviceId(),
      user_agent: navigator.userAgent.slice(0, 500),
    } as any);
  } catch (e) { console.warn('[Auth] login attempt audit failed:', e); }
}

export function SignInForm({
  initialEmail = '',
  notice = null,
  onClearNotice,
}: {
  initialEmail?: string;
  notice?: PendingNotice | null;
  onClearNotice?: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [view, setView] = useState<'signin' | 'forgot'>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [pickList, setPickList] = useState<PickEntry[]>([]);
  const [signedInPlantId, setSignedInPlantId] = useState<string | null>(null);
  const setActiveOperatorId = useAppStore((s) => s.setActiveOperatorId);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const ve = emailSchema.safeParse(email);
    const vp = passSchema.safeParse(password);
    if (!ve.success || !vp.success) {
      const msg = ve.error?.issues[0]?.message ?? vp.error?.issues[0]?.message ?? 'Invalid input';
      toast.error(msg);
      void logLoginAttempt({ emailAttempted: email.trim(), success: false, errorReason: `validation: ${msg}` });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      const msg = error.message.toLowerCase().includes('invalid login credentials')
        ? 'Incorrect email or password. Please check your credentials and try again.'
        : error.message;
      toast.error(msg);
      void logLoginAttempt({ emailAttempted: email.trim(), success: false, errorReason: error.message });
      return;
    }
    void logLoginAttempt({ emailAttempted: email.trim(), success: true, userId: data.user?.id ?? null });

    const { data: ownProfile } = await supabase
      .from('user_profiles')
      .select('id, username, first_name, last_name, designation, plant_assignments, status')
      .eq('id', data.user!.id)
      .maybeSingle();

    setBusy(false);

    if (ownProfile?.designation === OPERATOR_DESIGNATION) {
      const plantId = ownProfile.plant_assignments?.[0] ?? null;
      setSignedInPlantId(plantId);

      if (plantId) {
        const { data: peers } = await supabase
          .from('user_profiles')
          .select('id, username, first_name, last_name, plant_assignments')
          .eq('designation', OPERATOR_DESIGNATION)
          .eq('status', 'Active')
          .contains('plant_assignments', [plantId]);

        const list: PickEntry[] = (peers ?? []).map((p) => ({
          id: p.id,
          username: p.username ?? p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          plant_assignments: p.plant_assignments,
        }));

        if (list.length > 1) {
          setPickList(list);
          return;
        }
      }
      toast.success(`Welcome, ${ownProfile.first_name ?? ownProfile.username}!`);
      navigate('/');
      return;
    }

    navigate('/');
  };

  const handlePickUsername = (u: PickEntry) => {
    setActiveOperatorId(u.id);

    toast.success(`Now recording as ${u.first_name ?? u.username}!`);
    void logLoginAttempt({
      emailAttempted: email.trim(),
      success: true,
      username: u.username,
      plantId: signedInPlantId,
    });
    navigate('/');
  };

  if (view === 'forgot') return <ForgotPasswordForm onBack={() => setView('signin')} />;

  if (pickList.length > 0) {
    return (
      <div className="space-y-3">
        <div className="text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="font-medium text-sm">Who is signing in?</p>
          <p className="text-xs text-muted-foreground">
            Select your username — you are only shown Operators at your assigned plant.
          </p>
        </div>
        <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
          {pickList.map((u) => (
            <button
              key={u.id}
              onClick={() => handlePickUsername(u)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/60 transition-colors text-left"
            >
              <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-semibold text-sm shrink-0">
                {((u.first_name?.[0] ?? '') + (u.last_name?.[0] ?? '')).toUpperCase() || '?'}
              </div>
              <div>
                <div className="text-sm font-medium">{u.first_name} {u.last_name}</div>
                <div className="text-xs text-muted-foreground">@{u.username}</div>
              </div>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => { setPickList([]); setSignedInPlantId(null); }}>
          <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notice && <EmailConfirmationNotice notice={notice} onClearNotice={onClearNotice} />}

      <form onSubmit={handleSignIn} className="space-y-3">
        <div>
          <Label htmlFor="signin-email">Email</Label>
          <Input
            id="signin-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>
        <div>
          <Label htmlFor="signin-password">Password</Label>
          <div className="relative">
            <Input
              id="signin-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded p-0.5"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex justify-end mt-1">
            <button
              type="button"
              onClick={() => setView('forgot')}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Forgot password?
            </button>
          </div>
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
