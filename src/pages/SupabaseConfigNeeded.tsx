import { Card } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

export default function SupabaseConfigNeeded() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-primary/10 to-background">
      <Card className="max-w-lg p-6 space-y-3">
        <div className="flex items-center gap-2 text-warn-foreground">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h1 className="text-lg font-semibold">Supabase Connection Not Configured</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          The app can&apos;t reach the backend because the Supabase environment
          variables are missing. Please add them in the Secrets panel:
        </p>
        <ul className="text-sm font-mono bg-muted/40 rounded p-3 space-y-1">
          <li>VITE_SUPABASE_URL</li>
          <li>VITE_SUPABASE_PUBLISHABLE_KEY</li>
          <li>VITE_SUPABASE_PROJECT_ID</li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Once you save them, refresh this page and the app will reconnect to your
          Supabase project automatically.
        </p>
      </Card>
    </div>
  );
}
