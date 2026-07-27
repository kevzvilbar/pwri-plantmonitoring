import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDraft } from '@/hooks/useDraft';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.


export type OdometerAlertState = 'neutral' | 'ok' | 'warn' | 'error';

export const ODO_THEME: Record<OdometerAlertState, {
  cell: string; cellActive: string;
  digit: string; digitActive: string;
  decCell: string; decDigit: string;
  dot: string; glow: string;
}> = {
  neutral: {
    cell:        'bg-slate-100/90 dark:bg-slate-800/80 border-slate-300/70 dark:border-slate-600/60',
    cellActive:  'bg-cyan-100/90  dark:bg-cyan-900/60  border-cyan-400    dark:border-cyan-500',
    digit:       'text-slate-700  dark:text-slate-200',
    digitActive: 'text-cyan-700   dark:text-cyan-200',
    decCell:     'bg-slate-50/80  dark:bg-slate-900/50  border-slate-200/50 dark:border-slate-700/40',
    decDigit:    'text-slate-400/70 dark:text-slate-500/60',
    dot:         'text-slate-400  dark:text-slate-500',
    glow:        'ring-2 ring-cyan-300/50 dark:ring-cyan-600/40',
  },
  ok: {
    cell:        'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-300/70 dark:border-emerald-700/60',
    cellActive:  'bg-emerald-100/90 dark:bg-emerald-900/60 border-emerald-500  dark:border-emerald-400',
    digit:       'text-emerald-800 dark:text-emerald-200',
    digitActive: 'text-emerald-700 dark:text-emerald-100',
    decCell:     'bg-emerald-50/50  dark:bg-emerald-950/30 border-emerald-200/50 dark:border-emerald-800/40',
    decDigit:    'text-emerald-500/60 dark:text-emerald-500/50',
    dot:         'text-emerald-500 dark:text-emerald-400',
    glow:        'ring-2 ring-emerald-300/50 dark:ring-emerald-600/40',
  },
  warn: {
    cell:        'bg-amber-50/90  dark:bg-amber-950/50 border-amber-300/70  dark:border-amber-700/60',
    cellActive:  'bg-amber-100/90 dark:bg-amber-900/60 border-amber-500    dark:border-amber-400',
    digit:       'text-amber-800  dark:text-amber-200',
    digitActive: 'text-amber-700  dark:text-amber-100',
    decCell:     'bg-amber-50/50  dark:bg-amber-950/30 border-amber-200/50 dark:border-amber-800/40',
    decDigit:    'text-amber-500/60 dark:text-amber-500/50',
    dot:         'text-amber-500  dark:text-amber-400',
    glow:        'ring-2 ring-amber-300/50 dark:ring-amber-600/40',
  },
  error: {
    cell:        'bg-red-50/90   dark:bg-red-950/50 border-red-300/70   dark:border-red-700/60',
    cellActive:  'bg-red-100/90  dark:bg-red-900/60 border-red-500      dark:border-red-400',
    digit:       'text-red-800   dark:text-red-200',
    digitActive: 'text-red-700   dark:text-red-100',
    decCell:     'bg-red-50/50   dark:bg-red-950/30 border-red-200/50  dark:border-red-800/40',
    decDigit:    'text-red-500/60 dark:text-red-500/50',
    dot:         'text-red-500   dark:text-red-400',
    glow:        'ring-2 ring-red-300/50 dark:ring-red-600/40',
  },
} as const;

// ─── Mobile Tap-Roller ───────────────────────────────────────────────────────
// On mobile: each digit box is split top/bottom — tap top → roll up, tap bottom → roll down.
// Carry-over is automatic. Auto-expands to 8 whole digits when value ≥ 1,000,000.
// Decimal boxes (2, fixed) have a cyan highlight border.
// On desktop: falls back to the hidden-text-input keyboard-driven display.

export function OdometerRollerInput({
  value, onChange, alertState = 'neutral', disabled = false, testId,
}: {
  value: string;
  onChange: (v: string) => void;
  alertState?: OdometerAlertState;
  disabled?: boolean;
  testId?: string;
}) {
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const [focused,  setFocused]  = useState(false);
  const [selStart, setSelStart] = useState<number | null>(null);
  // Mobile keyboard mode: show a text input instead of tap-drum
  const [keyboardMode, setKeyboardMode] = useState(false);
  // Swipe gesture: track touch-start Y per cell to detect swipe direction.
  const touchStartY = useRef<number | null>(null);

  // ── Digit parsing ──────────────────────────────────────────────────────────
  const dotIdx      = value.indexOf('.');
  const rawWhole    = dotIdx >= 0 ? value.slice(0, dotIdx) : value;
  const rawDec      = dotIdx >= 0 ? value.slice(dotIdx + 1) : '';
  const rawWholeLen = rawWhole.replace(/[^0-9]/g, '').length || 0;

  // Overflow: auto-expand to 8 whole-digit cells when reading ≥ 1,000,000
  const wholeLen    = rawWholeLen > 6 ? 8 : 6;
  const wholeDisplay = rawWhole.padStart(wholeLen, '0').slice(-wholeLen);
  // Single decimal digit (tenths only) — simpler and less cramped on mobile.
  const decDisplay   = rawDec.slice(0, 1).padEnd(1, '0');

  const theme = ODO_THEME[alertState];

  // ── Cell sizing — taller cells give a larger swipe/tap surface ────────────
  const cellW    = wholeLen === 8 ? 'w-[32px]' : 'w-[38px]';
  const cellH    = 'h-[56px]';
  const fontSize = wholeLen === 8 ? 'text-[17px]' : 'text-[19px]';

  // ── Mobile digit handler ───────────────────────────────────────────────────
  // pos: 0-indexed from left across ALL displayed cells (whole + dec).
  // direction: +1 = increment (swipe up), -1 = decrement (swipe down).
  const handleDigitTap = useCallback((pos: number, direction: 1 | -1) => {
    if (disabled) return;

    // Represent the number as an integer scaled by 10 (avoids float drift).
    // One decimal digit means: intVal = whole * 10 + tenths.
    const safeWhole = rawWhole.replace(/[^0-9]/g, '') || '0';
    const safeDec   = rawDec.slice(0, 1).padEnd(1, '0');
    const intVal    = parseInt(safeWhole, 10) * 10 + parseInt(safeDec, 10);

    // Place value in the ×10 scaled integer:
    //   whole digit at pos → 10^(wholeLen - pos)   [e.g. pos=0 → 10^6 for 6-digit]
    //   dec digit 0 (tenths) → 1
    let placeTenths: number;
    if (pos < wholeLen) {
      placeTenths = Math.pow(10, wholeLen - pos);
    } else {
      placeTenths = 1; // only one decimal digit
    }

    let newInt = intVal + direction * placeTenths;
    if (newInt < 0) newInt = 0; // clamp at zero

    const newWholePart = Math.floor(newInt / 10);
    const newDecPart   = newInt % 10;
    onChange(`${newWholePart || 0}.${newDecPart}`);
  }, [disabled, rawWhole, rawDec, wholeLen, onChange]);

  // ── Swipe-gesture handler (mobile) ────────────────────────────────────────
  // A swipe of ≥8 px determines direction; shorter movements fall back to
  // top/bottom-half tap so a stationary tap still works as expected.
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((
    e: React.TouchEvent<HTMLDivElement>,
    pos: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const endY   = e.changedTouches[0].clientY;
    const startY = touchStartY.current ?? endY;
    const delta  = startY - endY; // positive = finger moved up = increment
    touchStartY.current = null;

    const SWIPE_THRESHOLD = 8; // px
    if (Math.abs(delta) >= SWIPE_THRESHOLD) {
      handleDigitTap(pos, delta > 0 ? 1 : -1);
    } else {
      // Short tap: use top/bottom-half of the cell as fallback
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relY = endY - rect.top;
      handleDigitTap(pos, relY < rect.height / 2 ? 1 : -1);
    }
  }, [handleDigitTap]);

  // Mouse click fallback (desktop preview / non-touch devices)
  const handleClick = useCallback((
    e: React.MouseEvent<HTMLDivElement>,
    pos: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = e.clientY - rect.top;
    handleDigitTap(pos, relY < rect.height / 2 ? 1 : -1);
  }, [handleDigitTap]);

  // ── Desktop: active-cell tracking via hidden input cursor ─────────────────
  const activeCellIdx = useMemo(() => {
    if (!focused || selStart === null || isMobile) return null;
    const paddingLen    = Math.max(0, wholeLen - rawWholeLen);
    const displayCursor = Math.min(selStart, rawWholeLen) + paddingLen;
    return Math.max(0, Math.min(wholeLen - 1, displayCursor - 1));
  }, [focused, selStart, wholeLen, rawWholeLen, isMobile]);

  const updateSel = () => {
    const el = inputRef.current;
    if (el) setSelStart(el.selectionStart ?? null);
  };

  // ── Shared cell renderer ───────────────────────────────────────────────────
  const renderCell = (
    d: string,
    key: string | number,
    pos: number,
    isDecimal: boolean,
    isActive: boolean,
  ) => {
    // Decimal cells: always show cyan highlight border
    const cellBorder = isDecimal
      ? 'border-2 border-cyan-400 dark:border-cyan-500'
      : isActive
        ? `border-2 ${theme.cellActive}`
        : `border-2 ${theme.cell}`;

    const cellColor = isDecimal
      ? 'text-cyan-700 dark:text-cyan-300'
      : isActive
        ? theme.digitActive
        : theme.digit;

    const glowClass = isActive && !isDecimal ? theme.glow : '';

    // Background tints for the top/bottom tap zones inside each cell
    const zoneBg     = isDecimal
      ? 'bg-cyan-50/60 dark:bg-cyan-950/30'
      : isActive
        ? ''
        : 'bg-slate-50/60 dark:bg-slate-900/40';
    const zoneDivide = isDecimal
      ? 'border-cyan-200/60 dark:border-cyan-700/40'
      : 'border-slate-200/70 dark:border-slate-700/50';

    if (isMobile) {
      // Three-zone layout: top tap zone (▲) | digit | bottom tap zone (▼).
      // Zones are visually distinct so users immediately know where to act.
      return (
        <div
          key={key}
          role="button"
          aria-label={`Digit ${d}, swipe up or tap top to increase, swipe down or tap bottom to decrease`}
          onTouchStart={handleTouchStart}
          onTouchEnd={(e) => handleTouchEnd(e, pos)}
          onClick={(e)   => handleClick(e, pos)}
          className={[
            cellW, cellH,
            'relative rounded-[8px] flex flex-col items-center justify-between select-none touch-manipulation overflow-hidden',
            'border-2 font-mono font-black transition-all duration-75',
            cellBorder, cellColor, glowClass, zoneBg,
            disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-95',
          ].join(' ')}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {/* Top zone — ▲ indicator */}
          <span className={[
            'w-full flex items-center justify-center pointer-events-none leading-none',
            'text-[9px] opacity-40 pt-[3px] pb-[2px]',
            `border-b ${zoneDivide}`,
          ].join(' ')}>▲</span>
          {/* Digit */}
          <span className={['pointer-events-none font-mono font-black leading-none', fontSize].join(' ')}>{d}</span>
          {/* Bottom zone — ▼ indicator */}
          <span className={[
            'w-full flex items-center justify-center pointer-events-none leading-none',
            'text-[9px] opacity-40 pb-[3px] pt-[2px]',
            `border-t ${zoneDivide}`,
          ].join(' ')}>▼</span>
        </div>
      );
    }

    // Desktop: passive visual cell (input overlay handles events)
    return (
      <div
        key={key}
        className={[
          cellW, cellH,
          'rounded-[8px] flex items-center justify-center',
          'font-mono font-black leading-none transition-all duration-100',
          fontSize, cellBorder, cellColor, glowClass,
        ].join(' ')}
      >
        {d}
      </div>
    );
  };

  return (
    <div className="relative w-full">
      {/* ── Hidden text input: keyboard events on desktop, also provides testId ── */}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        pattern="[0-9]*\.?[0-9]*"
        value={value}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9.]/g, '').replace(/\.(.*)\./, '.$1');
          onChange(raw);
        }}
        onFocus={() => { setFocused(true); setTimeout(updateSel, 0); }}
        onBlur={() => { setFocused(false); setSelStart(null); }}
        onKeyUp={updateSel}
        onMouseUp={updateSel}
        onSelect={updateSel}
        onTouchEnd={isMobile ? undefined : updateSel}
        disabled={disabled}
        data-testid={testId}
        aria-label="Meter reading"
        // On mobile the tap cells handle events; hide input completely.
        // On desktop the input is the interaction layer.
        className={isMobile
          ? 'absolute inset-0 w-0 h-0 opacity-0 pointer-events-none'
          : 'absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10'}
      />

      {/* ── Mobile keyboard mode: full-width text input with done button ── */}
      {isMobile && keyboardMode && (
        <div className="flex items-center gap-2 py-1">
          <input
            ref={keyboardInputRef}
            type="text"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            value={value}
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9.]/g, '').replace(/\.(.*)\./, '.$1');
              onChange(raw);
            }}
            onBlur={() => setKeyboardMode(false)}
            disabled={disabled}
            placeholder="Enter reading"
            aria-label="Meter reading (keyboard)"
            autoFocus
            className={[
              'flex-1 h-[48px] rounded-lg border-2 text-center font-mono font-bold text-[18px]',
              'focus:outline-none focus:ring-2 px-2',
              alertState === 'ok'   ? 'border-emerald-400 text-emerald-800 ring-emerald-200 dark:border-emerald-500 dark:text-emerald-200' :
              alertState === 'warn' ? 'border-amber-400   text-amber-800   ring-amber-200   dark:border-amber-500   dark:text-amber-200' :
              alertState === 'error'? 'border-red-400     text-red-800     ring-red-200     dark:border-red-500     dark:text-red-200' :
                                     'border-cyan-400    text-slate-800   ring-cyan-200    dark:border-cyan-500    dark:text-slate-100',
              'bg-white dark:bg-slate-900',
              disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
          />
          {/* Done button — dismisses keyboard and returns to drum view */}
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setKeyboardMode(false); }}
            className="shrink-0 h-[48px] px-4 rounded-lg bg-cyan-600 text-white text-sm font-semibold active:bg-cyan-700"
          >
            Done
          </button>
        </div>
      )}

      {/* ── Visual drum display (shown when not in keyboard mode on mobile) ── */}
      {(!isMobile || !keyboardMode) && (
        <div className="flex flex-col items-center gap-0 select-none">
          {/* Drum row */}
          <div className="flex items-center justify-center gap-[4px] py-1">
            {/* Whole-digit cells */}
            {wholeDisplay.split('').map((d, i) =>
              renderCell(d, i, i, false, !isMobile && focused && activeCellIdx === i)
            )}

            {/* Decimal point */}
            <span className={['text-2xl font-black pb-1 mx-[2px] leading-none', theme.dot].join(' ')}>.</span>

            {/* Single decimal cell (tenths) — cyan border highlight */}
            {renderCell(decDisplay, 'dec-0', wholeLen, true, false)}

            {/* Alert-state icon — accessible backup so the signal isn't color-only */}
            {alertState !== 'neutral' && (
              <span
                role="img"
                aria-label={
                  alertState === 'ok' ? 'Reading looks normal' :
                  alertState === 'warn' ? 'Reading needs review' :
                  'Reading has an error'
                }
                className={['flex items-center justify-center shrink-0', theme.dot].join(' ')}
              >
                {alertState === 'ok' && <CheckCircle2 className="h-4 w-4" />}
                {alertState === 'warn' && <AlertTriangle className="h-4 w-4" />}
                {alertState === 'error' && <XCircle className="h-4 w-4" />}
              </span>
            )}

            {/* Keyboard toggle — mobile only, labeled "Type" for discoverability */}
            {isMobile && !disabled && (
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setKeyboardMode(true)}
                aria-label="Switch to keyboard input"
                className={[
                  'ml-1 h-[40px] px-2 rounded-[8px] flex items-center gap-1',
                  'border-2 border-slate-300 dark:border-slate-600',
                  'bg-slate-50 dark:bg-slate-800',
                  'text-slate-500 dark:text-slate-400 text-[11px] font-medium',
                  'active:bg-slate-100 dark:active:bg-slate-700',
                  'touch-manipulation transition-colors',
                ].join(' ')}
              >
                <Keyboard size={14} />
                <span>Type</span>
              </button>
            )}
          </div>

          {/* Swipe hint — mobile only, shown below the drum */}
          {isMobile && !disabled && (
            <div className="flex items-center justify-center gap-3 pb-1">
              <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 text-[8px]">↑</span>
                swipe up +
              </span>
              <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 text-[8px]">↓</span>
                swipe down −
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MobileCarousel ──────────────────────────────────────────────────────────
// On mobile, show one item at a time and let the user swipe left/right (or use
// arrow buttons) to navigate. The counter "X / N" is shown in the header row.
// On desktop this renders all items without pagination (original behaviour).


export function MobileCarousel({
  items,
  renderItem,
  headerLeft,
  isMobile,
}: {
  items: any[];
  renderItem: (item: any, index: number) => React.ReactNode;
  headerLeft?: React.ReactNode;
  isMobile: boolean;
}) {
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Clamp index on items change (e.g. plant switch)
  useEffect(() => { setCurrent(0); }, [items.length]);

  const prev = () => setCurrent(i => Math.max(0, i - 1));
  const next = () => setCurrent(i => Math.min(items.length - 1, i + 1));

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - (touchStartY.current ?? 0));
    if (Math.abs(dx) > 45 && Math.abs(dx) > dy * 1.5) {
      if (dx < 0) next(); else prev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  if (!isMobile) {
    return <>{items.map((item, i) => renderItem(item, i))}</>;
  }

  if (!items.length) return null;

  const clampedIdx = Math.min(current, items.length - 1);

  return (
    <div>
      {/* Navigation bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20">
        {headerLeft ?? <span />}
        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            disabled={clampedIdx === 0}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
            aria-label="Previous"
          >‹</button>
          <span className="text-[11px] font-semibold text-muted-foreground tabular-nums min-w-[32px] text-center">
            {clampedIdx + 1} / {items.length}
          </span>
          <button
            onClick={next}
            disabled={clampedIdx === items.length - 1}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
            aria-label="Next"
          >›</button>
        </div>
      </div>
      {/* Swipeable item */}
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {renderItem(items[clampedIdx], clampedIdx)}
      </div>
    </div>
  );
}

// ─── LOCATOR ─────────────────────────────────────────────────────────────────

