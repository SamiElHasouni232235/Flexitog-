import type { Workspace } from './types';

export interface DummyCount {
  dummy: number;
  total: number;
  groups: Array<{ label: string; dummy: number; total: number }>;
}

/**
 * Count inputs still marked dummy. Inputs: products, DC, hubs, store set, cost assumptions,
 * models and the selected scenario (or all scenarios when none is given).
 */
export function countDummyInputs(ws: Workspace, scenarioId?: string): DummyCount {
  const scenarios = scenarioId ? ws.scenarios.filter((s) => s.id === scenarioId) : ws.scenarios;
  const groups = [
    { label: 'Products', items: ws.products },
    { label: 'DC', items: [ws.dc] },
    { label: 'Hubs', items: ws.hubs },
    { label: 'Store set', items: [ws.storeSet] },
    { label: scenarioId ? 'Scenario' : 'Scenarios', items: scenarios },
    { label: 'Models', items: ws.models },
    { label: 'Cost assumptions', items: ws.assumptions },
  ].map((g) => ({ label: g.label, dummy: g.items.filter((i) => i.isDummy).length, total: g.items.length }));
  return {
    dummy: groups.reduce((s, g) => s + g.dummy, 0),
    total: groups.reduce((s, g) => s + g.total, 0),
    groups,
  };
}
