import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { seedAssumptions, seedWorkspace } from '../data/seed';
import { resolveStores } from '../engine/stores';
import type {
  Assumption,
  AssumptionKey,
  Criterion,
  DistributionCentre,
  Hub,
  Model,
  Product,
  Scenario,
  Settings,
  Store,
  StoreSet,
  Workspace,
} from '../engine/types';
import { clearDummyData, normaliseWorkspace } from './workspace';

interface Actions {
  addProduct: (p: Product) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  removeProduct: (id: string) => void;

  updateDc: (patch: Partial<DistributionCentre>) => void;
  addHub: (h: Hub) => void;
  updateHub: (id: string, patch: Partial<Hub>) => void;
  removeHub: (id: string) => void;

  updateStoreSet: (patch: Partial<StoreSet>) => void;
  importStores: (stores: Store[]) => void;

  addScenario: (s: Scenario) => void;
  updateScenario: (id: string, patch: Partial<Scenario>) => void;
  removeScenario: (id: string) => void;

  addModel: (m: Model) => void;
  updateModel: (id: string, patch: Partial<Model>) => void;
  removeModel: (id: string) => void;

  addCriterion: (c: Criterion) => void;
  updateCriterion: (id: string, patch: Partial<Criterion>) => void;
  removeCriterion: (id: string) => void;

  updateAssumption: (key: AssumptionKey, patch: Partial<Assumption>) => void;
  resetAssumptions: () => void;

  updateSettings: (patch: Partial<Settings>) => void;

  importWorkspace: (raw: unknown) => void;
  resetToDummy: () => void;
  clearDummy: () => void;
}

export interface AppState extends Actions {
  ws: Workspace;
}

const patchById = <T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] =>
  list.map((x) => (x.id === id ? { ...x, ...patch } : x));

export const useApp = create<AppState>()(
  persist(
    (set) => {
      const update = (fn: (ws: Workspace) => Workspace) => set((s) => ({ ws: fn(s.ws) }));
      return {
        ws: seedWorkspace(),

        addProduct: (p) => update((ws) => ({ ...ws, products: [...ws.products, p] })),
        updateProduct: (id, patch) => update((ws) => ({ ...ws, products: patchById(ws.products, id, patch) })),
        removeProduct: (id) =>
          update((ws) => ({
            ...ws,
            products: ws.products.filter((p) => p.id !== id),
            scenarios: ws.scenarios.map((s) => ({
              ...s,
              testOrder: { ...s.testOrder, lines: s.testOrder.lines.filter((l) => l.productId !== id) },
            })),
          })),

        updateDc: (patch) => update((ws) => ({ ...ws, dc: { ...ws.dc, ...patch } })),
        addHub: (h) =>
          update((ws) => ({
            ...ws,
            hubs: [...ws.hubs, h],
          })),
        updateHub: (id, patch) => update((ws) => ({ ...ws, hubs: patchById(ws.hubs, id, patch) })),
        removeHub: (id) =>
          update((ws) => ({
            ...ws,
            hubs: ws.hubs.filter((h) => h.id !== id),
            models: ws.models.map((m) => ({ ...m, openHubIds: m.openHubIds.filter((x) => x !== id) })),
          })),

        updateStoreSet: (patch) => update((ws) => ({ ...ws, storeSet: { ...ws.storeSet, ...patch } })),
        importStores: (stores) =>
          update((ws) => ({ ...ws, storeSet: { ...ws.storeSet, mode: 'imported', imported: stores, isDummy: false } })),

        addScenario: (s) =>
          update((ws) => ({ ...ws, scenarios: [...ws.scenarios, s], settings: { ...ws.settings, selectedScenarioId: s.id } })),
        updateScenario: (id, patch) => update((ws) => ({ ...ws, scenarios: patchById(ws.scenarios, id, patch) })),
        removeScenario: (id) =>
          update((ws) => {
            const scenarios = ws.scenarios.filter((s) => s.id !== id);
            const selected = ws.settings.selectedScenarioId === id ? scenarios[0]?.id ?? '' : ws.settings.selectedScenarioId;
            return { ...ws, scenarios, settings: { ...ws.settings, selectedScenarioId: selected } };
          }),

        addModel: (m) => update((ws) => ({ ...ws, models: [...ws.models, m] })),
        updateModel: (id, patch) => update((ws) => ({ ...ws, models: patchById(ws.models, id, patch) })),
        removeModel: (id) =>
          update((ws) => {
            const models = ws.models.filter((m) => m.id !== id);
            const baseline = ws.settings.baselineModelId === id ? models[0]?.id ?? '' : ws.settings.baselineModelId;
            return { ...ws, models, settings: { ...ws.settings, baselineModelId: baseline } };
          }),

        addCriterion: (c) => update((ws) => ({ ...ws, criteria: [...ws.criteria, c] })),
        updateCriterion: (id, patch) => update((ws) => ({ ...ws, criteria: patchById(ws.criteria, id, patch) })),
        removeCriterion: (id) => update((ws) => ({ ...ws, criteria: ws.criteria.filter((c) => c.id !== id) })),

        updateAssumption: (key, patch) =>
          update((ws) => ({ ...ws, assumptions: ws.assumptions.map((a) => (a.key === key ? { ...a, ...patch } : a)) })),
        resetAssumptions: () => update((ws) => ({ ...ws, assumptions: seedAssumptions() })),

        updateSettings: (patch) => update((ws) => ({ ...ws, settings: { ...ws.settings, ...patch } })),

        importWorkspace: (raw) => {
          const ws = normaliseWorkspace(raw);
          set({ ws });
        },
        resetToDummy: () =>
          set((s) => ({ ws: { ...seedWorkspace(), settings: { ...seedWorkspace().settings, theme: s.ws.settings.theme } } })),
        clearDummy: () => update(clearDummyData),
      };
    },
    {
      name: 'supply-chain-benchmark-workspace',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ ws: s.ws }),
      merge: (persisted, current) => {
        try {
          const p = persisted as { ws?: unknown } | undefined;
          if (p?.ws) return { ...current, ws: normaliseWorkspace(p.ws) };
        } catch {
          // fall back to the seed when stored data is broken
        }
        return current;
      },
    },
  ),
);

/** Stores in use, regenerated only when hubs or the store set change. */
export function useStores(): Store[] {
  const hubs = useApp((s) => s.ws.hubs);
  const storeSet = useApp((s) => s.ws.storeSet);
  return useMemo(() => resolveStores(storeSet, hubs), [storeSet, hubs]);
}

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
