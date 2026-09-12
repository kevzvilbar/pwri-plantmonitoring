import { AlertCircle, ShieldAlert, Lock, CheckCircle2, User } from 'lucide-react';
import { format } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-picker';
import { STANDARD_OFFLINE_REASONS } from '../types';
import { WAS_ACTUALLY_RUNNING_REASON, UPTIME_EXEMPTION_SUBREASONS, isWasActuallyRunningReason } from '@/lib/trainUptimeExemption';

interface LatestStatusLog {
  status: string;
  reason?: string | null;
  confirmed_at?: string | null;
  operator?: { username?: string | null; full_name?: string | null } | null;
}

interface OfflineTrainBannerProps {
  /** Whether the operator has the train toggled to Online (form default). */
  trainOnline: boolean;
  /** DB-recorded status of the train (from ro_trains.status). */
  dbStatus: string;
  /** True when the operator has explicitly confirmed the train is back online. */
  confirmBackOnline: boolean;
  offlineReason: string;
  offlineReasonOther: string;
  offlineStart: string;
  offlineEnd: string;
  offlineReasonFinal: string;
  latestStatusLog: LatestStatusLog | null | undefined;
  /** Whether the form is fully locked (offline, no end time). */
  isOfflineBlocked: boolean;
  onConfirmBackOnline: (checked: boolean) => void;
  onOfflineReasonChange: (val: string) => void;
  onOfflineReasonOtherChange: (val: string) => void;
  onOfflineStartChange: (val: string) => void;
  onOfflineEndChange: (val: string) => void;
}

/**
 * OfflineTrainBanner
 *
 * Two parts rendered into two separate call sites:
 *   1. `<OfflineTrainBanner.Warning />` — amber "train last recorded offline" notice with
 *      confirm-back-online checkbox. Placed inside the top Card, after the status toggle.
 *   2. `<OfflineTrainBanner.Details />` — red offline event details panel (reason + times).
 *      Placed inside the top Card, below the toggle.
 *   3. `<OfflineTrainBanner.LockedCard />` — full-width red locked card shown below the
 *      top card when isOfflineBlocked is true (no end time yet).
 *
 * Props are passed through from PretreatmentAndROLog's state.
 */

export function DowntimeResolutionCard({
  train,
  offlineReason,
  offlineReasonOther,
  offlineStart,
  offlineEnd,
  isDowntimeResolved,
  onOfflineReasonChange,
  onOfflineReasonOtherChange,
  onOfflineStartChange,
  onOfflineEndChange,
}: {
  train: any;
  offlineReason: string;
  offlineReasonOther: string;
  offlineStart: string;
  offlineEnd: string;
  isDowntimeResolved: boolean;
  onOfflineReasonChange: (val: string) => void;
  onOfflineReasonOtherChange: (val: string) => void;
  onOfflineStartChange: (val: string) => void;
  onOfflineEndChange: (val: string) => void;
}) {
  const durationStr = (() => {
    if (!offlineStart || !offlineEnd) return '';
    const diffMs = new Date(offlineEnd).getTime() - new Date(offlineStart).getTime();
    if (diffMs <= 0) return '';
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.round((diffMs % 3600000) / 60000);
    if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
    if (hrs > 0) return `${hrs}h`;
    return `${mins}m`;
  })();

  const reasonDisplay = offlineReason === 'Other' ? offlineReasonOther : offlineReason;

  if (isDowntimeResolved) {
    return (
      <div className="rounded-lg border border-accent/40 bg-accent-soft/40 p-3 shadow-xs space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
            <span className="text-xs font-bold text-accent uppercase tracking-wider">
              Downtime Resolved · Inputs Unlocked
            </span>
          </div>
          {durationStr && (
            <span className="text-2xs font-semibold px-2 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent font-mono-num">
              {durationStr} downtime
            </span>
          )}
        </div>
        <div className="text-xs text-foreground/90 flex items-center justify-between gap-2 flex-wrap">
          <div>
            <span className="text-muted-foreground">Reason: </span>
            <span className="font-semibold text-foreground">{reasonDisplay || 'Unspecified'}</span>
          </div>
          {offlineStart && offlineEnd && (
            <span className="text-2xs text-muted-foreground font-mono-num">
              {format(new Date(offlineStart), 'MMM dd, HH:mm')} → {format(new Date(offlineEnd), 'MMM dd, HH:mm')}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-danger/50 bg-danger-soft/40 p-3.5 shadow-xs">
      <div className="flex items-center justify-between border-b border-danger/20 pb-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4.5 w-4.5 text-danger shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wider text-danger">
            Downtime Resolution Required
          </span>
        </div>
        <span className="text-3xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-danger/15 text-danger border border-danger/30">
          Inputs Locked
        </span>
      </div>

      <p className="text-xs text-danger/90 leading-relaxed">
        <strong>{train?.name || `Train ${train?.train_number ?? ''}`}</strong> was offline (no data logged in past hour).
        Before entering operational parameters, you must provide the reason for downtime and when it ended.
      </p>

      {/* Reason dropdown */}
      <div className="space-y-1">
        <Label htmlFor="resolve-offline-reason" className="text-xs font-medium text-foreground">
          Reason for Offline <span className="text-danger font-bold">*</span>
        </Label>
        <Select value={offlineReason} onValueChange={onOfflineReasonChange}>
          <SelectTrigger className="h-9 bg-background border-danger/40 focus:ring-danger" id="resolve-offline-reason">
            <SelectValue placeholder="Select downtime reason…" />
          </SelectTrigger>
          <SelectContent>
            {STANDARD_OFFLINE_REASONS.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
            <SelectItem value="Other">Other (specify below)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Free-text for Other */}
      {offlineReason === 'Other' && (
        <div className="space-y-1">
          <Label htmlFor="resolve-specify-reason" className="text-xs font-medium text-foreground">
            Specify Reason <span className="text-danger font-bold">*</span>
          </Label>
          <Input
            value={offlineReasonOther}
            onChange={(e) => onOfflineReasonOtherChange(e.target.value)}
            placeholder="Describe specific downtime reason…"
            className="bg-background border-danger/50"
            id="resolve-specify-reason"
          />
        </div>
      )}

      {/* Start / End times */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div className="space-y-1">
          <Label htmlFor="resolve-offline-since" className="text-xs font-medium text-foreground flex items-center gap-1">
            Offline Since <span className="text-danger font-bold">*</span>
          </Label>
          <DateTimePicker
            value={offlineStart}
            onChange={(val) => onOfflineStartChange(val)}
            placeholder="Select offline start time..."
            size="sm"
            className="w-full bg-background border-danger/50 font-mono-num"
            id="resolve-offline-since"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="resolve-back-online" className="text-xs font-medium text-foreground flex items-center gap-1">
            Back Online At <span className="text-danger font-bold">*</span>
          </Label>
          <DateTimePicker
            value={offlineEnd}
            onChange={(val) => onOfflineEndChange(val)}
            placeholder="When did downtime end..."
            size="sm"
            className="w-full bg-background border-danger/50 font-mono-num"
            id="resolve-back-online"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 text-2xs text-danger bg-danger/10 border border-danger/20 rounded px-2.5 py-1.5 font-medium">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        <span>Telemetry inputs (AFM/MMF, Boosters, RO Vessel) will unlock as soon as downtime reason and times are specified.</span>
      </div>
    </div>
  );
}

export function OfflineWarningNotice({
  trainOnline,
  dbStatus,
  confirmBackOnline,
  onConfirmBackOnline,
}: Pick<OfflineTrainBannerProps, 'trainOnline' | 'dbStatus' | 'confirmBackOnline' | 'onConfirmBackOnline'>) {
  if (!trainOnline || dbStatus !== 'Offline') return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warn/70 bg-warn-soft/80 p-3 shadow-xs">
      <AlertCircle className="h-4.5 w-4.5 text-warn mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-xs font-bold text-warn uppercase tracking-wider">Train Last Recorded as Offline</p>
        <p className="text-xs text-warn/90 leading-relaxed">
          The system database records this train as currently offline. If it has resumed operation, tick the confirmation below and submit a reading — the offline status will clear automatically.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="confirm-back-online"
            checked={confirmBackOnline}
            onCheckedChange={(c) => onConfirmBackOnline(!!c)}
            className="h-4 w-4 data-[state=checked]:bg-warn data-[state=checked]:border-warn"
          />
          <label htmlFor="confirm-back-online" className="text-xs font-semibold text-warn cursor-pointer select-none">
            Confirm train is back online and clear Offline status on save.
          </label>
        </div>
      </div>
    </div>
  );
}

export function OfflineDetailsPanel({
  offlineReason,
  offlineReasonOther,
  exemptionSubreason,
  exemptionDetail,
  offlineStart,
  offlineEnd,
  latestStatusLog,
  onOfflineReasonChange,
  onOfflineReasonOtherChange,
  onExemptionSubreasonChange,
  onExemptionDetailChange,
  onOfflineStartChange,
  onOfflineEndChange,
  onReportRunningInstead,
}: Pick<OfflineTrainBannerProps,
  'offlineReason' | 'offlineReasonOther' | 'offlineStart' | 'offlineEnd' |
  'latestStatusLog' | 'onOfflineReasonChange' | 'onOfflineReasonOtherChange' |
  'onOfflineStartChange' | 'onOfflineEndChange'
> & {
  /** "Was actually running" exemption sub-reason (operator_failed_to_encode | system_error | other). */
  exemptionSubreason: string;
  /** Free-text detail for the exemption (required when sub-reason is "other"). */
  exemptionDetail: string;
  onExemptionSubreasonChange: (val: string) => void;
  onExemptionDetailChange: (val: string) => void;
  /** Banner-level shortcut: pre-selects the exemption instead of downtime. Only shown for auto-flagged trains. */
  onReportRunningInstead?: () => void;
}) {
  const isExemption = isWasActuallyRunningReason(offlineReason);
  const showAutoFlagShortcut = !!onReportRunningInstead && !isExemption
    && !!latestStatusLog?.reason?.startsWith('Auto-flagged');
  return (
    <div className="space-y-3 rounded-lg border border-danger/40 bg-danger-soft/40 p-3.5 shadow-xs backdrop-blur-2xs">
      <div className="flex items-center justify-between border-b border-danger/20 pb-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-danger" />
          <span className="text-xs font-bold uppercase tracking-wider text-danger">Offline Event Details</span>
        </div>
        <span className="text-3xs font-medium text-danger/80">Required to register downtime</span>
      </div>

      {/* User Accountability Banner */}
      {latestStatusLog?.status === 'Offline' && (
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-background/90 border border-danger/30 text-xs shadow-2xs">
          <div className="h-6 w-6 rounded-full bg-danger/10 text-danger flex items-center justify-center shrink-0">
            <User className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 min-w-0 flex items-center justify-between flex-wrap gap-1">
            <div>
              <span className="text-muted-foreground">Previously set to Offline by: </span>
              <span className="font-bold text-danger">
                {latestStatusLog.operator?.username ?? latestStatusLog.operator?.full_name ?? 'Unknown Operator'}
              </span>
            </div>
            {latestStatusLog.confirmed_at && (
              <span className="text-2xs text-muted-foreground font-mono-num">
                ({format(new Date(latestStatusLog.confirmed_at), 'MMM dd, yyyy HH:mm')})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Reason dropdown */}
      <div className="space-y-1">
        <Label htmlFor="pretreat-reason-for-offline" className="text-xs font-medium text-foreground">
          Reason for Offline <span className="text-danger font-bold">*</span>
        </Label>
        <Select value={offlineReason} onValueChange={onOfflineReasonChange}>
          <SelectTrigger className="h-9 bg-background border-danger/40 focus:ring-danger" id="pretreat-reason-for-offline">
            <SelectValue placeholder="Select downtime reason…" />
          </SelectTrigger>
          <SelectContent>
            {STANDARD_OFFLINE_REASONS.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
            <SelectItem value="Other">Other (specify below)</SelectItem>
            <SelectItem value={WAS_ACTUALLY_RUNNING_REASON}>↩ Was actually running — failed to encode</SelectItem>
          </SelectContent>
        </Select>
        {showAutoFlagShortcut && (
          <button
            type="button"
            onClick={onReportRunningInstead}
            className="text-2xs font-semibold text-accent hover:underline pt-0.5"
          >
            ↩ Was actually running? Report instead of logging downtime
          </button>
        )}
      </div>

      {/* Exemption sub-reason: the train never stopped, only the encoding did */}
      {isExemption && (
        <div className="space-y-2 rounded-md border border-accent/40 bg-accent-soft/40 p-2.5">
          <div className="space-y-1">
            <Label htmlFor="pretreat-exemption-subreason" className="text-xs font-medium text-foreground">
              Why is there a reading gap? <span className="text-danger font-bold">*</span>
            </Label>
            <Select value={exemptionSubreason} onValueChange={onExemptionSubreasonChange}>
              <SelectTrigger className="h-9 bg-background border-accent/50 focus:ring-accent" id="pretreat-exemption-subreason">
                <SelectValue placeholder="Select why readings were not encoded…" />
              </SelectTrigger>
              <SelectContent>
                {UPTIME_EXEMPTION_SUBREASONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(exemptionSubreason === 'other' || exemptionSubreason === 'system_error') && (
            <div className="space-y-1">
              <Label htmlFor="pretreat-exemption-detail" className="text-xs font-medium text-foreground">
                Details {exemptionSubreason === 'other' && <span className="text-danger font-bold">*</span>}
              </Label>
              <Input
                value={exemptionDetail}
                onChange={(e) => onExemptionDetailChange(e.target.value)}
                placeholder={exemptionSubreason === 'other' ? 'Explain what happened…' : 'Optional: which system, what error…'}
                className="bg-background border-accent/50"
                id="pretreat-exemption-detail"
              />
            </div>
          )}
          <p className="text-2xs text-muted-foreground leading-relaxed">
            This files an attestation that the train kept running — the auto-flag is removed, no downtime is
            recorded, and Back Online At is not applicable.
          </p>
        </div>
      )}

      {/* Free-text for Other */}
      {offlineReason === 'Other' && (
        <div className="space-y-1">
          <Label htmlFor="pretreat-specify-reason" className="text-xs font-medium text-foreground">
            Specify Reason <span className="text-danger font-bold">*</span>
          </Label>
          <Input
            value={offlineReasonOther}
            onChange={(e) => onOfflineReasonOtherChange(e.target.value)}
            placeholder="Describe specific downtime reason…"
            className="bg-background border-danger/50"
            id="pretreat-specify-reason"
          />
        </div>
      )}

      {/* Offline start / end times */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div className="space-y-1">
          <Label htmlFor="pretreat-offline-since" className="text-xs font-medium text-foreground flex items-center gap-1">
            Offline Since <span className="text-danger font-bold">*</span>
            {isExemption && (
              <span className="text-3xs text-muted-foreground">(gap start — read-only)</span>
            )}
          </Label>
          <DateTimePicker
            value={offlineStart}
            onChange={(val) => onOfflineStartChange(val)}
            placeholder="Select offline start time..."
            size="sm"
            className="w-full bg-background border-danger/50 font-mono-num"
            id="pretreat-offline-since"
            disabled={isExemption}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="pretreat-back-online-at" className="text-xs font-medium text-foreground">
              Back Online At
            </Label>
            {isExemption
              ? <span className="text-3xs text-muted-foreground">(not applicable — train never stopped)</span>
              : <span className="text-3xs text-muted-foreground">(optional)</span>}
          </div>
          <DateTimePicker
            value={offlineEnd}
            onChange={(val) => onOfflineEndChange(val)}
            placeholder={isExemption ? 'Not applicable when train kept running…' : 'Leave blank if still offline...'}
            size="sm"
            className="w-full bg-background border-danger/50 font-mono-num"
            id="pretreat-back-online-at"
            disabled={isExemption}
          />
        </div>
      </div>

      {/* Status Live Notification */}
      {isExemption && offlineStart ? (
        <div className="flex items-center gap-2 text-xs text-accent bg-accent-soft/90 border border-accent/30 rounded-md px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
          <span><strong>Exemption — train kept running:</strong> Offline Since and Back Online At are locked (the train never stopped). Filing removes the auto-flag and restores Running without recording downtime.</span>
        </div>
      ) : (
      <>
      {!offlineEnd && offlineStart && (
        <div className="flex items-center gap-2 text-xs text-danger bg-danger-soft/90 border border-danger/30 rounded-md px-3 py-2">
          <span className="inline-block h-2 w-2 rounded-full bg-danger animate-pulse shrink-0" />
          <span><strong>Train is currently Offline:</strong> RO parameters are locked until the train comes back online.</span>
        </div>
      )}
      {offlineEnd && offlineStart && (
        <div className="flex items-center gap-2 text-xs text-accent bg-accent-soft/90 border border-accent/30 rounded-md px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
          <span><strong>Offline duration logged:</strong> You may now log RO parameters for the resumed operational period.</span>
        </div>
      )}
      </>
      )}
    </div>
  );
}

export function OfflineLockedCard({
  offlineReasonFinal,
  offlineStart,
  latestStatusLog,
  trainOnline = false,
  onReportRunningInstead,
}: Pick<OfflineTrainBannerProps, 'offlineReasonFinal' | 'offlineStart' | 'latestStatusLog'> & {
  trainOnline?: boolean;
  /** Banner-level shortcut into the exemption (only offered for auto-flagged trains). */
  onReportRunningInstead?: () => void;
}) {
  const isPendingDowntimeResolution = trainOnline;
  const isAutoFlagged = !!latestStatusLog?.reason?.startsWith('Auto-flagged');

  return (
    <Card className="p-4 border-danger/70 bg-danger-soft/80 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-danger/10 text-danger flex items-center justify-center shrink-0 border border-danger/20">
          <Lock className="h-5 w-5" />
        </div>
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-bold text-danger">
              {isPendingDowntimeResolution
                ? 'Operational Telemetry Locked — Downtime Resolution Required'
                : 'RO Train is Currently Offline'}
            </p>
            {latestStatusLog?.status === 'Offline' && (
              <span className="text-2xs font-semibold text-danger/90 bg-danger/10 px-2 py-0.5 rounded-full border border-danger/20 flex items-center gap-1">
                <User className="h-3 w-3" />
                <span>Logged by {latestStatusLog.operator?.username ?? latestStatusLog.operator?.full_name ?? 'Operator'}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-danger/90 leading-relaxed">
            {isPendingDowntimeResolution
              ? 'Telemetry inputs cannot be entered until the downtime reason and back-online timestamp are specified in the Downtime Resolution section above.'
              : <>Telemetry inputs are locked while the train is down. To record this offline session, click <strong>Save Offline Record</strong> below. If the train has resumed operation, toggle to <em>Operational / Running</em> and resolve the downtime.</>}
          </p>
          {onReportRunningInstead && isAutoFlagged && !isPendingDowntimeResolution && (
            <div className="pt-1">
              <button
                type="button"
                onClick={onReportRunningInstead}
                className="text-2xs font-semibold text-accent hover:underline"
              >
                ↩ Was actually running? Report instead — no downtime, no Back Online At
              </button>
            </div>
          )}
          {(offlineReasonFinal || latestStatusLog?.reason) && (
            <div className="pt-1.5 text-2xs text-danger/80 border-t border-danger/20 flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold">Reason for Offline:</span>
              <span className="italic font-medium">{offlineReasonFinal || latestStatusLog?.reason}</span>
              {offlineStart && (
                <span className="ml-auto font-mono-num">
                  (Since {format(new Date(offlineStart), 'MMM dd, yyyy HH:mm')})
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
