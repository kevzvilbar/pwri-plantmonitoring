import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SignUpNavigationProps {
  step: string;
  onBack: () => void;
  onNext: () => void;
}

export function SignUpNavigation({ step, onBack, onNext }: SignUpNavigationProps) {
  return (
    <div className="flex gap-2">
      {step !== 'designation' && (
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      )}
      <Button onClick={onNext} className="flex-1">
        Next <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
