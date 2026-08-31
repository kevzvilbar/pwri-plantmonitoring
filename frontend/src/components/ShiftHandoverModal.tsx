import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, type Profile } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  getCurrentShift,
  getShiftCycleKey,
  getStoredShiftConfirmation,
  saveShiftConfirmation,
  type ShiftInfo,
} from '@/lib/shifts';
import { Clock, UserCheck, Users, LogOut, ArrowRight, CheckCircle2, ShieldCheck, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

function initials(p: Profile | null): string {
  if (!p) return '?';
  return ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase() || '?';
}

function fullName(p: Profile | null): string {
  if (!p) return 'Unknown';
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || 'Unknown';
}

export function ShiftHandoverModal() {
  const { user, profile, activeOperator, signOut } = useAuth();
  const { activeOperatorId, setActiveOperatorId, selectedPlantId } = useAppStore();

  const [isOpen, setIsOpen] = useState(false);
  const [currentShift, setCurrentShift] = useState<ShiftInfo>(() => getCurrentShift());
  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [peerOperators, setPeerOperators] = useState<Profile[]>([]);
  const [loadingPeers, setLoadingPeers] = useState(false);
  const [switching, setSwitching] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');

  const currentOperator = activeOperator ?? profile;
  const currentOperatorId = activeOperatorId ?? user?.id ?? '';

  // Check if current shift cycle has been verified by the logged operator
  const checkShift = useCallback(() => {
    if (!user || !profile) {
      setIsOpen(false);
      return;
    }

    // Only apply handover checks for operator roles or active operator sessions
    const isOperator = profile.designation === 'Operator' || profile.designation === 'Technician' || activeOperatorId !== null;
    if (!isOperator) {
      setIsOpen(false);
      return;
    }

    const now = new Date();
    const shift = getCurrentShift(now);
    const cycleKey = getShiftCycleKey(now);
    setCurrentShift(shift);

    const stored = getStoredShiftConfirmation(user.id, currentOperatorId);

    // If no confirmation or cycle/operator changed, trigger the prompt
    if (!stored || stored.cycleKey !== cycleKey || stored.operatorId !== currentOperatorId) {
      setIsOpen(true);
      setShowSwitchPicker(false);
      setSearchTerm('');
    } else {
      setIsOpen(false);
    }
  }, [user, profile, activeOperatorId, currentOperatorId]);

  // Periodic check (every 30s) + on tab focus / visibility change
  useEffect(() => {
    checkShift();
    const interval = setInterval(checkShift, 30_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkShift();
      }
    };

    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', checkShift);

    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', checkShift);
    };
  }, [checkShift]);

  // Fetch peer operators on the same plant when handover is selected
  const loadPeerOperators = async () => {
    setLoadingPeers(true);
    try {
      const plantAssignments = profile?.plant_assignments ?? (selectedPlantId ? [selectedPlantId] : []);
      
      const query = supabase
        .from('user_profiles')
        .select('*')
        .eq('status', 'Active')
        .in('designation', ['Operator', 'Technician'])
        .order('first_name');

      if (plantAssignments.length > 0) {
        const results = await Promise.all(
          plantAssignments.map((pid) =>
            supabase
              .from('user_profiles')
              .select('*')
              .eq('status', 'Active')
              .in('designation', ['Operator', 'Technician'])
              .contains('plant_assignments', [pid])
              .order('first_name'),
          ),
        );

        const seen = new Set<string>();
        const merged: Profile[] = [];
        for (const { data } of results) {
          for (const row of data ?? []) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              merged.push(row as Profile);
            }
          }
        }
        if (merged.length > 0) {
          setPeerOperators(merged.sort((a, b) => (a.first_name ?? '').localeCompare(b.first_name ?? '')));
          return;
        }
      }

      // Fallback: fetch all active operators/technicians
      const { data } = await query;
      setPeerOperators((data as Profile[]) ?? []);
    } catch (err) {
      console.error('[ShiftHandover] Failed to load peer operators:', err);
    } finally {
      setLoadingPeers(false);
    }
  };

  // Option 1: Confirm same operator continuing
  const handleConfirmSame = () => {
    if (!user) return;
    const now = new Date();
    const cycleKey = getShiftCycleKey(now);

    saveShiftConfirmation(user.id, {
      cycleKey,
      operatorId: currentOperatorId,
      confirmedAt: now.toISOString(),
      confirmedBy: user.email ?? 'unknown',
    });

    toast.success(`Confirmed: Continuing as ${fullName(currentOperator)} for ${currentShift.name}`, {
      icon: <CheckCircle2 className="h-4 w-4 text-accent" />,
      duration: 5000,
    });
    setIsOpen(false);
  };

  // Option 2: Choose different person taking over
  const handleInitiateSwitch = async () => {
    setShowSwitchPicker(true);
    await loadPeerOperators();
  };

  // Switch to peer operator account
  const handleSelectNewOperator = async (newOp: Profile) => {
    if (!user) return;
    setSwitching(true);

    try {
      const now = new Date();
      const cycleKey = getShiftCycleKey(now);
      const targetPlants: string[] = newOp.plant_assignments ?? [];
      const sessionPlants: string[] = profile?.plant_assignments ?? [];
      const sharedPlant = sessionPlants.find((pid) => targetPlants.includes(pid)) ?? selectedPlantId ?? '';

      // Set active operator in store
      if (newOp.id === user.id) {
        setActiveOperatorId(null);
      } else {
        setActiveOperatorId(newOp.id);
      }

      // Log switch event in Supabase audit
      if (sharedPlant) {
        try {
          await supabase.from('operator_switch_log' as any).insert({
            plant_id: sharedPlant,
            from_operator_id: currentOperatorId,
            to_operator_id: newOp.id,
            switched_by: user.id,
          });
        } catch (auditErr) {
          console.warn('[ShiftHandoverModal] Audit log write failed:', auditErr);
        }
      }

      // Record shift confirmation for the new operator
      saveShiftConfirmation(user.id, {
        cycleKey,
        operatorId: newOp.id,
        confirmedAt: now.toISOString(),
        confirmedBy: user.email ?? 'unknown',
      });

      toast.success(`Handover complete: Now recording as ${fullName(newOp)} for ${currentShift.name}`);
      setIsOpen(false);
      setShowSwitchPicker(false);
    } catch (err: any) {
      toast.error('Failed to complete operator switch');
    } finally {
      setSwitching(false);
    }
  };

  const filteredPeers = peerOperators.filter((p) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const name = fullName(p).toLowerCase();
    const un = (p.username ?? '').toLowerCase();
    return name.includes(term) || un.includes(term);
  });

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => { /* Prevent backdrop click dismiss */ }}>
      <DialogContent
        className="max-w-md p-6 bg-card border-border/80 shadow-2xl rounded-2xl sm:rounded-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-3">
          {/* Shift Indicator Pill */}
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-soft text-accent border border-accent/40 text-xs font-bold font-mono-num">
              <Clock className="h-3.5 w-3.5 animate-pulse" />
              <span>{currentShift.name}</span>
              <span className="text-3xs font-medium opacity-80">({currentShift.timeRange})</span>
            </div>
            <span className="text-3xs font-bold uppercase tracking-wider text-muted-foreground px-2 py-0.5 bg-muted rounded">
              8-Hr Shift Check
            </span>
          </div>

          <DialogTitle className="text-lg font-bold text-foreground">
            Shift Handover Verification
          </DialogTitle>

          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            A shift transition has occurred. If multiple operators share this terminal account, please confirm who is actively on-duty so all readings and telemetry are correctly attributed.
          </DialogDescription>
        </DialogHeader>

        {/* Current Active Account Box */}
        <div className="my-2 p-3.5 rounded-xl bg-muted/40 border border-border/70 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Current Active Operator</span>
            <span className="text-3xs text-muted-foreground/80 truncate max-w-[180px]">Shared Login: {user?.email}</span>
          </div>
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 shrink-0 border border-border">
              <AvatarFallback className="bg-primary/20 text-primary font-bold text-sm">
                {initials(currentOperator)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-foreground truncate">
                  {fullName(currentOperator)}
                </p>
                <span className="text-3xs font-semibold px-1.5 py-0.2 rounded bg-primary-soft text-primary">
                  {currentOperator?.designation ?? 'Operator'}
                </span>
              </div>
              <p className="text-xs text-accent font-medium truncate">
                {currentOperator?.username ? `@${currentOperator.username}` : 'Terminal Profile'}
              </p>
            </div>
            <ShieldCheck className="h-5 w-5 text-accent shrink-0" />
          </div>
        </div>

        {!showSwitchPicker ? (
          <div className="space-y-4 pt-1">
            <p className="text-xs font-semibold text-foreground text-center px-3 py-2 rounded-lg bg-accent-soft/40 border border-accent/20">
              “Are you still <strong>{fullName(currentOperator)}</strong> for this shift, or is another operator taking over?”
            </p>

            <div className="flex flex-col gap-2.5">
              {/* Option 1: Same Operator Continuing */}
              <Button
                onClick={handleConfirmSame}
                className="w-full h-11 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm rounded-xl gap-2 justify-center"
              >
                <UserCheck className="h-4 w-4" />
                I am still {fullName(currentOperator)} (Continue Shift)
              </Button>

              {/* Option 2: Different Person Taking Over */}
              <Button
                variant="outline"
                onClick={handleInitiateSwitch}
                className="w-full h-11 text-xs font-bold border-warn/60 bg-warn-soft/20 hover:bg-warn-soft/40 text-warn-foreground hover:text-warn rounded-xl gap-2 justify-center"
              >
                <Users className="h-4 w-4 text-warn" />
                Different operator taking over (Switch Profile)
              </Button>
            </div>
          </div>
        ) : (
          /* Handover / Peer Operator Switcher View */
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-foreground">Select Your Operator Profile</p>
              <button
                onClick={() => setShowSwitchPicker(false)}
                className="text-2xs text-muted-foreground hover:text-foreground underline"
              >
                Back
              </button>
            </div>

            {/* Quick Search */}
            {peerOperators.length > 3 && (
              <input
                type="text"
                placeholder="Search operator name or @handle..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-muted/60 border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}

            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {loadingPeers ? (
                <p className="text-xs text-muted-foreground text-center py-4">Loading active operators...</p>
              ) : filteredPeers.length === 0 ? (
                <div className="text-center py-4 space-y-1">
                  <AlertCircle className="h-5 w-5 text-muted-foreground mx-auto" />
                  <p className="text-xs text-muted-foreground">No matching operator profiles found.</p>
                </div>
              ) : (
                filteredPeers.map((p) => {
                  const isCurrent = p.id === currentOperatorId;
                  return (
                    <button
                      key={p.id}
                      disabled={switching}
                      onClick={() => handleSelectNewOperator(p)}
                      className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors ${
                        isCurrent
                          ? 'border-primary/40 bg-primary-soft/30'
                          : 'border-border/60 hover:border-accent hover:bg-accent-soft/20'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="text-3xs font-bold bg-muted">
                            {initials(p)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{fullName(p)}</p>
                          <p className="text-3xs text-muted-foreground">
                            {p.username ? `@${p.username}` : p.designation ?? 'Operator'}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-2xs font-bold text-accent flex items-center gap-1">
                        {isCurrent ? 'Current' : 'Select'} <ArrowRight className="h-3 w-3" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Alternative: Full Sign Out */}
            <div className="pt-2 border-t border-border/50 flex items-center justify-between">
              <span className="text-2xs text-muted-foreground">Need a different login?</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 h-8 px-2.5"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign in with another email
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

