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
import { PageHeader } from '@/components/PageHeader';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DesignationCombobox, accessLevelFromRoles } from '@/components/DesignationCombobox';
import { toast } from '@/components/ui/sonner';
import {
  Loader2, Pencil, ShieldCheck, Building2, MapPin, User, Mail,
  CheckCircle2, Shield, Key, Building, ChevronRight, Activity, Database
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
        <h3 className="font-semibold text-base text-foreground">Sign in Required</h3>
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
    <div className="space-y-4 animate-fade-in max-w-5xl mx-auto pb-8" data-testid="profile-page">
      <PageHeader
        title="My Profile"
        titleIcon={<User className="h-5 w-5 text-primary" />}
        subtitle="Account details, role permissions, and facility assignments"
        actions={
          <div className="flex items-center gap-2">
            {!editing && !isOverride && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                className="h-8 gap-1.5 text-xs font-medium"
                data-testid="profile-edit-toggle"
              >
                <Pencil className="h-3.5 w-3.5 text-primary" />
                <span>Edit Profile</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="h-8 text-xs text-destructive hover:bg-destructive/10 font-medium"
            >
              Sign out
            </Button>
          </div>
        }
      />

      {/* Profile Overview Card */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 ring-2 ring-border shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-lg">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-foreground truncate">
                {displayName}
              </h2>
              <Badge variant="outline" className="text-2xs font-normal">
                {displayProfile?.designation || 'Operator'}
              </Badge>
              <StatusPill tone={access.tone} className="text-2xs">
                {access.label}
              </StatusPill>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              {displayProfile?.username && <span>@{displayProfile.username}</span>}
              {displayProfile?.username && user?.email && <span>·</span>}
              {user?.email && <span>{user.email}</span>}
              {isOverride && (
                <>
                  <span>·</span>
                  <span className="text-warn font-semibold">Operator Override Session</span>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

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
                    <Label htmlFor="profile-first-name" className="text-xs font-medium">First name</Label>
                    <Input
                      id="profile-first-name"
                      value={form.first_name}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                      placeholder="e.g. Kevin"
                      className="h-8 text-xs"
                      data-testid="profile-first-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="profile-middle-name" className="text-xs font-medium">Middle name</Label>
                    <Input
                      id="profile-middle-name"
                      value={form.middle_name}
                      onChange={(e) => setForm({ ...form, middle_name: e.target.value })}
                      placeholder="Optional"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="profile-last-name" className="text-xs font-medium">Last name</Label>
                    <Input
                      id="profile-last-name"
                      value={form.last_name}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                      placeholder="e.g. Vilbar"
                      className="h-8 text-xs"
                      data-testid="profile-last-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="profile-suffix" className="text-xs font-medium">Suffix</Label>
                    <Input
                      id="profile-suffix"
                      value={form.suffix}
                      onChange={(e) => setForm({ ...form, suffix: e.target.value })}
                      placeholder="Jr., III…"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="profile-username" className="text-xs font-medium">Username handle</Label>
                    <Input
                      id="profile-username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="e.g. Kevz"
                      className="h-8 text-xs font-mono"
                      data-testid="profile-username"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="profile-designation" className="text-xs font-medium">Designation</Label>
                    <DesignationCombobox
                      id="profile-designation"
                      value={form.designation}
                      onChange={(v) => setForm({ ...form, designation: v })}
                      extraOptions={existingDesignations}
                      data-testid="profile-designation"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving} className="h-8 text-xs">
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs gap-1" data-testid="profile-save">
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Save changes
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="space-y-0.5">
                  <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">Full Name</span>
                  <p className="font-semibold text-foreground text-sm">{displayName}</p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">Username</span>
                  <p className="font-semibold text-foreground text-sm font-mono">{displayProfile?.username ? `@${displayProfile.username}` : '—'}</p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">Designation</span>
                  <p className="font-semibold text-foreground text-sm">{displayProfile?.designation ?? 'Operator'}</p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">Account Status</span>
                  <div className="flex items-center gap-1.5 font-medium text-accent text-sm">
                    <span className="h-2 w-2 rounded-full bg-accent" />
                    <span>{displayProfile?.status ?? 'Active'}</span>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Email & Security Card */}
          {!isOverride && (
            <Card className="p-5 space-y-4" data-testid="profile-email-card">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Email &amp; Security</h3>
                  <p className="text-2xs text-muted-foreground">Primary login address and security notifications</p>
                </div>
                <span className="inline-flex items-center gap-1 text-2xs font-medium text-accent">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                </span>
              </div>

              <ProfileEmailChange />
            </Card>
          )}

          {/* Role & Access Matrix */}
          <Card className="p-5 space-y-4" data-testid="profile-role-card">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Role &amp; Permissions</h3>
                <p className="text-2xs text-muted-foreground">Configured authorization and system capabilities</p>
              </div>
              <StatusPill tone={access.tone} className="text-2xs">
                {access.label}
              </StatusPill>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {roles.length === 0 && !myCustomRole && (
                <Badge variant="secondary">No role assigned</Badge>
              )}
              {myCustomRole && (
                <Badge className="bg-primary text-primary-foreground font-medium" data-testid="profile-role-custom">
                  {myCustomRole.role.name}
                </Badge>
              )}
              {roles
                .filter((r) => !myCustomRole || r !== myCustomRole.role.base_role)
                .map((r) => (
                  <Badge key={r} variant="outline" className="font-normal" data-testid={`profile-role-${r}`}>
                    {r}
                  </Badge>
                ))}
            </div>

            {myCustomRole ? (
              <p className="text-xs text-muted-foreground">
                Based on <strong className="text-foreground">{myCustomRole.role.base_role}</strong> — tailored by system administrator.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Role hierarchy: <span className="font-medium text-foreground">Admin</span> (Full system access) · <span className="font-medium text-foreground">Manager</span> (Elevated plant config) · <span className="font-medium text-foreground">Supervisor</span> (Limited approval) · <span className="font-medium text-foreground">Operator</span> (Telemetry logging).
              </p>
            )}
          </Card>
        </div>

        {/* ── RIGHT COLUMN: Active Plant & Assigned Facilities (5 cols) ── */}
        <div className="lg:col-span-5 space-y-5">

          {/* Active Facility Card */}
          <Card className="p-5 space-y-4" data-testid="profile-plant-selector">
            <div className="border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">Active Monitoring Plant</h3>
              <p className="text-2xs text-muted-foreground">Currently selected facility context</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {currentActivePlant ? currentActivePlant.name : 'All Assigned Facilities'}
              </p>
              <Select
                value={selectedPlantId ?? 'all'}
                onValueChange={(v) => setSelectedPlantId(v === 'all' ? null : v)}
              >
                <SelectTrigger className="w-full h-8 text-xs" data-testid="profile-plant-select" id="profile-active-plant">
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
          <Card className="p-5 space-y-4" data-testid="profile-plants-card">
            <div className="border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">Assigned Facilities</h3>
              <p className="text-2xs text-muted-foreground">{assignedPlants.length} plant{assignedPlants.length === 1 ? '' : 's'} authorized</p>
            </div>

            {assignedPlants.length === 0 ? (
              <div className="p-4 text-center rounded bg-muted/40 text-xs text-muted-foreground">
                No plants assigned. Contact system administrator for facility assignments.
              </div>
            ) : (
              <div className="space-y-1.5">
                {assignedPlants.map((p) => {
                  const isActive = selectedPlantId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPlantId(p.id)}
                      className={`p-2.5 rounded-md border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        isActive
                          ? 'border-primary bg-primary-soft/40 shadow-xs'
                          : 'border-border bg-card hover:bg-muted/40 hover:border-primary/40'
                      }`}
                      data-testid={`profile-plant-badge-${p.id}`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                        <p className="text-3xs text-muted-foreground font-mono">ID: {p.id.slice(0, 8)}…</p>
                      </div>

                      {isActive ? (
                        <StatusPill tone="good" className="text-2xs shrink-0">
                          Active
                        </StatusPill>
                      ) : (
                        <span className="text-2xs text-muted-foreground hover:text-foreground shrink-0">
                          Switch →
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-3xs text-muted-foreground leading-normal pt-1">
              Plant assignments and facility access privileges are managed centrally in the Admin Console.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
