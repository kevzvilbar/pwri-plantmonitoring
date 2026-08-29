import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/StatusPill';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DesignationCombobox, accessLevelFromRoles } from '@/components/DesignationCombobox';
import { toast } from '@/components/ui/sonner';
import {
  Loader2, Pencil, ShieldCheck, Building2, MapPin, User, Mail,
  CheckCircle2, Shield, Key, Sparkles, Building, ChevronRight, Activity, Database
} from 'lucide-react';
import { ProfileEmailChange } from '@/components/ProfileEmailChange';
import { useMyCustomRole } from '@/hooks/useCustomRoles';

function getInitials(first?: string | null, last?: string | null, username?: string | null): string {
  if (first || last) {
    return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || 'U';
  }
  return username?.slice(0, 2).toUpperCase() || 'U';
}

export default function Profile() {
  const { user, profile, activeOperator, roles, refreshProfile, loading, signOut } = useAuth();
  const { data: myCustomRole } = useMyCustomRole();
  const { data: plants } = usePlants();
  const { selectedPlantId, setSelectedPlantId } = useAppStore();

  const isOverride = !!activeOperator && !!profile && activeOperator.id !== profile.id;
  const displayProfile = activeOperator;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: '', middle_name: '', last_name: '', suffix: '',
    username: '', designation: '',
  });

  useEffect(() => {
    if (displayProfile) {
      setForm({
        first_name: displayProfile.first_name ?? '',
        middle_name: displayProfile.middle_name ?? '',
        last_name: displayProfile.last_name ?? '',
        suffix: displayProfile.suffix ?? '',
        username: displayProfile.username ?? '',
        designation: displayProfile.designation ?? '',
      });
    }
    setEditing(false);
  }, [displayProfile?.id]);

  const { data: existingDesignations } = useQuery({
    queryKey: ['designation-suggestions'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('designation');
      return Array.from(
        new Set(((data ?? []) as any[]).map((d) => d.designation).filter(Boolean)),
      ) as string[];
    },
  });

  const assignedPlants = useMemo(() => {
    if (!plants || !profile) return [];
    return plants.filter((p) => displayProfile?.plant_assignments?.includes(p.id));
  }, [plants, displayProfile]);

  const currentActivePlant = useMemo(() => {
    if (!plants) return null;
    return plants.find((p) => p.id === selectedPlantId);
  }, [plants, selectedPlantId]);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('update_own_profile', {
        _designation: form.designation || '',
        _first_name: form.first_name || '',
        _last_name: form.last_name || '',
        _middle_name: form.middle_name || '',
        _suffix: form.suffix || '',
        _username: form.username || '',
      });
      if (error) throw new Error(error.message);
      toast.success('Profile updated successfully');
      await refreshProfile();
      setEditing(false);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>Loading profile data…</span>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <Card className="p-8 text-center max-w-md mx-auto my-12 space-y-3" data-testid="profile-empty">
        <User className="h-8 w-8 text-muted-foreground mx-auto" />
        <h3 className="font-bold text-base text-foreground">Sign in Required</h3>
        <p className="text-xs text-muted-foreground">Please sign in to access your user profile and plant assignments.</p>
      </Card>
    );
  }

  const access = accessLevelFromRoles(roles);
  const displayName = [
    displayProfile?.first_name, displayProfile?.middle_name,
    displayProfile?.last_name, displayProfile?.suffix,
  ].filter(Boolean).join(' ') || displayProfile?.username || 'PWRI Operator';

  const initials = getInitials(displayProfile?.first_name, displayProfile?.last_name, displayProfile?.username);

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl mx-auto pb-8" data-testid="profile-page">
      
      {/* ── 1. EXECUTIVE PROFILE HERO BANNER ── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card to-muted/40 p-5 sm:p-6 shadow-sm">
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative shrink-0">
              <Avatar className="h-16 w-16 sm:h-20 sm:w-20 ring-4 ring-card shadow-md">
                <AvatarFallback className="bg-gradient-to-tr from-primary to-accent text-white font-bold text-xl sm:text-2xl tracking-wider">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span
                className="absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full bg-accent ring-2 ring-card shadow-xs"
                title="Active Account"
              />
            </div>

            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg sm:text-2xl font-bold text-foreground tracking-tight truncate">
                  {displayName}
                </h1>
                <span className="inline-flex items-center gap-1 text-2xs font-extrabold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  <Sparkles className="h-3 w-3" />
                  {displayProfile?.designation || 'Operator'}
                </span>
                <StatusPill tone={access.tone} className="text-2xs px-2.5 py-0.5 font-bold">
                  {access.label}
                </StatusPill>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap font-mono">
                {displayProfile?.username && (
                  <span>@{displayProfile.username}</span>
                )}
                {displayProfile?.username && user?.email && <span>·</span>}
                {user?.email && (
                  <span className="truncate">{user.email}</span>
                )}
                {isOverride && (
                  <>
                    <span>·</span>
                    <span className="text-warn font-semibold">Operator Override Session</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
            {!editing && !isOverride ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                className="h-9 px-3.5 gap-1.5 rounded-xl font-medium shadow-2xs hover:bg-muted"
                data-testid="profile-edit-toggle"
              >
                <Pencil className="h-3.5 w-3.5 text-primary" />
                <span>Edit Profile</span>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="h-9 px-3 text-destructive hover:bg-destructive/10 rounded-xl font-medium"
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>

      {/* ── 2. TWO-COLUMN RESPONSIVE LAYOUT ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* ── LEFT COLUMN: Identity & Security (7 cols) ── */}
        <div className="lg:col-span-7 space-y-5">

          {/* Account Identity Card */}
          <Card className="p-5 rounded-2xl border border-border/80 shadow-2xs space-y-4" data-testid="profile-identity-card">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Identity &amp; Profile Details</h3>
                  <p className="text-2xs text-muted-foreground">Personal credentials recorded for operational logs</p>
                </div>
              </div>
              {!editing && !isOverride && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-2xs font-semibold text-primary hover:underline flex items-center gap-1"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              )}
            </div>

            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="profile-first-name" className="text-xs font-semibold">First name</Label>
                    <Input
                      id="profile-first-name"
                      value={form.first_name}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                      placeholder="e.g. Kevin"
                      className="h-9 rounded-xl text-xs"
                      data-testid="profile-first-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="profile-middle-name" className="text-xs font-semibold">Middle name</Label>
                    <Input
                      id="profile-middle-name"
                      value={form.middle_name}
                      onChange={(e) => setForm({ ...form, middle_name: e.target.value })}
                      placeholder="Optional"
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="profile-last-name" className="text-xs font-semibold">Last name</Label>
                    <Input
                      id="profile-last-name"
                      value={form.last_name}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                      placeholder="e.g. Vilbar"
                      className="h-9 rounded-xl text-xs"
                      data-testid="profile-last-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="profile-suffix" className="text-xs font-semibold">Suffix</Label>
                    <Input
                      id="profile-suffix"
                      value={form.suffix}
                      onChange={(e) => setForm({ ...form, suffix: e.target.value })}
                      placeholder="Jr., III…"
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="profile-username" className="text-xs font-semibold">Username handle</Label>
                    <Input
                      id="profile-username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="e.g. Kevz"
                      className="h-9 rounded-xl text-xs font-mono"
                      data-testid="profile-username"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="profile-designation" className="text-xs font-semibold">Designation</Label>
                    <DesignationCombobox
                      id="profile-designation"
                      value={form.designation}
                      onChange={(v) => setForm({ ...form, designation: v })}
                      extraOptions={existingDesignations}
                      data-testid="profile-designation"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving} className="rounded-xl h-8 text-xs">
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={saving} className="rounded-xl h-8 text-xs gap-1" data-testid="profile-save">
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Save changes
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-muted/40 border border-border/60 space-y-0.5">
                  <span className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">Full Name</span>
                  <p className="font-bold text-foreground text-sm">{displayName}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/40 border border-border/60 space-y-0.5">
                  <span className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">Username</span>
                  <p className="font-bold text-foreground text-sm font-mono">{displayProfile?.username ? `@${displayProfile.username}` : '—'}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/40 border border-border/60 space-y-0.5">
                  <span className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">Designation</span>
                  <p className="font-bold text-foreground text-sm">{displayProfile?.designation ?? 'Operator'}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/40 border border-border/60 space-y-0.5">
                  <span className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">Account Status</span>
                  <div className="flex items-center gap-1.5 font-bold text-accent text-sm">
                    <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                    <span>{displayProfile?.status ?? 'Active'}</span>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Email & Security Card */}
          {!isOverride && (
            <Card className="p-5 rounded-2xl border border-border/80 shadow-2xs space-y-4" data-testid="profile-email-card">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-info/10 text-info flex items-center justify-center">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Email &amp; Security</h3>
                    <p className="text-2xs text-muted-foreground">Primary login address and security notifications</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-3xs font-semibold px-2 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/30">
                  <CheckCircle2 className="h-3 w-3" /> Verified
                </span>
              </div>

              <ProfileEmailChange />
            </Card>
          )}

          {/* Role & Access Matrix */}
          <Card className="p-5 rounded-2xl border border-border/80 shadow-2xs space-y-4" data-testid="profile-role-card">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Role &amp; Permissions</h3>
                  <p className="text-2xs text-muted-foreground">Configured authorization and system capabilities</p>
                </div>
              </div>
              <StatusPill tone={access.tone} className="text-2xs font-bold px-2 py-0.5">
                {access.label}
              </StatusPill>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {roles.length === 0 && !myCustomRole && (
                <Badge variant="secondary">No role assigned</Badge>
              )}
              {myCustomRole && (
                <Badge className="bg-primary text-primary-foreground font-bold" data-testid="profile-role-custom">
                  {myCustomRole.role.name}
                </Badge>
              )}
              {roles
                .filter((r) => !myCustomRole || r !== myCustomRole.role.base_role)
                .map((r) => (
                  <Badge key={r} variant="outline" className="font-semibold" data-testid={`profile-role-${r}`}>
                    {r}
                  </Badge>
                ))}
            </div>

            {myCustomRole ? (
              <div className="text-xs text-muted-foreground p-3 rounded-xl bg-muted/40 border border-border/60">
                Based on <strong className="text-foreground">{myCustomRole.role.base_role}</strong> — tailored by system administrator.
              </div>
            ) : (
              <div className="text-xs text-muted-foreground p-3 rounded-xl bg-muted/40 border border-border/60 leading-relaxed">
                Role hierarchy: <span className="font-semibold text-foreground">Admin</span> (Full system access) · <span className="font-semibold text-foreground">Manager</span> (Elevated plant config) · <span className="font-semibold text-foreground">Supervisor</span> (Limited approval) · <span className="font-semibold text-foreground">Operator</span> (Telemetry logging).
              </div>
            )}
          </Card>
        </div>

        {/* ── RIGHT COLUMN: Active Plant & Assigned Facilities (5 cols) ── */}
        <div className="lg:col-span-5 space-y-5">

          {/* Active Facility Card */}
          <Card className="p-5 rounded-2xl border border-border/80 shadow-2xs space-y-4" data-testid="profile-plant-selector">
            <div className="flex items-center gap-2 border-b border-border/50 pb-3">
              <div className="h-7 w-7 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
                <Building2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Active Monitoring Plant</h3>
                <p className="text-2xs text-muted-foreground">Currently selected facility context</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-muted/30 border border-border/70 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-3xs uppercase font-semibold text-muted-foreground tracking-wider">Current Context</span>
                <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              </div>
              <p className="text-base font-bold text-foreground">
                {currentActivePlant ? currentActivePlant.name : 'All Assigned Facilities'}
              </p>
              <Select
                value={selectedPlantId ?? 'all'}
                onValueChange={(v) => setSelectedPlantId(v === 'all' ? null : v)}
              >
                <SelectTrigger className="w-full h-9 rounded-xl text-xs bg-card" data-testid="profile-plant-select" id="profile-active-plant">
                  <SelectValue placeholder="Choose a plant…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All plants (Combined View)</SelectItem>
                  {assignedPlants.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {/* Assigned Facilities List */}
          <Card className="p-5 rounded-2xl border border-border/80 shadow-2xs space-y-4" data-testid="profile-plants-card">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Assigned Facilities</h3>
                  <p className="text-2xs text-muted-foreground">{assignedPlants.length} plant{assignedPlants.length === 1 ? '' : 's'} authorized</p>
                </div>
              </div>
            </div>

            {assignedPlants.length === 0 ? (
              <div className="p-4 text-center rounded-xl bg-muted/30 border border-border/60 text-xs text-muted-foreground">
                No plants assigned. Contact system administrator for facility assignments.
              </div>
            ) : (
              <div className="space-y-2">
                {assignedPlants.map((p) => {
                  const isActive = selectedPlantId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPlantId(p.id)}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        isActive
                          ? 'border-accent bg-accent-soft/30 shadow-2xs'
                          : 'border-border/70 bg-card hover:bg-muted/40 hover:border-primary/40'
                      }`}
                      data-testid={`profile-plant-badge-${p.id}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                          isActive ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                          <Building className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-foreground truncate">{p.name}</p>
                          <p className="text-3xs text-muted-foreground font-mono">ID: {p.id.slice(0, 8)}…</p>
                        </div>
                      </div>

                      {isActive ? (
                        <span className="text-3xs font-extrabold text-accent px-2 py-0.5 rounded-full bg-accent-soft border border-accent/40 shrink-0">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="text-3xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-0.5 shrink-0">
                          Switch →
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-3xs text-muted-foreground/80 leading-normal pt-1">
              Plant assignments and facility access privileges are managed centrally in the Admin Console.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
