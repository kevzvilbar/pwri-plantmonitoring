interface StepIndicatorProps {
  steps: string[];
  currentStep: string;
  stepIndex: number;
  labels: Record<string, string>;
}

export function StepIndicator({ steps, currentStep, stepIndex, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            s === currentStep ? 'bg-accent text-accent-foreground'
            : i < stepIndex ? 'bg-muted text-muted-foreground line-through'
            : 'text-muted-foreground'
          }`}>{labels[s] ?? s}</span>
          {i < steps.length - 1 && <span className="text-muted-foreground text-2xs">›</span>}
        </span>
      ))}
    </div>
  );
}
