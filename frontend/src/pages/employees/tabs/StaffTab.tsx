import { useState, useMemo } from 'react';
import { Search, Users, Crown, BarChart2, LayoutGrid, List, Layers, Cog, UserCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StaffChatDialog } from '../components/StaffChatDialog';
import { cn } from '@/lib/utils';
import { usePresence } from '@/hooks/usePresence';
import { StaffMember, OnlineIds } from '../types';
import { DetailDrawer } from './StaffTab/DetailDrawer';
import { StaffCard } from './StaffTab/StaffCard';
import { TableView } from './StaffTab/TableView';
import { GroupedView } from './StaffTab/GroupedView';
import { useStaffData } from './StaffTab/hooks';

function Staff() {
  const [chatPeer, setChatPeer] = useState<StaffMember | null>(null);
  const [detailMember, setDetailMember] = useState<StaffMember | null>(null);
  const [search, setSearch] = useState('');
  const [filterPlant, setFilterPlant] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'online' | 'leadership' | 'analyst' | 'operator'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'grouped'>('grid');

  const { isUserOnline } = usePresence();
  const onlineIds = useMemo(() => ({ has: (id: string) => isUserOnline(id) }), [isUserOnline]);

  const {
    staff,
    plants,
    roles,
    isAdmin,
    user,
    activeOperator,
    onlineCount,
    leadershipCount,
    analystCount,
    operatorCount,
    filterStaff,
    plantsWithStaff,
    getGroup,
    getMemberRole,
  } = useStaffData(onlineIds);

  const filteredStaff = (filterStaff as any)(search, filterPlant, roleFilter);

  const leadershipGroup = (getGroup as any)(filteredStaff, 'leadership');
  const analystGroup = (getGroup as any)(filteredStaff, 'analyst');
  const operatorGroup = (getGroup as any)(filteredStaff, 'operator');

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
          <TableView
            staff={filteredStaff}
            plants={plants as any[]}
            roles={roles as any[]}
            activeOperator={activeOperator as any}
            user={user as any}
            onlineIds={onlineIds}
            getMemberRole={getMemberRole}
            onChat={setChatPeer}
            onDetail={setDetailMember}
          />
        </Card>
      )}

      {viewMode === 'grouped' && (
        <GroupedView
          leadershipGroup={leadershipGroup}
          analystGroup={analystGroup}
          operatorGroup={operatorGroup}
          roles={roles as any[]}
          plants={plants as any[]}
          activeOperator={activeOperator as any}
          user={user as any}
          onlineIds={onlineIds}
          onChat={setChatPeer}
          onDetail={setDetailMember}
        />
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
