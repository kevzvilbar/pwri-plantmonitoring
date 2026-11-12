export type PlantTab = 'locators' | 'wells' | 'product' | 'trains' | 'power' | 'configuration';

const PLANT_TAB_PREFIX = 'plant';
export const plantTabId = (id: PlantTab) => `${PLANT_TAB_PREFIX}-tab-${id}`;
export const plantTabPanelId = (id: PlantTab) => `${PLANT_TAB_PREFIX}-tabpanel-${id}`;
