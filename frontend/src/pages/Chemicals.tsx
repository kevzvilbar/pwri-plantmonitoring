import { Navigate } from 'react-router-dom';

/**
 * Chemical Dosing has moved into the RO Trains page
 * under the "Chemical Dosing" tab.
 *
 * This is a proper redirect (not a static page) so:
 * - It uses the router's basename (/pwri-plantmonitoring/ on Vercel)
 * - It deep-links to the Chemical Dosing tab, not Overview
 * - It preserves SPA navigation (no full page reload)
 */
export default function Chemicals() {
  return <Navigate to="/ro-trains?tab=chemical-dosing" replace />;
}
