import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Droplets } from 'lucide-react';

const emailSchema = z.string().trim().email('Enter a valid email').max(255);
const passSchema = z.string().min(8, 'Min 8 characters').max(72);

export default function Auth() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  if (user) return <Navigate to="/" replace />;

  const logLoginAttempt = async (params: {
    emailAttempted: string;
    success: boolean;
    userId?: string | null;
    errorReason?: string | null;
  }) => {
    try {
      await supabase.from('login_attempts' as any).insert({
        email: params.emailAttempted,
        user_id: params.userId ?? null,
        success: params.success,
        error_reason: params.errorReason ?? null,
        user_agent: navigator.userAgent.slice(0, 500),
      } as any);
    } catch {
      // Best-effort — never block the user if the audit table isn't ready
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = emailSchema.safeParse(email); const v2 = passSchema.safeParse(password);
    if (!v.success || !v2.success) {
      const msg = v.error?.issues[0]?.message ?? v2.error?.issues[0]?.message ?? 'Invalid input';
      toast.error(msg);
      void logLoginAttempt({ emailAttempted: email.trim(), success: false, errorReason: `validation: ${msg}` });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      void logLoginAttempt({ emailAttempted: email.trim(), success: false, errorReason: error.message });
      return;
    }
    void logLoginAttempt({
      emailAttempted: email.trim(),
      success: true,
      userId: data.user?.id ?? null,
    });
    navigate('/');
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = emailSchema.safeParse(email); const v2 = passSchema.safeParse(password);
    if (!v.success || !v2.success) { toast.error(v.error?.issues[0]?.message ?? v2.error?.issues[0]?.message); return; }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Account created. Sign in to continue.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-stat p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-accent shadow-elev mb-3">
            <Droplets className="h-7 w-7 text-accent-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-topbar-foreground tracking-tight">PWRI Monitoring</h1>
          <p className="text-sm text-topbar-muted">Multi-plant water operations</p>
        </div>
        <div className="bg-card rounded-2xl shadow-modal p-5">
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full mb-4">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-3">
                <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
                <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
                <Button type="submit" disabled={busy} className="w-full">{busy ? 'Creating…' : 'Create account'}</Button>
                <p className="text-xs text-muted-foreground text-center pt-1">After signup you'll complete your profile.</p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
