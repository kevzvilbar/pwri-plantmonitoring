import { ReactNode, useEffect } from 'react';
import { X, User, ChevronRight, Users, Crown, BarChart2, LayoutGrid, List, Layers, Cog, UserCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';

import React, { useState, useMemo, Fragment } from 'react';
import { Search, Filter, Download, Info, Building2, ShieldCheck, MapPin, Clock, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataState } from '@/components/DataState';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { StaffMember, getRoleConfig, avatarColor, initials, fullName, getPresence, presenceConfig, OnlineIds } from '../types';
import { useAuth } from '@/hooks/useAuth';
import { usePresence } from '@/hooks/usePresence';
import { usePlants } from '@/hooks/usePlants';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { StaffChatDialog } from '../components/StaffChatDialog';
import { cn } from '@/lib/utils';
import { fmtIsoDate } from '@/lib/format';
import { toast } from 'sonner';

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-2xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-sm break-words">{value}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Drawer
// ---------------------------------------------------------------------------

function DetailDrawer({ member, roles, plants, allStaff, onChat, onClose, isSelf, isAdmin, onlineIds }: {
  member: StaffMember; roles: any[]; plants: any[]; allStaff: StaffMember[];
  onChat: () => void; onClose: () => void; isSelf: boolean; isAdmin: boolean; onlineIds: OnlineIds;
}) {
  const presence = getPresence(member.last_seen_at, member.status, onlineIds.has(member.id));
  const pc = presenceConfig[presence];
  const memberRoles = roles.filter((r) => r.user_id === member.id).map((r) => r.role);
  const memberPlants = plants.filter((p) => member.plant_assignments?.includes(p.id)).map((p) => p.name);
  const head = allStaff.find((s) => s.id === member.immediate_head_id);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div
        className={cn(
          'fixed top-0 bottom-0 z-50 bg-background border-l shadow-2xl flex flex-col',
          // Full-width on mobile — this was a fixed 320px (w-80) drawer
          // regardless of viewport, which either exactly filled or didn't
          // quite fit a 320-375px phone with zero margin, and gave content
          // (multi-line info rows, action buttons) the same cramped width
          // it'd get on desktop. sm:w-80 restores the original sidebar
          // width once there's room for it to actually behave like one.
          'right-0 left-0 sm:left-auto sm:w-80',
        )}
      >
        <div className={cn('h-1.5 w-full', avatarColor(member.id))} />
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">Employee Details</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-center pt-6 pb-4 px-4 text-center">
            <div className={cn('h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold text-white mb-3', avatarColor(member.id))}>
              {initials(member)}
            </div>
            <div className="font-semibold text-base">{fullName(member)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">@{member.username ?? '—'}</div>
            <div className={cn('flex items-center gap-1.5 mt-2 text-xs px-2.5 py-1 rounded-full border font-medium', pc.badge)}>
              <span className={cn('h-2 w-2 rounded-full', pc.dot)} />
              {pc.label}
            </div>
          </div>

          <div className="px-4 space-y-3 pb-6">
            <InfoRow icon={<User className="h-3.5 w-3.5" />}       label="Designation"    value={member.designation ?? '—'} />
            <InfoRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Role(s)"        value={memberRoles.join(', ') || '—'} />
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />}  label="Plants"         value={memberPlants.join(', ') || '—'} />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />}     label="Reports to"     value={head ? fullName(head) : '—'} />
            <InfoRow icon={<Clock className="h-3.5 w-3.5" />}      label="Account status" value={member.status} />
          </div>
        </div>

        {/* pb includes a safe-area inset so the action row clears the home
            indicator/gesture bar on notched phones when this is full-width. */}
        <div className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-2">
          {!isSelf && (
            <Button className="flex-1 gap-1.5" size="sm" onClick={() => { onChat(); onClose(); }}>
              <MessageSquare className="h-3.5 w-3.5" /> Chat
            </Button>
          )}
          {isAdmin && (
            <DeleteEntityMenu
              kind="user" id={member.id} label={fullName(member)}
              canSoftDelete={member.status === 'Active'} canHardDelete
              invalidateKeys={[['staff'], ['all-roles']]} compact
            />
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Staff Card — Modern horizontal executive design
// ---------------------------------------------------------------------------

function StaffCard({ member, roles, plants, isSelf, onlineIds, onChat, onDetail }: {
  member: StaffMember; roles: any[]; plants: any[]; isSelf: boolean; onlineIds: OnlineIds; onChat: () => void; onDetail: () => void;
}) {
  const presence = getPresence(member.last_seen_at, member.status, onlineIds.has(member.id));
  const pc = presenceConfig[presence];
  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? 'Operator';
  const rc = getRoleConfig(memberRole);

  const assignedPlantNames = (member.plant_assignments ?? [])
    .map((pid) => plants.find((p) => p.id === pid)?.name)
    .filter(Boolean);

  return (
    <div
      className="bg-card hover:bg-card/90 rounded-xl border border-border/70 p-3.5 flex flex-col justify-between gap-3 shadow-2xs hover:shadow-md hover:border-primary/50 transition-all cursor-pointer group"
      onClick={onDetail}
    >
      {/* Top row: Avatar + Identity + Presence pill */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Avatar with live presence ring */}
          <div className="relative shrink-0">
            <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-xs', avatarColor(member.id))}>
              {initials(member)}
            </div>
            <span className={cn('absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-card', pc.dot)} />
          </div>

          {/* Name & Role */}
          <div className="min-w-0 flex-1">
            <div className="font-bold text-sm leading-snug truncate flex items-center gap-1.5">
              <span className="truncate">{fullName(member)}</span>
              {isSelf && (
                <span className="text-2xs font-semibold px-1 rounded bg-primary-soft text-primary">you</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn('inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded-md border', rc.bg, rc.color)}>
                {rc.icon}
                <span>{memberRole}</span>
              </span>
              {member.username && (
                <span className="text-2xs text-muted-foreground truncate font-mono">@{member.username}</span>
              )}
            </div>
          </div>
        </div>

        {/* Presence Badge */}
        <span className={cn('text-2xs px-2 py-0.5 rounded-full border font-semibold shrink-0', pc.badge)}>
          {pc.label}
        </span>
      </div>

      {/* Plant Assignment & Action row */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-xs">
        {/* Plant chips */}
        <div className="flex items-center gap-1.5 overflow-hidden">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
          {assignedPlantNames.length > 0 ? (
            <span className="text-xs text-muted-foreground truncate font-medium">
              {assignedPlantNames.slice(0, 2).join(', ')}
              {assignedPlantNames.length > 2 && ` +${assignedPlantNames.length - 2}`}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/60 italic">All plants / Float</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isSelf && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary-soft"
              onClick={onChat}
              title="Send direct message"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-2xs gap-0.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted font-medium"
            onClick={onDetail}
            title="View employee profile"
          >
            <span>Profile</span>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff tab
// ---------------------------------------------------------------------------

function Staff() {
  const { data: plants = [] } = usePlants();
  const { isAdmin, user, activeOperator } = useAuth();
  const queryClient = useQueryClient();

  const [chatPeer, setChatPeer] = useState<StaffMember | null>(null);
  const [detailMember, setDetailMember] = useState<StaffMember | null>(null);
  const [search, setSearch] = useState('');
  const [filterPlant, setFilterPlant] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'online' | 'leadership' | 'analyst' | 'operator'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'grouped'>('grid');

  const { isUserOnline } = usePresence();
  // Adapter: make a Set-like interface for all the places that call onlineIds.has(id)
  const onlineIds = useMemo(() => ({ has: (id: string) => isUserOnline(id) }), [isUserOnline]);

  const { data: staff = [], refetch: refetchStaff } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_staff_profiles');
      if (!rpcError && rpcData) return rpcData as StaffMember[];
      const { data, error } = await supabase.from('user_profiles').select('*').order('last_name');
      if (error) throw error;
      return (data ?? []) as StaffMember[];
    },
    staleTime: 0,
  });

  useEffect(() => {
    const ch = supabase
      .channel('staff-presence')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_profiles' }, () => {
        refetchStaff();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetchStaff]);

  const { data: roles = [] } = useQuery({
    queryKey: ['all-roles'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_user_roles');
      if (!rpcError && rpcData) return rpcData as { user_id: string; role: string }[];
      const { data } = await (supabase as any).from('user_profiles').select('id, user_roles(role)');
      return (data ?? []).flatMap((p: any) =>
        (p.user_roles ?? []).map((r: any) => ({ user_id: p.id, role: r.role }))
      );
    },
  });

  // Calculate high-level stats
  const onlineCount = staff.filter((s) => onlineIds.has(s.id) || getPresence(s.last_seen_at, s.status, onlineIds.has(s.id)) === 'active').length;
  const leadershipCount = staff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Admin' || r === 'Manager';
  }).length;
  const analystCount = staff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Data Analyst';
  }).length;
  const operatorCount = staff.length - leadershipCount - analystCount;

  // Filter staff
  const filteredStaff = useMemo(() => {
    const q = search.toLowerCase();
    return staff.filter((s) => {
      const nameMatch = !q || fullName(s).toLowerCase().includes(q) || (s.username ?? '').toLowerCase().includes(q);
      const plantMatch = filterPlant === 'all' || s.plant_assignments?.includes(filterPlant);

      const r = (roles as any[]).find((x) => x.user_id === s.id)?.role ?? 'Operator';
      const isOnline = onlineIds.has(s.id) || getPresence(s.last_seen_at, s.status, onlineIds.has(s.id)) === 'active';

      let roleMatch = true;
      if (roleFilter === 'online') roleMatch = isOnline;
      else if (roleFilter === 'leadership') roleMatch = r === 'Admin' || r === 'Manager';
      else if (roleFilter === 'analyst') roleMatch = r === 'Data Analyst';
      else if (roleFilter === 'operator') roleMatch = r === 'Operator' || r === 'Technician';

      return nameMatch && plantMatch && roleMatch;
    });
  }, [staff, search, filterPlant, roleFilter, roles, onlineIds]);

  const plantsWithStaff = (plants ?? []).filter((p) => staff.some((s) => s.plant_assignments?.includes(p.id)));

  // Groups for grouped view
  const leadershipGroup = filteredStaff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Admin' || r === 'Manager';
  });
  const analystGroup = filteredStaff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Data Analyst';
  });
  const operatorGroup = filteredStaff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r !== 'Admin' && r !== 'Manager' && r !== 'Data Analyst';
  });

  return (
    <div className="space-y-3.5">
      {/* ── KPI Summary Strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl border border-border/70 bg-card flex items-center gap-3 shadow-2xs">
          <div className="h-9 w-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <Users className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">Total Staff</p>
            <p className="text-base font-bold text-foreground">{staff.length}</p>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/70 bg-card flex items-center gap-3 shadow-2xs">
          <div className="h-9 w-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <div className="h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
          </div>
          <div>
            <p className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">Live Online</p>
            <p className="text-base font-bold text-accent">{onlineCount} <span className="text-3xs text-muted-foreground font-normal">active</span></p>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/70 bg-card flex items-center gap-3 shadow-2xs">
          <div className="h-9 w-9 rounded-lg bg-info-soft text-info flex items-center justify-center shrink-0">
            <Crown className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">Leadership</p>
            <p className="text-base font-bold text-foreground">{leadershipCount}</p>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/70 bg-card flex items-center gap-3 shadow-2xs">
          <div className="h-9 w-9 rounded-lg bg-kpi-ro/15 text-kpi-ro flex items-center justify-center shrink-0">
            <BarChart2 className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">Analysts & Ops</p>
            <p className="text-base font-bold text-foreground">{analystCount + operatorCount}</p>
          </div>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="p-3 rounded-xl border border-border/70 bg-card/80 backdrop-blur-sm space-y-2.5 shadow-2xs">
        <div className="flex flex-col md:flex-row items-center justify-between gap-2.5">
          {/* Search */}
          <div className="relative w-full md:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username, plant…"
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>

          {/* Plant selector + View mode toggle */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            <Select value={filterPlant} onValueChange={setFilterPlant}>
              <SelectTrigger className="h-8 text-xs w-[180px] bg-background border-border/80 font-sans">
                <SelectValue placeholder="All Plant Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plant Locations</SelectItem>
                {plantsWithStaff.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* View switcher */}
            <div className="flex items-center gap-0.5 bg-muted/60 p-0.5 rounded-lg border border-border/50">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={cn(
                  'h-7 px-2 text-xs font-semibold rounded-md flex items-center gap-1 transition-all',
                  viewMode === 'grid'
                    ? 'bg-card text-primary shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Grid cards"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={cn(
                  'h-7 px-2 text-xs font-semibold rounded-md flex items-center gap-1 transition-all',
                  viewMode === 'table'
                    ? 'bg-card text-primary shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Table directory"
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Table</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={cn(
                  'h-7 px-2 text-xs font-semibold rounded-md flex items-center gap-1 transition-all',
                  viewMode === 'grouped'
                    ? 'bg-card text-primary shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Grouped by department"
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Grouped</span>
              </button>
            </div>
          </div>
        </div>

        {/* Role Quick Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs pt-1 border-t border-border/40 font-sans">
          {[
            { id: 'all', label: 'All Staff', count: staff.length, icon: null },
            { id: 'online', label: 'Online', count: onlineCount, icon: <span className="h-2 w-2 rounded-full bg-accent" /> },
            { id: 'leadership', label: 'Leadership', count: leadershipCount, icon: <Crown className="h-3 w-3 text-info" /> },
            { id: 'analyst', label: 'Analysts', count: analystCount, icon: <BarChart2 className="h-3 w-3 text-primary" /> },
            { id: 'operator', label: 'Operators', count: operatorCount, icon: <Cog className="h-3 w-3 text-muted-foreground" /> },
          ].map((rf) => (
            <button
              key={rf.id}
              type="button"
              onClick={() => setRoleFilter(rf.id as any)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border flex items-center gap-1.5',
                roleFilter === rf.id
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                  : 'bg-muted/40 text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted',
              )}
            >
              {rf.icon}
              <span>{rf.label}</span>
              <span className={cn(
                'font-mono-num text-3xs px-1 rounded-full',
                roleFilter === rf.id ? 'bg-primary-foreground/20 text-white' : 'bg-muted text-muted-foreground'
              )}>
                {rf.count}
              </span>
            </button>
          ))}
          <span className="ml-auto text-3xs text-muted-foreground shrink-0 pl-2">
            Showing <strong className="text-foreground font-mono-num font-bold">{filteredStaff.length}</strong> of <span className="font-mono-num">{staff.length}</span>
          </span>
        </div>
      </div>

      {/* ── Content View Rendering ── */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredStaff.map((s) => (
            <StaffCard
              key={s.id}
              member={s}
              roles={roles as any[]}
              plants={plants as any[]}
              isSelf={s.id === (activeOperator?.id ?? user?.id)}
              onlineIds={onlineIds}
              onChat={() => setChatPeer(s)}
              onDetail={() => setDetailMember(s)}
            />
          ))}
          {filteredStaff.length === 0 && (
            <div className="col-span-full">
              <Card className="p-8 text-xs text-center text-muted-foreground border-dashed">
                No staff match your current search and role filters.
              </Card>
            </div>
          )}
        </div>
      )}

      {viewMode === 'table' && (
        <Card className="overflow-hidden border border-border/70 shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-3xs uppercase tracking-wider text-muted-foreground font-bold">
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Assigned Plants</th>
                  <th className="py-2.5 px-3">Presence</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredStaff.map((s) => {
                  const presence = getPresence(s.last_seen_at, s.status, onlineIds.has(s.id));
                  const pc = presenceConfig[presence];
                  const memberRole = (roles as any[]).find((r) => r.user_id === s.id)?.role ?? 'Operator';
                  const rc = getRoleConfig(memberRole);
                  const isSelf = s.id === (activeOperator?.id ?? user?.id);
                  const assignedPlantNames = (s.plant_assignments ?? [])
                    .map((pid) => plants.find((p) => p.id === pid)?.name)
                    .filter(Boolean);

                  return (
                    <tr
                      key={s.id}
                      onClick={() => setDetailMember(s)}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center text-2xs font-bold text-white shrink-0', avatarColor(s.id))}>
                            {initials(s)}
                          </div>
                          <div>
                            <div className="font-bold text-foreground flex items-center gap-1.5">
                              <span>{fullName(s)}</span>
                              {isSelf && (
                                <span className="text-2xs font-semibold px-1 rounded bg-primary-soft text-primary">you</span>
                              )}
                            </div>
                            {s.username && (
                              <div className="text-3xs text-muted-foreground font-mono">@{s.username}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        <span className={cn('inline-flex items-center gap-1 text-3xs font-semibold px-2 py-0.5 rounded-md border', rc.bg, rc.color)}>
                          {rc.icon}
                          <span>{memberRole}</span>
                        </span>
                      </td>

                      <td className="py-2 px-3">
                        {assignedPlantNames.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {assignedPlantNames.map((name, i) => (
                              <span key={i} className="text-3xs px-1.5 py-0.2 rounded bg-muted font-medium text-foreground border border-border/60">
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-3xs text-muted-foreground/50 italic">All plants / Float</span>
                        )}
                      </td>

                      <td className="py-2 px-3">
                        <span className={cn('inline-flex items-center gap-1 text-3xs px-2 py-0.5 rounded-full border font-semibold', pc.badge)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', pc.dot)} />
                          {pc.label}
                        </span>
                      </td>

                      <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          {!isSelf && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary-soft"
                              onClick={() => setChatPeer(s)}
                              title="Direct Message"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-3xs font-medium rounded-lg"
                            onClick={() => setDetailMember(s)}
                          >
                            Profile
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {viewMode === 'grouped' && (
        <div className="space-y-4">
          {/* Leadership */}
          {leadershipGroup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Crown className="h-4 w-4 text-danger" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Leadership & Administration ({leadershipGroup.length})
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {leadershipGroup.map((s) => (
                  <StaffCard
                    key={s.id}
                    member={s}
                    roles={roles as any[]}
                    plants={plants as any[]}
                    isSelf={s.id === (activeOperator?.id ?? user?.id)}
                    onlineIds={onlineIds}
                    onChat={() => setChatPeer(s)}
                    onDetail={() => setDetailMember(s)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Data Analysts */}
          {analystGroup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <BarChart2 className="h-4 w-4 text-kpi-ro" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Data & Compliance Analytics ({analystGroup.length})
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {analystGroup.map((s) => (
                  <StaffCard
                    key={s.id}
                    member={s}
                    roles={roles as any[]}
                    plants={plants as any[]}
                    isSelf={s.id === (activeOperator?.id ?? user?.id)}
                    onlineIds={onlineIds}
                    onChat={() => setChatPeer(s)}
                    onDetail={() => setDetailMember(s)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Operators & Technicians */}
          {operatorGroup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <UserCircle className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Plant Operations & Field Technical Team ({operatorGroup.length})
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {operatorGroup.map((s) => (
                  <StaffCard
                    key={s.id}
                    member={s}
                    roles={roles as any[]}
                    plants={plants as any[]}
                    isSelf={s.id === (activeOperator?.id ?? user?.id)}
                    onlineIds={onlineIds}
                    onChat={() => setChatPeer(s)}
                    onDetail={() => setDetailMember(s)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {detailMember && (
        <DetailDrawer
          member={detailMember} roles={roles as any[]} plants={plants ?? []} allStaff={staff}
          isSelf={detailMember.id === (activeOperator?.id ?? user?.id)} isAdmin={isAdmin}
          onlineIds={onlineIds}
          onChat={() => setChatPeer(detailMember)}
          onClose={() => setDetailMember(null)}
        />
      )}

      {chatPeer && user && chatPeer.id !== (activeOperator?.id ?? user.id) && (
        <StaffChatDialog
          peer={chatPeer}
          currentUserId={activeOperator?.id ?? user.id}
          onlineIds={onlineIds}
          onClose={() => setChatPeer(null)}
        />
      )}
    </div>
  );
}


export { Staff as StaffTab };
