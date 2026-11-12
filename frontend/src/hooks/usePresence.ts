import { createContext, useContext } from 'react';

export interface PresenceContextValue {
  /** True if userId has been seen active within the last 15 minutes. */
  isUserOnline: (userId?: string | null) => boolean;
  /** Immediately update user_profiles.updated_at for the current user. */
  stampActivity: () => void;
}

export const PresenceContext = createContext<PresenceContextValue>({
  isUserOnline: () => false,
  stampActivity: () => {},
});

export function usePresence() {
  return useContext(PresenceContext);
}

export { PresenceProvider } from './PresenceProvider';
