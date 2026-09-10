import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { StatusPill } from '@/components/StatusPill';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { MapPin, Pencil, X, Droplet, AlertCircle, AlertTriangle, Loader2, History, MessageCircleOff, CalendarClock, ShieldAlert, ArrowUpRight, Lock, SquarePen } from 'lucide-react';
import { OdometerRollerInput, MobileCarousel, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import {
  GridPylonIcon, WELL_MAX_READINGS_PER_DAY,
  formatCooldown, invalidateLocatorDash, invalidateWellDash, invalidateDashboard,
  invalidateProductMeterDash, invalidatePowerDash, invalidateRODash, invalidateChemDash,
} from '../../pages/operations/shared';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLocatorReading } from './LocatorRow/useLocatorReading';
import { DerivedMeterPanel } from './LocatorRow/DerivedMeterPanel';
import { ActionButtons } from './LocatorRow/ActionButtons';
import { StatusBanners } from './LocatorRow/StatusBanners';
import { GapReasonDialog } from './LocatorRow/GapReasonDialog';

function LocatorRow({
  locator, plantId, previous, previousDt, latestReading, todayReadings, avgVol, userId, onSaved, isManagerOrAdmin, maxReadingsPerDay = 3,
  gapReason, onGapReasonSaved, rowRef, pulsing,
}: {
  locator: any; plantId: string; previous: number | null; previousDt: string | null;
  latestReading?: any | null;
  todayReadings: any[]; avgVol: number | null;
  userId: string | undefined; onSaved: () => void;
  isManagerOrAdmin: boolean;
  maxReadingsPerDay?: number;
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
  pulsing?: boolean;
}) {
  const navigate = useNavigate();

  const {
    reading, setReading, editingId, setEditingId, saving, setSaving,
    customDt, setCustomDt, anomalyRemark, setAnomalyRemark,
    showAnomalyBanner, setShowAnomalyBanner,
    lastSavePending, justSaved,
    cooldownMinutes, cooldownAvailableAt,
    correctionTarget, setCorrectionTarget,
    locInputMode, readingChanged, dailyVol, belowPrev,
    deviationLoc, highVol, anomalyRemarkRequired,
    atLimit, freshness, odometerAlert,
    actorLabel,
    startEdit, cancelEdit, save,
    handleCorrectionRequest,
    overrideOpen, setOverrideOpen,
    overrideSaving, recalcSaving, importOverrideOpen, setImportOverrideOpen,
    saveOverride, recalcNow,
    draftReading, setDraftReading, clearDraftReading,
    isMobile,
    editReason, setEditReason,
    editCustomReason, setEditCustomReason,
  } = useLocatorReading({
    locator, plantId, previous, previousDt, latestReading, todayReadings,
    avgVol, userId, onSaved, isManagerOrAdmin, maxReadingsPerDay,
  });

  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const dtInputRef = useRef<HTMLInputElement>(null);

  const lastToday = todayReadings[0] ?? null;
  const todayCount = todayReadings.length;
  const lastTodayAge = lastToday ? (Date.now() - new Date(lastToday.reading_datetime).getTime()) / 60_000 : Infinity;
  const isLocked = !!(lastToday as any)?.locked_at;
  const canSelfEdit = lastTodayAge <= 120 && !isLocked;
  const canRequest = lastTodayAge > 120 && lastTodayAge < 7 * 24 * 60 && !isLocked;

  if (locator.is_derived) {
    return (
      <DerivedMeterPanel
        locator={locator}
        plantId={plantId}
        latestReading={latestReading}
        userId={userId}
        isManagerOrAdmin={isManagerOrAdmin}
        recalcSaving={recalcSaving}
        overrideSaving={overrideSaving}
        overrideOpen={overrideOpen}
        importOverrideOpen={importOverrideOpen}
        reviewFlag={null}
        actorLabel={actorLabel}
        showHistory={showHistory}
        onRecalcNow={recalcNow}
        onSaveOverride={saveOverride}
        onSetShowHistory={setShowHistory}
        onSetOverrideOpen={setOverrideOpen}
        onSetImportOverrideOpen={setImportOverrideOpen}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div
      ref={rowRef}
      className={cn(
        'p-4 space-y-3 transition-all border-b last:border-b-0 border-border/60',
        pulsing ? 'ring-2 ring-accent ring-inset bg-accent-soft/20' : '',
      )}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground break-words">{locator.name}</span>
          <MetaStrip
            primary={
              <StatusPill tone={freshness.tone}>
                <CalendarClock className="h-3 w-3" />
                {freshness.label}
              </StatusPill>
            }
            alerts={[
              todayCount === 0 && !editingId && {
                tone: 'warn',
                icon: MessageCircleOff,
                label: gapReason ? reasonCategoryLabel(gapReason.reason_category) : 'Log gap reason',
                onClick: () => setGapDialogOpen(true),
                testId: `locator-gap-reason-btn-${locator.id}`,
              },
              editingId && {
                tone: 'primary',
                label: 'Editing',
              },
              locator.is_locked && {
                tone: 'danger',
                icon: ShieldAlert,
                label: 'meter locked',
              },
              lastToday?.is_estimated && {
                tone: 'warn',
                label: 'Estimated',
                title: 'Auto-backfilled reading — no manual operator entry on file.',
              },
              lastToday?.off_location_flag && {
                tone: 'warn',
                icon: MapPin,
                label: 'off-site',
              },
            ].filter(Boolean)}
            overflow={[
              {
                icon: ArrowUpRight,
                label: 'Plant detail',
                onClick: () => navigate(`/plants/${plantId}?tab=locators&highlight=${locator.id}`),
              },
            ].filter(Boolean)}
            maxVisible={4}
          />
        </div>

        <label className="shrink-0 cursor-pointer relative">
          <span
            className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground bg-muted border border-border/70 rounded-full px-3 py-1 font-mono-num whitespace-nowrap hover:bg-muted/80 hover:text-foreground transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-focus-visible:outline-offset-2"
            onClick={(e) => {
              e.preventDefault();
              const el = dtInputRef.current;
              if (!el) return;
              if (typeof el.showPicker === 'function') {
                try { el.showPicker(); } catch { el.focus(); }
              } else {
                el.focus();
              }
            }}
          >
            {customDt ? new Date(customDt).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}
            <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
          </span>
          <Input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
            className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" />
        </label>
      </div>

      <div className="recessed-glass p-2.5 sm:p-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center rounded-full border border-kpi-locator/40 overflow-hidden text-2xs font-semibold shrink-0 px-2.5 py-0.5 bg-kpi-locator/20 text-kpi-locator"
            title={locInputMode === 'raw'
              ? 'Cumulative meter reading — Δ auto-computed. Set in Plant config > Locators.'
              : 'Daily m³ entered directly. Set in Plant config > Locators.'}
          >
            {locInputMode === 'raw' ? 'Raw Meter' : 'Direct m³'}
          </div>
          <div className="text-xs text-muted-foreground">
            {locInputMode === 'raw' ? (
              <>
                prev: <span className="font-mono-num font-semibold text-foreground">{previous == null ? '—' : fmtNum(previous)}</span>
                {!isMobile && dailyVol != null && <> · Δ <span className={cn('font-mono-num font-semibold', dailyVol < 0 ? 'text-destructive' : 'text-primary')}>{fmtNum(dailyVol)} m³</span></>}
              </>
            ) : (
              <>
                {dailyVol != null ? <><span className={cn('font-mono-num font-semibold', dailyVol < 0 ? 'text-destructive' : 'text-primary')}>{fmtNum(dailyVol)} m³</span> to save</> : <span className="text-muted-foreground/70">enter daily volume</span>}
              </>
            )}
          </div>
        </div>

        <div className="text-xs font-mono-num">
          <span className={cn('px-2 py-0.5 rounded-full font-medium', atLimit ? 'bg-warn-soft text-warn font-semibold' : 'bg-muted/60 text-muted-foreground')}>
            {todayCount}/{maxReadingsPerDay} today
          </span>
        </div>
      </div>

      {isMobile && locInputMode === 'raw' ? (
        <div className="space-y-2.5">
          <OdometerRollerInput
            value={reading}
            onChange={(v) => { setReading(v); setDraftReading({ value: v }); }}
            alertState={odometerAlert}
            disabled={saving || atLimit}
            testId={`loc-odometer-${locator.id}`}
          />

          <div className="flex items-center justify-between text-xs px-1 min-h-[18px]">
            <span className="text-muted-foreground font-medium">
              Current:{' '}
              <span className={`font-mono-num font-semibold ${reading ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                {reading ? (+reading).toFixed(2) : '—'}
              </span>
            </span>
            {dailyVol != null && (
              <span className={cn('font-mono-num font-semibold', dailyVol < 0 ? 'text-destructive' : 'text-primary')}>
                Δ {fmtNum(dailyVol)} m³
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {atLimit ? (
              <Button
                onClick={() => lastToday && startEdit(lastToday)}
                variant="outline"
                className="flex-1 h-11 rounded-full text-sm font-semibold border-primary/40 text-primary hover:bg-primary/10 transition-all"
                data-testid={`loc-edit-${locator.id}`}
              >
                <Pencil className="h-4 w-4 mr-1.5" /> Edit reading
              </Button>
            ) : (
              <Button
                onClick={save} disabled={Boolean(saving || !readingChanged || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason)))}
                style={{ '--confirm-glow': 'hsl(var(--kpi-locator, 175 84% 32%) / 0.5)' } as React.CSSProperties}
                className={cn(
                  'flex-1 h-11 rounded-full text-sm font-semibold shadow-sm transition-all',
                  readingChanged
                    ? 'bg-kpi-locator hover:bg-kpi-locator/90 active:scale-[0.98] text-white'
                    : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
                  justSaved && 'animate-gauge-confirm',
                )}
                data-testid={`loc-save-${locator.id}`}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update reading' : 'Save reading'}
              </Button>
            )}
            {editingId && (
              <Button
                onClick={cancelEdit}
                variant="ghost"
                size="sm"
                className="h-11 px-3 rounded-full text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
            )}
            <ActionButtons
              lastToday={lastToday}
              editingId={editingId}
              canSelfEdit={canSelfEdit}
              canRequest={canRequest}
              isManagerOrAdmin={isManagerOrAdmin}
              isLocked={isLocked}
              correctionTarget={correctionTarget}
              setCorrectionTarget={setCorrectionTarget}
              handleCorrectionRequest={handleCorrectionRequest}
              setEditingId={setEditingId}
              setReading={setReading}
              setShowHistory={setShowHistory}
              onSaved={onSaved}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Droplet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kpi-locator pointer-events-none" />
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading} onChange={(e) => { setReading(e.target.value); setDraftReading({ value: e.target.value }); setShowAnomalyBanner(false); }}
              placeholder={locInputMode === 'direct' ? 'Daily volume (m³)' : 'Meter reading'}
              className="pl-9 h-11 rounded-xl bg-kpi-locator/5 border-kpi-locator/30 focus-visible:ring-kpi-locator/30 font-mono-num font-medium"
            />
          </div>
          {atLimit ? (
            <Button
              onClick={() => lastToday && startEdit(lastToday)}
              variant="outline"
              className="h-11 px-5 rounded-full text-sm font-semibold shrink-0 border-primary/40 text-primary hover:bg-primary/10 transition-all"
              data-testid={`loc-edit-${locator.id}`}
            >
              <Pencil className="h-4 w-4 mr-1.5" /> Edit reading
            </Button>
          ) : (
            <Button
              onClick={save} disabled={Boolean(saving || !readingChanged || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason)))}
              style={{ '--confirm-glow': 'hsl(var(--kpi-locator, 175 84% 32%) / 0.5)' } as React.CSSProperties}
              className={cn(
                'h-11 px-6 rounded-full text-sm font-semibold shrink-0 shadow-sm transition-all',
                readingChanged
                  ? 'bg-kpi-locator hover:bg-kpi-locator/90 active:scale-[0.98] text-white'
                  : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
                justSaved && 'animate-gauge-confirm',
              )}
              data-testid={`loc-save-${locator.id}`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update reading' : 'Save reading'}
            </Button>
          )}
          {editingId && (
            <Button
              onClick={cancelEdit}
              variant="ghost"
              size="sm"
              className="h-11 px-3 rounded-full text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              Cancel
            </Button>
            )}
            <ActionButtons
              lastToday={lastToday}
              editingId={editingId}
              canSelfEdit={canSelfEdit}
              canRequest={canRequest}
              isManagerOrAdmin={isManagerOrAdmin}
              isLocked={isLocked}
              correctionTarget={correctionTarget}
              setCorrectionTarget={setCorrectionTarget}
              handleCorrectionRequest={handleCorrectionRequest}
              setEditingId={setEditingId}
              setReading={setReading}
              setShowHistory={setShowHistory}
              onSaved={onSaved}
            />
          </div>
      )}

      {editingId && (
        <div>
          <CorrectionReasonField
            reason={editReason} onReasonChange={setEditReason}
            customReason={editCustomReason} onCustomReasonChange={setEditCustomReason}
            label="Reason for this edit"
          />
        </div>
      )}

      {locInputMode === 'raw' && (
        <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer select-none">
          <Checkbox
            checked={!!meterReplacePending}
            onCheckedChange={(v) => {
              if (v === true) setShowReplaceMeter(true);
              else setMeterReplacePending(null);
            }}
          />
          Meter replaced
          {meterReplacePending && <span className="text-primary font-medium">— logged</span>}
        </label>
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={locator.name}
          module="locator"
          entityId={locator.id}
          plantId={plantId}
          assetMeterSerial={locator.meter_serial}
          defaultInputMode={locator.default_input_mode === 'direct' ? 'direct' : 'raw'}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showReplaceMeter && (
        <ReplaceMeterDialog
          kind="locator"
          assetId={locator.id}
          plantId={plantId}
          oldSerial={locator.meter_serial}
          onSuccess={(info) => {
            setMeterReplacePending(info ?? { newInitialReading: null, replacementId: null });
            if (info?.newInitialReading != null && (reading === '' || reading === previous?.toFixed(2))) {
              setReading(String(info.newInitialReading));
            }
          }}
          onClose={() => setShowReplaceMeter(false)}
        />
      )}
      <StatusBanners
        cooldownMinutes={cooldownMinutes}
        cooldownAvailableAt={cooldownAvailableAt}
        lastSavePending={lastSavePending}
        reading={reading}
        belowPrev={belowPrev}
        highVol={highVol}
        showAnomalyBanner={showAnomalyBanner}
        anomalyRemark={anomalyRemark}
        deviationLoc={deviationLoc}
        locatorName={locator.name}
        onAnomalyRemarkChange={setAnomalyRemark}
      />

      <GapReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        locatorName={locator.name}
        locatorId={locator.id}
        plantId={plantId}
        userId={userId}
        gapReason={gapReason}
        onGapReasonSaved={onGapReasonSaved}
      />
    </div>
  );
}

export { LocatorRow };
