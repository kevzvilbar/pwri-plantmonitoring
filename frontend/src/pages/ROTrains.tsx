/**
 * pages/ROTrains.tsx
 *
 * Thin route re-export pointing to the feature-slice implementation.
 * Route table in App.tsx imports this via lazy(() => import("./pages/ROTrains")).
 */
export { default } from '@/features/ro-trains/ROTrainsPage';
export * from '@/features/ro-trains';
