import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Logomark } from '@/components/icons/Logomark';
import { SignInForm } from '@/pages/auth/LoginForm';
import { SignUpForm } from '@/pages/auth/SignUpForm';
import { ResetPasswordForm } from '@/pages/auth/PasswordResetForm';

export default function Auth() {
  const { user, loading, isRecovery } = useAuth();
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [pendingNotice, setPendingNotice] = useState<{ email: string; count: number } | null>(null);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  if (user && !isRecovery) return <Navigate to="/" replace />;
  return (
    <div
      className="min-h-screen lg:flex"
      style={{ background: 'linear-gradient(135deg, hsl(210 62% 11%) 0%, hsl(175 84% 18%) 100%)' }}
    >
      {/* Brand panel — lg+ only */}
      <div className="hidden lg:flex lg:w-[42%] xl:w-[38%] relative flex-col justify-between p-10 xl:p-14 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: 'radial-gradient(ellipse 70% 55% at 15% 8%, hsl(var(--sidebar-primary) / 0.25), transparent)' }}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="relative">
          <Logomark size={40} className="rounded-xl shadow-elev" />
          <h1 className="mt-6 text-3xl font-extrabold text-topbar-foreground tracking-tight leading-tight">
            PWRI Monitoring
          </h1>
          <p className="mt-2 text-sm text-topbar-muted max-w-xs">Multi-plant water operations</p>
        </div>
        <ul className="relative space-y-3 text-sm text-topbar-muted">
          <li className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))] shrink-0" />
            Wells, RO trains, and blending in one place
          </li>
          <li className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))] shrink-0" />
            Offline-first field readings, GPS-tagged
          </li>
          <li className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))] shrink-0" />
            Audit-logged corrections and NRW tracking
          </li>
        </ul>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 lg:p-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6 lg:hidden">
            <div className="inline-flex items-center justify-center mb-3">
              <Logomark size={64} className="rounded-2xl shadow-elev" />
            </div>
            <h1 className="text-2xl font-extrabold text-topbar-foreground tracking-tight">PWRI Monitoring</h1>
            <p className="text-sm text-topbar-muted">Multi-plant water operations</p>
          </div>
          <div className="bg-card rounded-2xl shadow-modal p-5 lg:p-6">
            {isRecovery ? (
              <ResetPasswordForm />
            ) : (
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'signin' | 'signup')}>
                <TabsList className="grid grid-cols-2 w-full mb-4 h-14 p-1">
                  <TabsTrigger value="signin" className="h-full">Sign in</TabsTrigger>
                  <TabsTrigger value="signup" className="h-full">Sign up</TabsTrigger>
                </TabsList>
                <TabsContent value="signin">
                  <SignInForm
                    initialEmail={pendingNotice?.email}
                    notice={pendingNotice}
                    onClearNotice={() => setPendingNotice(null)}
                  />
                </TabsContent>
                <TabsContent value="signup">
                  <SignUpForm
                    onSuccess={(registeredEmail, count) => {
                      setPendingNotice({ email: registeredEmail, count });
                      setActiveTab('signin');
                    }}
                  />
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
