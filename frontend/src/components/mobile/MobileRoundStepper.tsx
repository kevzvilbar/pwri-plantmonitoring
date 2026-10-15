import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Camera, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  MapPin, 
  Sparkles, 
  History, 
  RotateCcw,
  Volume2
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OdometerRollerInput, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface RoundAssetItem {
  id: string;
  name: string;
  code?: string;
  type: 'locator' | 'well' | 'ro_train' | 'product_meter';
  locationName?: string;
  unit: string;
  currentValue: string;
  previousValue: number | null;
  previousTimestamp?: string | null;
  minExpected?: number;
  maxExpected?: number;
  status: 'pending' | 'completed' | 'flagged';
  anomalyMessage?: string;
  hasPhoto?: boolean;
}

export interface MobileRoundStepperProps {
  title: string;
  subtitle?: string;
  items: RoundAssetItem[];
  onSaveReading: (itemId: string, value: string, photoFile?: File) => Promise<boolean | void>;
  onCompleteRound?: () => void;
  onExit?: () => void;
}

export function MobileRoundStepper({
  title,
  subtitle,
  items,
  onSaveReading,
  onCompleteRound,
  onExit,
}: MobileRoundStepperProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    items.forEach((item) => {
      map[item.id] = item.currentValue || '';
    });
    return map;
  });
  const [photoSelected, setPhotoSelected] = useState<Record<string, File | null>>({});
  const [saving, setSaving] = useState(false);

  const currentItem = items[currentIndex];
  if (!currentItem) return null;

  const currentValueStr = inputValues[currentItem.id] ?? '';
  const currentNum = parseFloat(currentValueStr);
  const prevNum = currentItem.previousValue;

  // Compute delta against yesterday / previous reading
  const delta = !isNaN(currentNum) && prevNum != null ? currentNum - prevNum : null;

  // Determine alert status
  let alertState: OdometerAlertState = 'neutral';
  let statusMessage = 'Enter gauge reading';
  let isAlert = false;

  if (delta != null) {
    if (delta < 0) {
      alertState = 'error';
      statusMessage = `Negative flow detected: ${delta.toFixed(2)} ${currentItem.unit}`;
      isAlert = true;
    } else if (currentItem.maxExpected != null && currentNum > currentItem.maxExpected) {
      alertState = 'warn';
      statusMessage = `Above expected design max (${currentItem.maxExpected} ${currentItem.unit})`;
      isAlert = true;
    } else if (currentItem.minExpected != null && currentNum < currentItem.minExpected) {
      alertState = 'warn';
      statusMessage = `Below expected design min (${currentItem.minExpected} ${currentItem.unit})`;
      isAlert = true;
    } else {
      alertState = 'neutral';
      statusMessage = `Normal reading (+${delta.toFixed(2)} ${currentItem.unit} since last)`;
    }
  }

  const handleValueChange = (val: string) => {
    setInputValues((prev) => ({ ...prev, [currentItem.id]: val }));
  };

  const handleStepDelta = (amount: number) => {
    const base = isNaN(currentNum) ? (prevNum ?? 0) : currentNum;
    const nextVal = Math.max(0, +(base + amount).toFixed(2));
    handleValueChange(String(nextVal));
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoSelected((prev) => ({ ...prev, [currentItem.id]: file }));
      toast.success(`Photo attached for ${currentItem.name}`);
    }
  };

  const handleSaveAndNext = async () => {
    if (!currentValueStr || isNaN(currentNum)) {
      toast.error('Please enter a valid reading before proceeding');
      return;
    }

    setSaving(true);
    try {
      await onSaveReading(currentItem.id, currentValueStr, photoSelected[currentItem.id] || undefined);
      toast.success(`${currentItem.name} logged`);
      
      if (currentIndex < items.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        toast.success('All assets in round completed!');
        onCompleteRound?.();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save reading');
    } finally {
      setSaving(false);
    }
  };

  const completedCount = items.filter((i) => i.status === 'completed' || !!inputValues[i.id]).length;
  const progressPct = Math.round((completedCount / Math.max(1, items.length)) * 100);

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)] max-w-lg mx-auto pb-20 select-none">
      {/* Top Bar: Progress and Stepper Header */}
      <div className="sticky top-12 z-20 bg-background/95 backdrop-blur-md pt-2 pb-3 border-b border-border/60 mb-3 px-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {onExit && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 -ml-1 text-muted-foreground"
                onClick={onExit}
                aria-label="Exit Round"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            <div>
              <h2 className="text-sm font-bold tracking-tight text-foreground">{title}</h2>
              <div className="text-3xs text-muted-foreground">{subtitle ?? `Asset ${currentIndex + 1} of ${items.length}`}</div>
            </div>
          </div>

          <Badge variant="outline" className="font-mono text-2xs font-semibold px-2 py-0.5">
            {completedCount}/{items.length} Done ({progressPct}%)
          </Badge>
        </div>

        {/* Linear Progress Indicator */}
        <div className="w-full bg-muted/60 h-1.5 rounded-full overflow-hidden">
          <div 
            className="bg-primary h-full transition-all duration-300 ease-out rounded-full"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Asset Hero Card */}
      <Card className="flex-1 flex flex-col p-4 bg-card border-border/80 shadow-sm rounded-2xl relative">
        {/* Asset Header Tag */}
        <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-3 mb-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-primary uppercase tracking-wider">{currentItem.code || currentItem.type}</span>
              {currentItem.status === 'completed' && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              )}
            </div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">{currentItem.name}</h1>
            {currentItem.locationName && (
              <div className="flex items-center gap-1 text-2xs text-muted-foreground mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span>{currentItem.locationName}</span>
              </div>
            )}
          </div>

          {/* Previous baseline tag */}
          <div className="text-right">
            <div className="text-3xs text-muted-foreground font-medium">Yesterday's Value</div>
            <div className="text-xs font-mono font-bold text-foreground">
              {prevNum != null ? `${prevNum.toLocaleString()} ${currentItem.unit}` : 'None'}
            </div>
          </div>
        </div>

        {/* Primary Tactile Input Roller Section */}
        <div className="flex-1 flex flex-col items-center justify-center py-2 space-y-4">
          <div className="w-full text-center">
            <div className="text-2xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Current Reading ({currentItem.unit})
            </div>
            
            {/* The Tactile Roller Container */}
            <div className="flex justify-center w-full py-1">
              <OdometerRollerInput
                value={currentValueStr}
                onChange={handleValueChange}
                alertState={alertState}
              />
            </div>
          </div>

          {/* Quick-Step Increment Bumpers (Thumb reachable) */}
          <div className="flex items-center justify-center gap-2 w-full pt-1">
            <button
              type="button"
              onClick={() => handleStepDelta(-1.0)}
              className="h-9 px-3 rounded-xl border border-border/80 bg-muted/40 hover:bg-muted active:scale-95 text-xs font-mono font-semibold transition-all"
            >
              - 1.0
            </button>
            <button
              type="button"
              onClick={() => handleStepDelta(-0.1)}
              className="h-9 px-3 rounded-xl border border-border/80 bg-muted/40 hover:bg-muted active:scale-95 text-xs font-mono font-semibold transition-all"
            >
              - 0.1
            </button>
            <button
              type="button"
              onClick={() => handleStepDelta(0.1)}
              className="h-9 px-3 rounded-xl border border-border/80 bg-muted/40 hover:bg-muted active:scale-95 text-xs font-mono font-semibold transition-all"
            >
              + 0.1
            </button>
            <button
              type="button"
              onClick={() => handleStepDelta(1.0)}
              className="h-9 px-3 rounded-xl border border-border/80 bg-muted/40 hover:bg-muted active:scale-95 text-xs font-mono font-semibold transition-all"
            >
              + 1.0
            </button>
          </div>

          {/* Dynamic Status / Delta Banner */}
          <div className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium w-full transition-colors',
            alertState === 'error'
              ? 'bg-danger/10 text-danger border border-danger/20'
              : alertState === 'warn'
                ? 'bg-warn/10 text-warn border border-warn/20'
                : 'bg-muted/50 text-muted-foreground border border-border/60'
          )}>
            {alertState === 'error' || alertState === 'warn' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            )}
            <span className="flex-1 truncate">{statusMessage}</span>
          </div>

          {/* Photo Verification Capture Button */}
          <div className="w-full pt-1">
            <label className="flex items-center justify-center gap-2 w-full h-10 px-3 rounded-xl border border-dashed border-border/80 hover:bg-muted/40 active:scale-[0.99] transition-all cursor-pointer">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={handlePhotoCapture}
              />
              <Camera className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-medium text-foreground">
                {photoSelected[currentItem.id] ? '✓ Photo Attached (Tap to replace)' : 'Take Gauge Photo'}
              </span>
            </label>
          </div>
        </div>

        {/* Stepper Footer Controls */}
        <div className="pt-4 border-t border-border/60 flex items-center gap-2 mt-auto">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-12 rounded-xl text-xs font-bold gap-1"
            disabled={currentIndex === 0 || saving}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Previous</span>
          </Button>

          <Button
            type="button"
            className="flex-1 h-12 rounded-xl text-xs font-bold gap-1 bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
            disabled={saving}
            onClick={handleSaveAndNext}
          >
            <span>{currentIndex === items.length - 1 ? 'Finish Round' : 'Next Asset'}</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
