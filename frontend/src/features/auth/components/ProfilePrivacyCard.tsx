import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Shield, Download, ExternalLink, Mail, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export function ProfilePrivacyCard() {
  const { user, profile } = useAuth();
  const [optOutTelemetry, setOptOutTelemetry] = useState(false);
  const [dntActive, setDntActive] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    try {
      const dnt = navigator.doNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack;
      if (dnt === '1' || dnt === 'yes') {
        setDntActive(true);
      }
      const storedOptOut = localStorage.getItem('pwri_tracking_opt_out') === 'true';
      setOptOutTelemetry(storedOptOut);
    } catch {
      // LocalStorage or navigator inaccessible
    }
  }, []);

  const handleToggleTelemetry = (checked: boolean) => {
    // checked = true means enable tracking; checked = false means opt-out
    const optOut = !checked;
    setOptOutTelemetry(optOut);
    try {
      if (optOut) {
        localStorage.setItem('pwri_tracking_opt_out', 'true');
        toast.info('Anonymous telemetry disabled');
      } else {
        localStorage.removeItem('pwri_tracking_opt_out');
        toast.success('Anonymous telemetry enabled');
      }
    } catch {
      toast.error('Unable to update local preference');
    }
  };

  const handleDownloadMyData = async () => {
    if (!user || !profile) {
      toast.error('User profile not loaded');
      return;
    }
    setExporting(true);
    try {
      // Fetch personal data items associated with user
      const [correctionsRes, myAuditsRes] = await Promise.all([
        supabase
          .from('reading_data_corrections')
          .select('id, plant_id, meter_id, reading_type, reading_date, original_value, corrected_value, reason, created_at')
          .eq('user_id', user.id)
          .limit(100),
        supabase
          .from('reading_audit_logs')
          .select('id, plant_id, meter_id, reading_date, old_value, new_value, reason, created_at')
          .eq('user_id', user.id)
          .limit(100),
      ]);

      const exportPayload = {
        meta: {
          export_type: 'Personal Data Portability Export (RA 10173)',
          exported_at: new Date().toISOString(),
          data_subject_id: user.id,
          system: 'PWRI Plant Monitoring System',
        },
        profile: {
          id: profile.id,
          username: profile.username,
          first_name: profile.first_name,
          middle_name: profile.middle_name,
          last_name: profile.last_name,
          suffix: profile.suffix,
          designation: profile.designation,
          email: user.email,
          plant_assignments: profile.plant_assignments,
          notice_version: profile.notice_version ?? '2026-10',
          notice_acknowledged_at: profile.notice_acknowledged_at,
          created_at: profile.created_at,
          updated_at: profile.updated_at,
        },
        activity_records: {
          recent_corrections: correctionsRes.data ?? [],
          recent_audit_logs: myAuditsRes.data ?? [],
        },
      };

      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute(
        'download',
        `pwri-personal-data-${profile.username || user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      toast.success('Personal data export completed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export personal data');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="p-5 space-y-4" data-testid="profile-privacy-card">
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Privacy &amp; Data Rights</h3>
            <p className="text-2xs text-muted-foreground">Philippine Data Privacy Act of 2012 (RA 10173)</p>
          </div>
        </div>
        <Badge variant="outline" className="text-2xs font-normal">
          DPA 2012
        </Badge>
      </div>

      {/* Notice Acknowledged Status */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground">Privacy Notice Acknowledged:</span>
          {profile?.notice_acknowledged_at ? (
            <span className="inline-flex items-center gap-1 text-2xs text-accent font-medium">
              <CheckCircle2 className="h-3 w-3" /> v{profile.notice_version ?? '2026-10'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
              <AlertCircle className="h-3 w-3" /> Pending re-verification
            </span>
          )}
        </div>
        <p className="text-3xs text-muted-foreground">
          Covers enterprise monitoring access, operational accountability, and regulatory data retention.
        </p>
      </div>

      {/* Telemetry Preference */}
      <div className="space-y-2 pt-1 border-t border-border/40">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="opt-telemetry" className="text-xs font-medium text-foreground cursor-pointer">
              Anonymous Navigation Telemetry
            </Label>
            <p className="text-2xs text-muted-foreground">
              Collects route patterns and screen usage to optimize navigation UX. Never logs plant IDs, readings, or PII.
            </p>
          </div>
          {dntActive ? (
            <Badge variant="secondary" className="text-3xs">
              DNT Active
            </Badge>
          ) : (
            <Switch
              id="opt-telemetry"
              checked={!optOutTelemetry}
              onCheckedChange={handleToggleTelemetry}
              aria-label="Toggle anonymous navigation telemetry"
            />
          )}
        </div>
        {dntActive && (
          <p className="text-3xs text-muted-foreground italic">
            Global Do Not Track (DNT) signal detected from your browser. Analytics is automatically disabled.
          </p>
        )}
      </div>

      {/* Data Portability (Right to Access & Portability) */}
      <div className="space-y-2 pt-2 border-t border-border/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-foreground">Data Portability (Right to Access)</p>
            <p className="text-2xs text-muted-foreground">
              Download a machine-readable JSON copy of your profile, role history, and logged corrections.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadMyData}
            disabled={exporting}
            className="text-xs shrink-0"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Download My Data
          </Button>
        </div>
      </div>

      {/* Compliance Links & DPO Contact */}
      <div className="pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <Link to="/privacy" className="hover:text-primary underline-offset-4 hover:underline inline-flex items-center gap-0.5">
            Privacy Notice <ExternalLink className="h-2.5 w-2.5" />
          </Link>
          <Link to="/terms" className="hover:text-primary underline-offset-4 hover:underline inline-flex items-center gap-0.5">
            Terms of Use <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>

        <a
          href="mailto:dpo@pwri.com.ph?subject=PWRI%20Data%20Privacy%20Inquiry"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <Mail className="h-3 w-3" /> Contact DPO
        </a>
      </div>
    </Card>
  );
}
