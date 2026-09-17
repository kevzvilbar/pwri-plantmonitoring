import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { StatusPill } from '@/components/StatusPill';
import {
  Bell,
  BellRing,
  BellOff,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  Smartphone,
  Share,
  PlusSquare,
  Loader2,
} from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { playNotificationSound } from '@/lib/pushNotification';

export function PushNotificationCard() {
  const {
    isSupported,
    permission,
    isSubscribed,
    isPending,
    isIOSNonStandalone,
    subscribeToPush,
    unsubscribeFromPush,
    sendLocalTestNotification,
  } = usePushNotifications();

  const handleToggle = async (checked: boolean) => {
    if (checked) {
      await subscribeToPush();
    } else {
      await unsubscribeFromPush();
    }
  };

  const getStatusBadge = () => {
    if (!isSupported) {
      return (
        <StatusPill tone="neutral" className="text-2xs font-mono">
          Unsupported
        </StatusPill>
      );
    }
    if (isIOSNonStandalone) {
      return (
        <StatusPill tone="warn" className="text-2xs font-mono">
          Install PWA First
        </StatusPill>
      );
    }
    if (permission === 'denied') {
      return (
        <StatusPill tone="danger" className="text-2xs font-mono">
          Blocked
        </StatusPill>
      );
    }
    if (isSubscribed) {
      return (
        <StatusPill tone="accent" className="text-2xs font-mono">
          Active
        </StatusPill>
      );
    }
    return (
      <StatusPill tone="neutral" className="text-2xs font-mono">
        Inactive
      </StatusPill>
    );
  };

  return (
    <Card
      className="p-5 rounded-2xl border border-border/80 shadow-2xs space-y-4 bg-card"
      data-testid="push-notification-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <BellRing className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Push Notifications</h3>
              {getStatusBadge()}
            </div>
            <p className="text-2xs text-muted-foreground">
              Real-time alarm broadcasts on mobile device lockscreens and desktop browsers
            </p>
          </div>
        </div>

        {isSupported && !isIOSNonStandalone && (
          <div className="flex items-center gap-2">
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Switch
                id="push-toggle-switch"
                checked={isSubscribed}
                onCheckedChange={handleToggle}
                disabled={permission === 'denied'}
                aria-label="Toggle push notifications"
              />
            )}
          </div>
        )}
      </div>

      {/* iOS Non-standalone Guidance Banner */}
      {isIOSNonStandalone && (
        <div className="p-3.5 rounded-xl bg-warn/10 border border-warn/25 space-y-2 text-xs">
          <div className="flex items-center gap-2 text-warn font-semibold">
            <Smartphone className="h-4 w-4 shrink-0" />
            <span>Apple iOS Push Setup Required</span>
          </div>
          <p className="text-2xs text-muted-foreground leading-relaxed">
            Safari on iOS requires PWRI Monitor to be added to your Home Screen before it can deliver lockscreen notifications:
          </p>
          <ol className="text-2xs text-foreground space-y-1 list-decimal list-inside font-medium pt-1">
            <li className="flex items-center gap-1.5">
              <span>1. Tap the Share button</span>
              <Share className="h-3.5 w-3.5 text-primary inline" />
              <span>at the bottom of Safari</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span>2. Select</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-background border border-border/80 font-mono text-3xs">
                <PlusSquare className="h-3 w-3" /> Add to Home Screen
              </span>
            </li>
            <li>3. Open PWRI from your Home Screen to enable instant push alerts.</li>
          </ol>
        </div>
      )}

      {/* Blocked Permission Warning */}
      {permission === 'denied' && (
        <div className="p-3 rounded-xl bg-danger/10 border border-danger/25 flex items-start gap-2.5 text-xs">
          <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-danger">Notifications are blocked in your browser</p>
            <p className="text-2xs text-muted-foreground leading-relaxed">
              To receive alerts, open your browser site settings (click the lock icon in the address bar) and change Notifications to <strong className="text-foreground">Allow</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Active Features Info Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
        <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-1">
          <div className="flex items-center gap-1.5 text-foreground font-semibold text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
            <span>Critical Plant Trips</span>
          </div>
          <p className="text-3xs text-muted-foreground leading-relaxed">
            Instant lockscreen notification when an RO train trips or goes offline unexpectedly.
          </p>
        </div>

        <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-1">
          <div className="flex items-center gap-1.5 text-foreground font-semibold text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
            <span>Water Quality Excursions</span>
          </div>
          <p className="text-3xs text-muted-foreground leading-relaxed">
            Immediate dispatch on high permeate TDS, chlorine spikes, or pH threshold breaches.
          </p>
        </div>
      </div>

      {/* Action Controls Footer */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => playNotificationSound('critical')}
            className="h-8 text-xs gap-1.5 border-border/80 hover:bg-muted"
            title="Preview alarm synthesizer chime"
          >
            <Volume2 className="h-3.5 w-3.5 text-primary" />
            <span>Preview Chime</span>
          </Button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={sendLocalTestNotification}
            disabled={!isSupported || isPending || isIOSNonStandalone}
            className="h-8 text-xs gap-1.5 font-medium border-primary/40 hover:bg-primary/10 hover:border-primary text-primary"
            data-testid="send-test-push-button"
          >
            <Bell className="h-3.5 w-3.5" />
            <span>Send Test Alert</span>
          </Button>
        </div>
      </div>
    </Card>
  );
}

