import { useState, useMemo, useRef, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { ODO_THEME, type OdometerAlertState } from './theme';

export function useOdometerRoller({
  value,
  onChange,
  alertState = 'neutral',
  disabled = false,
  testId,
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
  const [keyboardMode, setKeyboardMode] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const dotIdx      = value.indexOf('.');
  const rawWhole    = dotIdx >= 0 ? value.slice(0, dotIdx) : value;
  const rawDec      = dotIdx >= 0 ? value.slice(dotIdx + 1) : '';
  const rawWholeLen = rawWhole.replace(/[^0-9]/g, '').length || 0;

  const wholeLen    = rawWholeLen > 6 ? 8 : 6;
  const wholeDisplay = rawWhole.padStart(wholeLen, '0').slice(-wholeLen);
  const decDisplay   = rawDec.slice(0, 1).padEnd(1, '0');

  const theme = ODO_THEME[alertState];

  const cellW    = wholeLen === 8 ? 'w-[32px]' : 'w-[38px]';
  const cellH    = 'h-[56px]';
  const fontSize = wholeLen === 8 ? 'text-[17px]' : 'text-[19px]';

  const handleDigitTap = useCallback((pos: number, direction: 1 | -1) => {
    if (disabled) return;

    const safeWhole = rawWhole.replace(/[^0-9]/g, '') || '0';
    const safeDec   = rawDec.slice(0, 1).padEnd(1, '0');
    const intVal    = parseInt(safeWhole, 10) * 10 + parseInt(safeDec, 10);

    let placeTenths: number;
    if (pos < wholeLen) {
      placeTenths = Math.pow(10, wholeLen - pos);
    } else {
      placeTenths = 1;
    }

    let newInt = intVal + direction * placeTenths;
    if (newInt < 0) newInt = 0;

    const newWholePart = Math.floor(newInt / 10);
    const newDecPart   = newInt % 10;
    onChange(`${newWholePart || 0}.${newDecPart}`);
  }, [disabled, rawWhole, rawDec, wholeLen, onChange]);

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
    const delta  = startY - endY;
    touchStartY.current = null;

    const SWIPE_THRESHOLD = 8;
    if (Math.abs(delta) >= SWIPE_THRESHOLD) {
      handleDigitTap(pos, delta > 0 ? 1 : -1);
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relY = endY - rect.top;
      handleDigitTap(pos, relY < rect.height / 2 ? 1 : -1);
    }
  }, [handleDigitTap]);

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

  return {
    isMobile, inputRef, keyboardInputRef, focused, setFocused, selStart, setSelStart,
    keyboardMode, setKeyboardMode, touchStartY, wholeDisplay, decDisplay, theme,
    cellW, cellH, fontSize, activeCellIdx, updateSel, handleDigitTap, handleTouchStart,
    handleTouchEnd, handleClick, rawWhole, rawDec, wholeLen, rawWholeLen,
  };
}
