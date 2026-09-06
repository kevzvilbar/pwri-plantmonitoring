import { AlertCircle, ShieldAlert, Lock, CheckCircle2, User } from 'lucide-react';
import { format } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-picker';
import { STANDARD_OFFLINE_REASONS } from '../types';

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
  offlineStart,
  offlineEnd,
  latestStatusLog,
  onOfflineReasonChange,
  onOfflineReasonOtherChange,
  onOfflineStartChange,
  onOfflineEndChange,
}: Pick<OfflineTrainBannerProps,
  'offlineReason' | 'offlineReasonOther' | 'offlineStart' | 'offlineEnd' |
  'latestStatusLog' | 'onOfflineReasonChange' | 'onOfflineReasonOtherChange' |
  'onOfflineStartChange' | 'onOfflineEndChange'
>) {
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
          </SelectContent>
        </Select>
      </div>

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
          </Label>
          <DateTimePicker
            value={offlineStart}
            onChange={(val) => onOfflineStartChange(val)}
            placeholder="Select offline start time..."
            size="sm"
            className="w-full bg-background border-danger/50 font-mono-num"
            id="pretreat-offline-since"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="pretreat-back-online-at" className="text-xs font-medium text-foreground">
              Back Online At
            </Label>
            <span className="text-3xs text-muted-foreground">(optional)</span>
          </div>
          <DateTimePicker
            value={offlineEnd}
            onChange={(val) => onOfflineEndChange(val)}
            placeholder="Leave blank if still offline..."
            size="sm"
            className="w-full bg-background border-danger/50 font-mono-num"
            id="pretreat-back-online-at"
          />
        </div>
      </div>

      {/* Status Live Notification */}
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
    </div>
  );
}

export function OfflineLockedCard({
  offlineReasonFinal,
  offlineStart,
  latestStatusLog,
}: Pick<OfflineTrainBannerProps, 'offlineReasonFinal' | 'offlineStart' | 'latestStatusLog'>) {
  return (
    <Card className="p-4 border-danger/70 bg-danger-soft/80 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-danger/10 text-danger flex items-center justify-center shrink-0 border border-danger/20">
          <Lock className="h-5 w-5" />
        </div>
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-bold text-danger">RO Train is Currently Offline</p>
            {latestStatusLog?.status === 'Offline' && (
              <span className="text-2xs font-semibold text-danger/90 bg-danger/10 px-2 py-0.5 rounded-full border border-danger/20 flex items-center gap-1">
                <User className="h-3 w-3" />
                <span>Logged by {latestStatusLog.operator?.username ?? latestStatusLog.operator?.full_name ?? 'Operator'}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-danger/90 leading-relaxed">
            Telemetry inputs are locked while the train is down. To record this offline session, click <strong>Save Offline Record</strong> below. If the train has resumed operation, specify the <em>Back Online At</em> timestamp above or toggle to <em>Operational / Running</em>.
          </p>
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
