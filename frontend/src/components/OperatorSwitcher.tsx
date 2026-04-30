import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth, type Profile } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChevronDown, UserCheck, UserCog, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

function initials(p: Profile | null): string {
  if (!p) return '?';
  return ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase() || '?';
}

function fullName(p: Profile | null): string {
  if (!p) return 'Unknown';
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || 'Unknown';
}

/**
 * Fetches all Active user profiles assigned to at least one of the
 * same plants as the authenticated user (or all profiles for Admins/Managers).
 */
function useSharedPlantProfiles(plantAssignments: string[], isManager: boolean) {
  return useQuery<Profile[]>({
    queryKey: ['shared-plant-profiles', plantAssignments.join(','), isManager],
    queryFn: async () => {
      let q = supabase
        .from('user_profiles')
        .select('*')
        .eq('status', 'Active')
        .eq('profile_complete', true);

      // Non-managers only see peers at their assigned plants
      if (!isManager && plantAssignments.length > 0) {
        q = q.overlaps('plant_assignments', plantAssignments);
      }

      const { data, error } = await q.order('first_name');
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
    enabled: true,
    staleTime: 30_000,
  });
}

export function OperatorSwitcher() {
  const { user, profile, activeOperator, signOut, isManager } = useAuth();
  const { activeOperatorId, setActiveOperatorId } = useAppStore();
  const navigate = useNavigate();

  const plantAssignments = profile?.plant_assignments ?? [];
  const { data: peers = [] } = useSharedPlantProfiles(plantAssignments, isManager);

  // Confirm-switch state — require a tap to confirm before committing
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Reset pending if menu closes without confirming
  useEffect(() => { if (!open) setPendingId(null); }, [open]);

  const isOverride = activeOperatorId !== null && activeOperatorId !== user?.id;
  const avatarBg = isOverride ? 'bg-amber-500' : 'bg-accent';

  const handleSelect = (p: Profile) => {
    if (p.id === user?.id) {
      // Selecting own profile = clear override
      setActiveOperatorId(null);
      setPendingId(null);
      setOpen(false);
      toast.success('Switched back to your own profile');
      return;
    }
    if (pendingId === p.id) {
      // Second tap = confirm
      setActiveOperatorId(p.id);
      setPendingId(null);
      setOpen(false);
      toast.success(`Now recording as ${fullName(p)}`);
    } else {
      // First tap = ask for confirmation
      setPendingId(p.id);
    }
  };

  const clearOverride = () => {
    setActiveOperatorId(null);
    setPendingId(null);
    setOpen(false);
    toast.success('Switched back to your own profile');
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 hover:bg-topbar/40 rounded-full pl-1 pr-2 py-1 transition-colors">
          <div className="relative">
            <Avatar className="h-8 w-8">
              <AvatarFallback className={`${avatarBg} text-white text-xs font-semibold`}>
                {initials(activeOperator)}
              </AvatarFallback>
            </Avatar>
            {isOverride && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-amber-400 border-2 border-topbar flex items-center justify-center">
                <UserCheck className="h-2 w-2 text-white" />
              </span>
            )}
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-topbar-muted" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        {/* Header: who is currently recording */}
        <DropdownMenuLabel className="pb-1">
          <div className="flex flex-col gap-0.5">
            {isOverride ? (
              <>
                <div className="flex items-center gap-1.5">
                  <UserCheck className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                  <span className="font-semibold text-sm truncate">{fullName(activeOperator)}</span>
                </div>
                <span className="text-xs text-muted-foreground pl-5">
                  Active operator · {activeOperator?.designation ?? 'No designation'}
                </span>
                <span className="text-[10px] text-muted-foreground pl-5 mt-0.5">
                  Logged in as {fullName(profile)}
                </span>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <UserCog className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="font-semibold text-sm truncate">{fullName(profile)}</span>
                </div>
                <span className="text-xs text-muted-foreground pl-5">
                  {profile?.designation ?? 'No designation'}
                </span>
              </>
            )}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Switch operator section */}
        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground font-normal py-1">
          Switch operator
        </DropdownMenuLabel>

        <div className="max-h-52 overflow-y-auto">
          {peers.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              No other active users at this plant
            </div>
          )}
          {peers.map((p) => {
            const isSelf = p.id === user?.id;
            const isActive = (activeOperatorId ?? user?.id) === p.id;
            const isPending = pendingId === p.id;

            return (
              <DropdownMenuItem
                key={p.id}
                className={`flex items-center gap-2.5 cursor-pointer py-2 ${isActive ? 'bg-accent/10' : ''} ${isPending ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}
                onSelect={(e) => { e.preventDefault(); handleSelect(p); }}
              >
                <Avatar className="h-7 w-7 flex-shrink-0">
                  <AvatarFallback className={`text-[10px] font-semibold ${isActive ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}`}>
                    {initials(p)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {fullName(p)}
                    {isSelf && <span className="text-[10px] text-muted-foreground ml-1">(you)</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{p.designation ?? 'No designation'}</div>
                </div>
                {isActive && !isPending && (
                  <span className="h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                )}
                {isPending && (
                  <span className="text-[10px] text-amber-600 font-medium flex-shrink-0">Tap again to confirm</span>
                )}
              </DropdownMenuItem>
            );
          })}
        </div>

        <DropdownMenuSeparator />

        {/* Actions */}
        {isOverride && (
          <DropdownMenuItem onClick={clearOverride} className="text-amber-600 gap-2">
            <UserCog className="h-4 w-4" />
            Back to my profile
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => navigate('/profile')} className="gap-2">
          <UserCog className="h-4 w-4" />
          My profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut} className="text-danger gap-2">
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
