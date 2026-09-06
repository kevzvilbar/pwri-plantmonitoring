import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { BOOSTER_REASON_OPTIONS, HPP_REASON_OPTIONS, getUnitReasonText } from '../types';
import { PerUnitReasonRow } from './PerUnitReasonRow';

export interface BoosterPumpSectionProps {
  train: any;
  numBoosterPumps: number;
  boosters: Record<number, { hz: string; target: string; amp: string; psiMode: boolean }>;
  setBoosters: (v: Record<number, { hz: string; target: string; amp: string; psiMode: boolean }>) => void;
  boosterConfig: { psiMode: boolean; targets: Record<string, number> } | null;
  boosterPrefPsi: boolean;
  setBoosterPrefPsi: (v: boolean) => void;
  BOOSTER_MODE_KEY: string;
  hppTarget: string;
  setHppTarget: (v: string) => void;
  bagsChanged: string;
  setBagsChanged: (v: string) => void;
  boosterHppSectionStarted: boolean;
  setBoosterHppSectionStarted: (v: boolean) => void;
  boosterReasonNeeded: boolean;
  setBoosterReasonNeeded: (v: boolean) => void;
  boosterUnitReasons: Record<number, { reason: string; custom: string }>;
  setBoosterUnitReasons: (v: Record<number, { reason: string; custom: string }> | ((prev: Record<number, { reason: string; custom: string }>) => Record<number, { reason: string; custom: string }>)) => void;
  hppUnitReason: { reason: string; custom: string };
  setHppUnitReason: (v: { reason: string; custom: string } | ((prev: { reason: string; custom: string }) => { reason: string; custom: string })) => void;
}

export function BoosterPumpSection({
  train,
  numBoosterPumps,
  boosters,
  setBoosters,
  boosterConfig,
  boosterPrefPsi,
  setBoosterPrefPsi,
  BOOSTER_MODE_KEY,
  hppTarget,
  setHppTarget,
  bagsChanged,
  setBagsChanged,
  boosterHppSectionStarted,
  setBoosterHppSectionStarted,
  boosterReasonNeeded,
  setBoosterReasonNeeded,
  boosterUnitReasons,
  setBoosterUnitReasons,
  hppUnitReason,
  setHppUnitReason,
}: BoosterPumpSectionProps) {
  return (
    <>
      {(() => {
        const anyPsi = Object.values(boosters).some(b => b.psiMode !== false);
        const globalPsiMode = Object.keys(boosters).length === 0 ? boosterPrefPsi : anyPsi;
        const setGlobalMode = (psi: boolean) => {
          if (boosterConfig) return;
          setBoosterPrefPsi(psi);
          try { localStorage.setItem(BOOSTER_MODE_KEY, String(psi)); } catch { /* best-effort persist — ignore */ }
          const next: typeof boosters = {};
          Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).forEach(u => {
            const b = boosters[u] || { hz: '', target: '', amp: '', psiMode: boosterPrefPsi };
            next[u] = { ...b, psiMode: psi, hz: '', target: '' };
          });
          setBoosters(next);
        };
        return (
          <>
            {train.num_booster_pumps > 0 && (
              <Card className="p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    Booster Pumps ({train.num_booster_pumps})
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Target</span>
                    <div className={cn(
                      'flex rounded-full border border-border overflow-hidden text-xs font-semibold',
                      boosterConfig && 'opacity-60',
                    )}>
                      <button
                        type="button"
                        onClick={() => setGlobalMode(true)}
                        disabled={!!boosterConfig}
                        title={boosterConfig ? 'Mode is set in Train Settings' : undefined}
                        className={cn(
                          'px-3 py-1 transition-colors',
                          boosterConfig && 'cursor-not-allowed',
                          globalPsiMode
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background text-muted-foreground hover:bg-muted'
                        )}
                      >psi</button>
                      <button
                        type="button"
                        onClick={() => setGlobalMode(false)}
                        disabled={!!boosterConfig}
                        title={boosterConfig ? 'Mode is set in Train Settings' : undefined}
                        className={cn(
                          'px-3 py-1 transition-colors',
                          boosterConfig && 'cursor-not-allowed',
                          !globalPsiMode
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background text-muted-foreground hover:bg-muted'
                        )}
                      >Hz</button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-[72px_1fr_1fr_1fr] gap-x-3 gap-y-0 items-end">
                  <div />
                  <div className="text-xs text-muted-foreground font-medium text-center">psi</div>
                  <div className="text-xs text-muted-foreground font-medium text-center">Hz</div>
                  <div className="text-xs text-muted-foreground font-medium text-center">Amperage (A)</div>
                </div>

                <div className="space-y-2">
                  {Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).map((u) => {
                    const b = boosters[u] || { hz: '', target: '', amp: '', psiMode: boosterPrefPsi };
                    const psiMode = b.psiMode !== false;
                    const pumpConfigured = boosterConfig?.targets[String(u)] != null;
                    const setB = (patch: Partial<typeof b>) =>
                      setBoosters({ ...boosters, [u]: { ...b, ...patch } });
                    return (
                      <div key={u} className="border rounded-md p-2 space-y-2">
                        <div className="grid grid-cols-[72px_1fr_1fr_1fr] gap-x-3 items-center">
                          <span className="text-sm font-semibold text-foreground">Pump {u}</span>
                          <Input
                            type="number" step="any"
                            value={psiMode ? b.target : ''}
                            disabled={!psiMode || pumpConfigured}
                            readOnly={pumpConfigured}
                            placeholder={psiMode ? 'Enter psi' : '—'}
                            title={pumpConfigured ? 'Set in Train Settings' : undefined}
                            className={cn(
                              'text-center placeholder:text-2xs placeholder:text-muted-foreground/40 rounded-lg',
                              !psiMode && 'opacity-35 cursor-not-allowed bg-muted/30',
                              psiMode && pumpConfigured && 'bg-muted/40'
                            )}
                            onChange={(e) => setB({ target: e.target.value })}
                          />
                          <Input
                            type="number" step="any"
                            value={!psiMode ? b.hz : ''}
                            disabled={psiMode || pumpConfigured}
                            readOnly={pumpConfigured}
                            placeholder={!psiMode ? 'Enter Hz' : '—'}
                            title={pumpConfigured ? 'Set in Train Settings' : undefined}
                            className={cn(
                              'text-center placeholder:text-2xs placeholder:text-muted-foreground/40 rounded-lg',
                              psiMode && 'opacity-35 cursor-not-allowed bg-muted/30',
                              !psiMode && pumpConfigured && 'bg-muted/40'
                            )}
                            onChange={(e) => setB({ hz: e.target.value })}
                          />
                          <Input
                            type="number" step="any"
                            value={b.amp}
                            placeholder="Enter A"
                            className="text-center placeholder:text-2xs placeholder:text-muted-foreground/40 rounded-lg"
                            onChange={(e) => setB({ amp: e.target.value })}
                          />
                        </div>

                        {(() => {
                          const hasTarget = psiMode ? !!b.target : !!b.hz;
                          const hasAmp = !!b.amp;
                          const isPumpComplete = hasTarget && hasAmp;
                          if (boosterReasonNeeded && !isPumpComplete) {
                            return (
                              <PerUnitReasonRow
                                unitLabel={`Booster Pump ${u}`}
                                options={BOOSTER_REASON_OPTIONS}
                                value={boosterUnitReasons[u]?.reason}
                                customValue={boosterUnitReasons[u]?.custom}
                                onChange={(val) => setBoosterUnitReasons((prev: Record<number, { reason: string; custom: string }>) => ({
                                  ...prev,
                                  [u]: { reason: val, custom: val === 'Other' ? (prev[u]?.custom || '') : '' }
                                }))}
                                onCustomChange={(val) => setBoosterUnitReasons((prev: Record<number, { reason: string; custom: string }>) => ({
                                  ...prev,
                                  [u]: { reason: prev[u]?.reason || 'Other', custom: val }
                                }))}
                                onApplyAll={() => {
                                  const cur = boosterUnitReasons[u];
                                  if (!cur?.reason) {
                                    toast.error(`Select a reason for Booster Pump ${u} first before applying to all.`);
                                    return;
                                  }
                                  const next = { ...boosterUnitReasons };
                                  Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).forEach((idx) => {
                                    const rowB = boosters[idx] || { hz: '', target: '', amp: '', psiMode: boosterPrefPsi };
                                    const rowPsiMode = rowB.psiMode !== false;
                                    const rowTarget = rowPsiMode ? !!rowB.target : !!rowB.hz;
                                    const rowAmp = !!rowB.amp;
                                    if (!(rowTarget && rowAmp)) {
                                      next[idx] = { ...cur };
                                    }
                                  });
                                  setBoosterUnitReasons(next);
                                  toast.success('Applied reason to all incomplete Booster Pumps.');
                                }}
                                applyAllLabel="Apply reason to all incomplete Booster Pumps"
                              />
                            );
                          }
                          return null;
                        })()}
                      </div>
                    );
                  })}
                </div>

                <p className="text-3xs text-muted-foreground/50 italic">
                  {boosterConfig
                    ? `${globalPsiMode ? 'psi' : 'Hz'} mode — set in Train Settings, applies to all pumps on this train.`
                    : globalPsiMode ? 'psi mode — Hz column locked. Tap psi/Hz to switch.' : 'Hz mode — psi column locked. Tap psi/Hz to switch.'}
                </p>
              </Card>
            )}

            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">High-Pressure Pump</h4>
              <div>
                <Label htmlFor="pretreat-hpp-target-pressure-psi" className="text-xs text-muted-foreground">HPP Target Pressure (psi)</Label>
                {train?.hpp_target_pressure_psi != null ? (
                  <>
                    <Input type="number" step="any" value={hppTarget} readOnly disabled
                      className="font-mono-num bg-muted/40" id="pretreat-hpp-target-pressure-psi"/>
                    <p className="text-2xs text-muted-foreground mt-1">
                      Set in Train Settings — applies to every reading until changed there.
                    </p>
                  </>
                ) : (
                  <Input type="number" step="any" value={hppTarget} onChange={(e) => setHppTarget(e.target.value)} />
                )}
              </div>

              {boosterReasonNeeded && !(train?.hpp_target_pressure_psi != null || hppTarget) && (
                <PerUnitReasonRow
                  unitLabel="High-Pressure Pump"
                  options={HPP_REASON_OPTIONS}
                  value={hppUnitReason.reason}
                  customValue={hppUnitReason.custom}
                  onChange={(val) => setHppUnitReason((prev: { reason: string; custom: string }) => ({
                    ...prev,
                    reason: val,
                    custom: val === 'Other' ? prev.custom : ''
                  }))}
                  onCustomChange={(val) => setHppUnitReason((prev: { reason: string; custom: string }) => ({
                    ...prev,
                    reason: prev.reason || 'Other',
                    custom: val
                  }))}
                />
              )}
            </Card>

            {!boosterHppSectionStarted && (
              <Card className="p-3">
                <Button
                  type="button"
                  size="sm"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                  onClick={() => {
                    const unreasonedPumps: number[] = [];
                    let hasIncomplete = false;

                    Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).forEach((u) => {
                      const b = boosters[u];
                      const psiMode = b?.psiMode !== false;
                      const hasTarget = psiMode ? !!b?.target : !!b?.hz;
                      const hasAmp = !!b?.amp;
                      if (!(hasTarget && hasAmp)) {
                        hasIncomplete = true;
                        if (!getUnitReasonText(boosterUnitReasons[u])) {
                          unreasonedPumps.push(u);
                        }
                      }
                    });

                    const isHppConfigured = train?.hpp_target_pressure_psi != null;
                    const isHppFilled = isHppConfigured || !!hppTarget;
                    let unreasonedHpp = false;
                    if (!isHppFilled) {
                      hasIncomplete = true;
                      if (!getUnitReasonText(hppUnitReason)) {
                        unreasonedHpp = true;
                      }
                    }

                    if (hasIncomplete) {
                      setBoosterReasonNeeded(true);
                      if (unreasonedPumps.length > 0 || unreasonedHpp) {
                        const parts: string[] = [];
                        if (unreasonedPumps.length > 0) {
                          parts.push(`Booster Pump ${unreasonedPumps.join(', ')}`);
                        }
                        if (unreasonedHpp) {
                          parts.push('High-Pressure Pump');
                        }
                        toast.error(
                          `Missing reading for ${parts.join(' and ')}: please specify a reason for each incomplete unit.`,
                        );
                        return;
                      }
                    }
                    setBoosterHppSectionStarted(true);
                  }}
                >
                  Proceed to Cartridge Housing / Bag Filter →
                </Button>
                <p className="text-2xs text-muted-foreground text-center mt-1">
                  Fill in every Booster Pump & HPP field above, or provide a reason for incomplete units to proceed.
                </p>
              </Card>
            )}
          </>
        );
      })()}
    </>
  );
}
