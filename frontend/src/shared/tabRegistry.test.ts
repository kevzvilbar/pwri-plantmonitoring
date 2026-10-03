import { describe, it, expect } from 'vitest';
import { TAB_REGISTRY, searchTabs, getTabDocumentTitle } from './tabRegistry';
import { MODULE_LABELS } from '@/lib/permissions';

describe('tabRegistry', () => {
  it('every tab has a valid id, label, route, and recognized module', () => {
    expect(TAB_REGISTRY.length).toBeGreaterThanOrEqual(30);
    const validModules = new Set(Object.keys(MODULE_LABELS));

    for (const tab of TAB_REGISTRY) {
      expect(tab.id).toBeTruthy();
      expect(tab.label).toBeTruthy();
      expect(tab.route.startsWith('/')).toBe(true);
      expect(tab.pageName).toBeTruthy();
      expect(validModules.has(tab.module)).toBe(true);
    }
  });

  it('tab ids are unique within each parent route', () => {
    const routeTabs = new Map<string, Set<string>>();
    for (const tab of TAB_REGISTRY) {
      if (!routeTabs.has(tab.route)) {
        routeTabs.set(tab.route, new Set());
      }
      const set = routeTabs.get(tab.route)!;
      expect(set.has(tab.id)).toBe(false);
      set.add(tab.id);
    }
  });

  it('searchTabs finds tabs by label and keyword matching permissions', () => {
    const canAll = () => true;
    const canNone = () => false;

    const budgetHits = searchTabs('budget', canAll);
    expect(budgetHits.some((t) => t.id === 'budget' && t.route === '/costs')).toBe(true);

    const noHits = searchTabs('budget', canNone);
    expect(noHits.length).toBe(0);

    const thresholdHits = searchTabs('limits', canAll);
    expect(thresholdHits.some((t) => t.id === 'thresholds' && t.route === '/compliance')).toBe(true);
  });

  it('getTabDocumentTitle formats title accurately', () => {
    expect(getTabDocumentTitle('/costs', 'budget')).toBe('Costs & Tariffs · OPEX Budget | PWRI Plant Monitoring');
    expect(getTabDocumentTitle('/compliance', 'whatif')).toBe('Compliance · What-If Simulation | PWRI Plant Monitoring');
    expect(getTabDocumentTitle('/operations', 'locators')).toBe('Daily Readings · Locators | PWRI Plant Monitoring');
    expect(getTabDocumentTitle('/unknown', 'foo')).toBeNull();
  });
});
