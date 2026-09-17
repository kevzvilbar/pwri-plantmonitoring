import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PushNotificationCard } from './PushNotificationCard';

const mockSubscribeToPush = vi.fn();
const mockUnsubscribeFromPush = vi.fn();
const mockSendLocalTestNotification = vi.fn();

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({
    isSupported: true,
    permission: 'granted',
    isSubscribed: true,
    isPending: false,
    isIOSNonStandalone: false,
    subscription: { endpoint: 'https://push.example.com' },
    subscribeToPush: mockSubscribeToPush,
    unsubscribeFromPush: mockUnsubscribeFromPush,
    sendLocalTestNotification: mockSendLocalTestNotification,
    checkSubscription: vi.fn(),
  }),
}));

describe('PushNotificationCard', () => {
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
});

