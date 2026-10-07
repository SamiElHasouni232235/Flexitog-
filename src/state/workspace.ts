// Pure workspace helpers: validation on import, and the clear action.
import { WORKSPACE_VERSION, seedAssumptions, seedSettings, seedWorkspace } from '../data/seed';
import type { Assumption, Workspace } from '../engine/types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check and complete a workspace read from JSON or localStorage.
 * Missing sections come from the seed. Missing assumption keys are added with their dummy value.
 * Throws when the shape is not a workspace.
 */
export function normaliseWorkspace(raw: unknown): Workspace {
  if (!isObject(raw)) throw new Error('The file is not a workspace object.');
  const seed = seedWorkspace();
  const arrays = ['products', 'hubs', 'scenarios', 'models', 'criteria', 'assumptions'] as const;
  for (const key of arrays) {
    if (key in raw && !Array.isArray(raw[key])) throw new Error(`Field "${key}" must be a list.`);
  }
  if (!Array.isArray(raw.products) && !Array.isArray(raw.models) && !Array.isArray(raw.hubs)) {
    throw new Error('The file has no products, hubs or models. It does not look like a workspace export.');
  }
  const ws = raw as Partial<Workspace>;
  const byKey = new Map((ws.assumptions ?? []).map((a) => [a.key, a]));
  const assumptions: Assumption[] = seedAssumptions().map((s) => {
    const found = byKey.get(s.key);
    return found && typeof found.value === 'number' ? { ...s, value: found.value, isDummy: found.isDummy !== false } : s;
  });
  const models = (ws.models ?? seed.models).map((m) => ({
    ...m,
    strengths: m.strengths ?? [],
    weaknesses: m.weaknesses ?? [],
    tags: m.tags ?? [],
    openHubIds: m.openHubIds ?? [],
    extraStaff: m.extraStaff ?? [],
    costOverrides: m.costOverrides ?? {},
    ratings: m.ratings ?? {},
    customParams: m.customParams ?? [],
  }));
  const scenarios = ws.scenarios ?? seed.scenarios;
  const settings = { ...seedSettings(), ...(ws.settings ?? {}) };
  if (!models.some((m) => m.id === settings.baselineModelId)) settings.baselineModelId = models[0]?.id ?? '';
  if (!scenarios.some((s) => s.id === settings.selectedScenarioId)) settings.selectedScenarioId = scenarios[0]?.id ?? '';
  return {
    version: WORKSPACE_VERSION,
    products: ws.products ?? seed.products,
    dc: { ...seed.dc, ...(ws.dc ?? {}) },
    hubs: ws.hubs ?? seed.hubs,
    storeSet: { ...seed.storeSet, ...(ws.storeSet ?? {}) },
    scenarios,
    models,
    criteria: ws.criteria ?? seed.criteria,
    assumptions,
    settings,
  };
}

/**
 * Remove every record still marked dummy. Dummy cost assumptions are set to 0 and stay
 * flagged so the user enters real values. The DC stays in place, as the network needs one.
 */
export function clearDummyData(ws: Workspace): Workspace {
  const hubs = ws.hubs.filter((h) => !h.isDummy);
  const hubIds = new Set(hubs.map((h) => h.id));
  const products = ws.products.filter((p) => !p.isDummy);
  const productIds = new Set(products.map((p) => p.id));
  const models = ws.models
    .filter((m) => !m.isDummy)
    .map((m) => ({ ...m, openHubIds: m.openHubIds.filter((id) => hubIds.has(id)) }));
  const scenarios = ws.scenarios
    .filter((s) => !s.isDummy)
    .map((s) => ({
      ...s,
      testOrder: { ...s.testOrder, lines: s.testOrder.lines.filter((l) => productIds.has(l.productId)) },
    }));
  const storeSet = ws.storeSet.isDummy
    ? { ...ws.storeSet, mode: 'imported' as const, imported: ws.storeSet.imported.filter((s) => !s.isDummy), isDummy: false }
    : ws.storeSet;
  return {
    ...ws,
    products,
    hubs,
    storeSet,
    scenarios,
    models,
    assumptions: ws.assumptions.map((a) => (a.isDummy ? { ...a, value: 0 } : a)),
    settings: {
      ...ws.settings,
      baselineModelId: models.some((m) => m.id === ws.settings.baselineModelId) ? ws.settings.baselineModelId : models[0]?.id ?? '',
      selectedScenarioId: scenarios.some((s) => s.id === ws.settings.selectedScenarioId)
        ? ws.settings.selectedScenarioId
        : scenarios[0]?.id ?? '',
    },
  };
}
