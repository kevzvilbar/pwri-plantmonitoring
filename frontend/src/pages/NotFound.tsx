import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Droplets, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error('404: attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="text-center space-y-5 max-w-sm animate-fade-in">
        {/* Brand icon */}
        <div className="flex justify-center">
          <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10">
            <Droplets className="h-7 w-7 text-primary" />
          </div>
        </div>

        {/* Error code */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60 mb-1">
            Error 404
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Page not found
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            The route{' '}
            <code className="text-[11.5px] font-mono bg-muted px-1.5 py-0.5 rounded-md border">
              {location.pathname}
            </code>{' '}
            doesn't exist in PWRI.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
          <Button
            onClick={() => navigate(-1)}
            variant="outline"
            size="sm"
            className="gap-1.5 w-full sm:w-auto"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Go back
          </Button>
          <Button
            onClick={() => navigate('/')}
            size="sm"
            className="gap-1.5 w-full sm:w-auto"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
