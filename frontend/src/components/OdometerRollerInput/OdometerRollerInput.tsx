import React, { useMemo } from 'react';
import { useRef } from 'react';
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
import { ODO_THEME, type OdometerAlertState } from './theme';
import { useOdometerRoller } from './useOdometerRoller';
import { MobileCarousel } from './MobileCarousel';

export type { OdometerAlertState } from './theme';
export { ODO_THEME } from './theme';
export { MobileCarousel } from './MobileCarousel';

export function OdometerRollerInput({
  value, onChange, alertState = 'neutral', disabled = false, testId,
}: {
  value: string;
  onChange: (v: string) => void;
  alertState?: OdometerAlertState;
  disabled?: boolean;
  testId?: string;
}) {
  const roller = useOdometerRoller({ value, onChange, alertState, disabled, testId });
  const {
    isMobile, inputRef, keyboardInputRef, focused, setFocused, selStart, setSelStart,
    keyboardMode, setKeyboardMode, touchStartY, wholeDisplay, decDisplay, theme,
    cellW, cellH, fontSize, activeCellIdx, updateSel, handleDigitTap, handleTouchStart,
    handleTouchEnd, handleClick, rawWhole, rawDec, wholeLen, rawWholeLen,
  } = roller;

  const renderCell = (
    d: string,
    key: string | number,
    pos: number,
    isDecimal: boolean,
    isActive: boolean,
  ) => {
    const cellBorder = isDecimal
      ? 'border-2 border-highlight'
      : isActive
        ? `border-2 ${theme.cellActive}`
        : `border-2 ${theme.cell}`;

    const cellColor = isDecimal
      ? 'text-highlight'
      : isActive
        ? theme.digitActive
        : theme.digit;

    const glowClass = isActive && !isDecimal ? theme.glow : '';

    const zoneBg     = isDecimal
      ? 'bg-highlight-soft/60'
      : isActive
        ? ''
        : 'bg-muted/60';
    const zoneDivide = isDecimal
      ? 'border-highlight/60'
      : 'border-border/70';

    if (isMobile) {
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
          <span className={[
            'w-full flex items-center justify-center pointer-events-none leading-none',
            'text-3xs opacity-40 pt-[3px] pb-[2px]',
            `border-b ${zoneDivide}`,
          ].join(' ')}>▲</span>
          <span className={['pointer-events-none font-mono font-black leading-none', fontSize].join(' ')}>{d}</span>
          <span className={[
            'w-full flex items-center justify-center pointer-events-none leading-none',
            'text-3xs opacity-40 pb-[3px] pt-[2px]',
            `border-t ${zoneDivide}`,
          ].join(' ')}>▼</span>
        </div>
      );
    }

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
        className={isMobile
          ? 'absolute inset-0 w-0 h-0 opacity-0 pointer-events-none'
          : 'absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10'}
      />

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
              alertState === 'ok'   ? 'border-accent text-accent ring-accent/30' :
              alertState === 'warn' ? 'border-warn   text-warn   ring-warn/30    ' :
              alertState === 'error'? 'border-danger     text-danger     ring-danger/30        ' :
                                     'border-highlight    text-foreground   ring-highlight/30',
              'bg-card',
              disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
          />
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setKeyboardMode(false); }}
            className="shrink-0 h-[48px] px-4 rounded-lg bg-highlight text-highlight-foreground text-sm font-semibold active:bg-highlight"
          >
            Done
          </button>
        </div>
      )}

      {(!isMobile || !keyboardMode) && (
        <div className="flex flex-col items-center gap-0 select-none">
          <div className="flex items-center justify-center gap-[4px] py-1">
            {wholeDisplay.split('').map((d, i) =>
              renderCell(d, i, i, false, !isMobile && focused && activeCellIdx === i)
            )}

            <span className={['text-2xl font-black pb-1 mx-[2px] leading-none', theme.dot].join(' ')}>.</span>

            {renderCell(decDisplay, 'dec-0', wholeLen, true, false)}

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

            {isMobile && !disabled && (
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setKeyboardMode(true)}
                aria-label="Switch to keyboard input"
                className={[
                  'ml-1 h-[40px] px-2 rounded-[8px] flex items-center gap-1',
                  'border-2 border-border',
                  'bg-muted',
                  'text-muted-foreground text-xs font-medium',
                  'active:bg-muted/70',
                  'touch-manipulation transition-colors',
                ].join(' ')}
              >
                <Keyboard size={14} />
                <span>Type</span>
              </button>
            )}
          </div>

          {isMobile && !disabled && (
            <div className="flex items-center justify-center gap-3 pb-1">
              <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-border text-3xs">↑</span>
                swipe up +
              </span>
              <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-border text-3xs">↓</span>
                swipe down −
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
