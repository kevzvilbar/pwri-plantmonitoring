import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/plants': 'Plants & Wells',
  '/operations': 'Daily Logs',
  '/ro-trains': 'RO Trains',
  '/topology': 'Plant Network Topology',
  '/data-analysis': 'Data Analysis',
  '/costs': 'Costs & Finance',
  '/maintenance': 'Preventive Maintenance',
  '/incidents': 'Incidents',
  '/employees': 'Employees & Teams',
  '/data-corrections': 'Data Corrections',
  '/manager-scorecard': 'Manager Scorecard',
  '/import': 'Smart Import',
  '/exports': 'Data Exports',
  '/compliance': 'Compliance & Reports',
  '/alerts': 'Alerts',
  '/admin': 'Admin Console',
  '/profile': 'User Profile',
  '/help': 'Help & Documentation',
  '/my-corrections': 'My Corrections',
  '/auth': 'Sign In',
  '/onboarding': 'Onboarding',
  '/pending-approval': 'Pending Approval',
};

const APP_NAME = 'PWRI Plant Monitoring';

export function useDocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Check exact match or prefix match
    const title = ROUTE_TITLES[pathname] ||
      Object.entries(ROUTE_TITLES).find(([route]) => route !== '/' && pathname.startsWith(route))?.[1] ||
      '';

    if (title) {
      document.title = `${title} | ${APP_NAME}`;
    } else {
      document.title = APP_NAME;
    }
  }, [pathname]);
}
