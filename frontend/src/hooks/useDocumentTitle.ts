import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getTabDocumentTitle } from '@/shared/tabRegistry';

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/plants': 'Plants',
  '/operations': 'Daily Readings',
  '/ro-trains': 'RO Trains',
  '/hydraulics': 'Hydraulics',
  '/topology': 'Network Topology',
  '/data-analysis': 'Data Analysis & Review',
  '/costs': 'Costs & Tariffs',
  '/maintenance': 'PM Schedule',
  '/incidents': 'Incidents',
  '/employees': 'Employees',
  '/data-corrections': 'Data Corrections',
  '/manager-scorecard': 'Manager Scorecard',
  '/import': 'Smart Import',
  '/exports': 'Data Exports',
  '/compliance': 'Compliance',
  '/alerts': 'Alerts',
  '/admin': 'Admin Console',
  '/profile': 'Profile',
  '/help': 'Help & Manual',
  '/my-corrections': 'My Corrections',
  '/auth': 'Sign In',
  '/onboarding': 'Onboarding',
  '/pending-approval': 'Pending Approval',
};

const APP_NAME = 'PWRI Plant Monitoring';

export function useDocumentTitle() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const sp = new URLSearchParams(search);
    const tab = sp.get('tab');

    if (tab) {
      const tabTitle = getTabDocumentTitle(pathname, tab);
      if (tabTitle) {
        document.title = tabTitle;
        return;
      }
    }

    // Check exact match or prefix match
    const title =
      ROUTE_TITLES[pathname] ||
      Object.entries(ROUTE_TITLES).find(([route]) => route !== '/' && pathname.startsWith(route))?.[1] ||
      '';

    if (title) {
      document.title = `${title} | ${APP_NAME}`;
    } else {
      document.title = APP_NAME;
    }
  }, [pathname, search]);
}
