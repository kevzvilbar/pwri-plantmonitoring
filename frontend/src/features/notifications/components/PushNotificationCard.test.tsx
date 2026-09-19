import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PushNotificationCard } from './PushNotificationCard';

const mockSubscribeToPush = vi.fn();
const mockUnsubscribeFromPush = vi.fn();
const mockSendLocalTestNotification = vi.fn();

// Overridable per-test so the "not configured" branch can be exercised.
const mockState = {
  isSupported: true,
  isConfigured: true,
  permission: 'granted' as const,
  isSubscribed: true,
  isPending: false,
  isIOSNonStandalone: false,
};

vi.mock('../hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({
    ...mockState,
    subscription: { endpoint: 'https://push.example.com' },
    subscribeToPush: mockSubscribeToPush,
    unsubscribeFromPush: mockUnsubscribeFromPush,
    sendLocalTestNotification: mockSendLocalTestNotification,
    checkSubscription: vi.fn(),
  }),
}));

describe('PushNotificationCard', () => {
  beforeEach(() => {
    mockState.isConfigured = true;
    mockState.isSubscribed = true;
  });

  it('renders correctly with active status', () => {
    render(<PushNotificationCard />);

    expect(screen.getByText('Push Notifications')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByTestId('send-test-push-button')).toBeInTheDocument();
  });

  it('triggers sendLocalTestNotification when Send Test Alert is clicked', () => {
    render(<PushNotificationCard />);

    const testBtn = screen.getByTestId('send-test-push-button');
    fireEvent.click(testBtn);

    expect(mockSendLocalTestNotification).toHaveBeenCalled();
  });

  it('allows clicking preview chime button', () => {
    render(<PushNotificationCard />);

    const chimeBtn = screen.getByText('Preview Chime');
    expect(() => fireEvent.click(chimeBtn)).not.toThrow();
  });

  // Regression guard: an unconfigured deployment previously rendered "Active"
  // off a hardcoded tutorial VAPID key, so the operator believed alerts worked.
  it('surfaces a missing VAPID configuration instead of claiming to be active', () => {
    mockState.isConfigured = false;
    mockState.isSubscribed = false;

    render(<PushNotificationCard />);

    expect(screen.getByText('Not Configured')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.getByText('Push is not configured for this deployment')).toBeInTheDocument();
    expect(screen.getByTestId('send-test-push-button')).toBeDisabled();
  });
});

