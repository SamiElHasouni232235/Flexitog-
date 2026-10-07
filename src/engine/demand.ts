import { addProfiles, emptyProfile, lineProfile, mixProfilePerUnit, scaleProfile } from './products';
import type { Profile } from './products';
import type { StoreAssignment } from './stores';
import type { Hub, Product, Scenario, Store } from './types';

/** Annual demand of one store location. */
export interface StoreDemand extends Profile {
  storeId: string;
  orders: number;
  lines: number;
  /** Number of stores this location represents (store growth factor times scale). */
  storeCount: number;
}

/** Annual demand of one serving node. */
export interface NodeDemand extends Profile {
  nodeId: string;
  orders: number;
  lines: number;
  storeCount: number;
  /** Order-weighted average road km from the node to its stores. */
  avgStoreKm: number;
}

export interface DemandScale {
  volume: number;
  stores: number;
}

export const UNIT_SCALE: DemandScale = { volume: 1, stores: 1 };

/** Annual demand per store from a scenario. */
export function storeDemands(
  scenario: Scenario,
  stores: Store[],
  products: Product[],
  hubs: Hub[],
  weeksPerYear: number,
  scale: DemandScale = UNIT_SCALE,
): StoreDemand[] {
  if (scenario.mode === 'volume') return volumeDemands(scenario, stores, products, weeksPerYear, scale);
  return testOrderDemands(scenario, stores, products, hubs, scale);
}

function volumeDemands(
  scenario: Scenario,
  stores: Store[],
  products: Product[],
  weeksPerYear: number,
  scale: DemandScale,
): StoreDemand[] {
  const v = scenario.volume;
  const perUnit = mixProfilePerUnit(products);
  const totalWeight = stores.reduce((s, st) => s + Math.max(0, st.weeklyVolume), 0);
  const storeFactor = Math.max(0, v.storeGrowthFactor) * scale.stores;
  return stores.map((st) => {
    const share = totalWeight > 0 ? Math.max(0, st.weeklyVolume) / totalWeight : 0;
    const units = v.annualUnits * scale.volume * share;
    const orders = storeFactor * v.deliveriesPerStorePerWeek * weeksPerYear;
    return {
      storeId: st.id,
      ...scaleProfile(perUnit, units),
      orders,
      lines: orders * v.linesPerOrder,
      storeCount: storeFactor,
    };
  });
}

function testOrderDemands(
  scenario: Scenario,
  stores: Store[],
  products: Product[],
  hubs: Hub[],
  scale: DemandScale,
): StoreDemand[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const hubIds = new Set(hubs.map((h) => h.id));
  const byStore = new Map<string, { profile: Profile; lines: number; ordered: boolean }>();
  const storesByHub = new Map<string, Store[]>();
  for (const st of stores) {
    byStore.set(st.id, { profile: emptyProfile(), lines: 0, ordered: false });
    if (st.homeHubId) {
      const list = storesByHub.get(st.homeHubId) ?? [];
      list.push(st);
      storesByHub.set(st.homeHubId, list);
    }
  }
  for (const line of scenario.testOrder.lines) {
    const product = productById.get(line.productId);
    if (!product || line.quantity <= 0) continue;
    const direct = byStore.get(line.targetId);
    if (direct) {
      direct.profile = addProfiles(direct.profile, lineProfile(product, line.quantity));
      direct.lines += 1;
      direct.ordered = true;
      continue;
    }
    if (!hubIds.has(line.targetId)) continue;
    const hubStores = storesByHub.get(line.targetId) ?? [];
    const n = hubStores.length;
    if (n === 0) continue;
    const share = scaleProfile(lineProfile(product, line.quantity), 1 / n);
    const linesEach = Math.min(line.quantity, n) / n;
    for (const st of hubStores) {
      const d = byStore.get(st.id);
      if (!d) continue;
      d.profile = addProfiles(d.profile, share);
      d.lines += linesEach;
      d.ordered = true;
    }
  }
  const f = Math.max(0, scenario.testOrder.annualisationFactor);
  return stores.map((st) => {
    const d = byStore.get(st.id) ?? { profile: emptyProfile(), lines: 0, ordered: false };
    return {
      storeId: st.id,
      ...scaleProfile(d.profile, f * scale.volume),
      orders: d.ordered ? f * scale.stores : 0,
      lines: d.lines * f * scale.stores,
      storeCount: d.ordered ? scale.stores : 0,
    };
  });
}

/** Sum store demand per serving node using the store assignment. */
export function nodeDemands(demands: StoreDemand[], assignments: StoreAssignment[], nodeIds: string[]): NodeDemand[] {
  const assignment = new Map(assignments.map((a) => [a.storeId, a]));
  const acc = new Map<string, NodeDemand & { kmOrders: number }>();
  for (const id of nodeIds) {
    acc.set(id, { nodeId: id, ...emptyProfile(), orders: 0, lines: 0, storeCount: 0, avgStoreKm: 0, kmOrders: 0 });
  }
  for (const d of demands) {
    const a = assignment.get(d.storeId);
    if (!a) continue;
    const n = acc.get(a.nodeId);
    if (!n) continue;
    n.units += d.units;
    n.cartons += d.cartons;
    n.pallets += d.pallets;
    n.kg += d.kg;
    n.valueEur += d.valueEur;
    n.orders += d.orders;
    n.lines += d.lines;
    n.storeCount += d.storeCount;
    n.kmOrders += d.orders * a.roadKm;
  }
  return nodeIds.map((id) => {
    const { kmOrders, ...n } = acc.get(id) as NodeDemand & { kmOrders: number };
    return { ...n, avgStoreKm: n.orders > 0 ? kmOrders / n.orders : 0 };
  });
}
