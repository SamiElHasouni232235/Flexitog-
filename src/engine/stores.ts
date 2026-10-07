import { haversineKm, offsetPoint, roadKm } from './geo';
import type { LatLon } from './geo';
import { hashString, seededRandom } from './random';
import type { DistributionCentre, Hub, HubRole, Store, StoreSet } from './types';

/**
 * Generate stores inside each hub radius. Each hub uses its own seed derived from the
 * set seed and the hub id, so editing one hub leaves the stores of other hubs in place.
 */
export function generateStores(hubs: Hub[], seed: number): Store[] {
  const stores: Store[] = [];
  for (const hub of hubs) {
    const rand = seededRandom(seed ^ hashString(hub.id));
    const count = Math.max(0, Math.round(hub.storeCount));
    for (let i = 0; i < count; i++) {
      const angle = rand() * 2 * Math.PI;
      // sqrt gives a uniform spread over the disc area
      const dist = hub.radiusKm * Math.sqrt(rand());
      const p = offsetPoint(hub, dist, angle);
      stores.push({
        id: `${hub.id}-s${String(i + 1).padStart(3, '0')}`,
        name: `${hub.name} store ${i + 1}`,
        lat: p.lat,
        lon: p.lon,
        country: hub.country,
        weeklyVolume: 1,
        homeHubId: hub.id,
        isDummy: hub.isDummy,
      });
    }
  }
  return stores;
}

/** Nearest hub id by straight-line distance, or null when there are no hubs. */
export function nearestHubId(point: LatLon, hubs: Hub[]): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const hub of hubs) {
    const km = haversineKm(point, hub);
    if (km < bestKm) {
      bestKm = km;
      best = hub.id;
    }
  }
  return best;
}

/** Stores in use: generated from hubs, or imported from CSV with a home hub filled in. */
export function resolveStores(storeSet: StoreSet, hubs: Hub[]): Store[] {
  if (storeSet.mode === 'imported') {
    return storeSet.imported.map((s) => ({
      ...s,
      homeHubId: s.homeHubId && hubs.some((h) => h.id === s.homeHubId) ? s.homeHubId : nearestHubId(s, hubs),
    }));
  }
  return generateStores(hubs, storeSet.seed);
}

export interface ServingNode {
  id: string;
  name: string;
  kind: 'hub' | 'dc';
  lat: number;
  lon: number;
}

export const DC_NODE_ID = 'dc';

/** Serving nodes for a model: the open hubs, or the DC when the model uses no hubs. */
export function servingNodes(
  hubRole: HubRole,
  openHubIds: string[],
  hubs: Hub[],
  dc: DistributionCentre,
): ServingNode[] {
  const open = hubRole === 'none' ? [] : hubs.filter((h) => openHubIds.includes(h.id));
  if (open.length === 0) {
    return [{ id: DC_NODE_ID, name: dc.name, kind: 'dc', lat: dc.lat, lon: dc.lon }];
  }
  return open.map((h) => ({ id: h.id, name: h.name, kind: 'hub', lat: h.lat, lon: h.lon }));
}

export interface StoreAssignment {
  storeId: string;
  nodeId: string;
  /** Road km from serving node to store. */
  roadKm: number;
}

/** Assign each store to the nearest serving node by road distance (haversine times road factor). */
export function assignStores(stores: Store[], nodes: ServingNode[], roadFactor: number): StoreAssignment[] {
  if (nodes.length === 0) return [];
  return stores.map((store) => {
    let bestNode = nodes[0] as ServingNode;
    let bestKm = Infinity;
    for (const node of nodes) {
      const km = roadKm(node, store, roadFactor);
      if (km < bestKm) {
        bestKm = km;
        bestNode = node;
      }
    }
    return { storeId: store.id, nodeId: bestNode.id, roadKm: bestKm };
  });
}
