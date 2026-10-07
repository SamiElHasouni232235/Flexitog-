import { describe, expect, it } from 'vitest';
import { seedDc, seedHubs } from '../data/seed';
import { haversineKm } from './geo';
import { assignStores, generateStores, nearestHubId, servingNodes, DC_NODE_ID } from './stores';
import type { Store } from './types';

const hubs = seedHubs();
const dc = seedDc();

describe('store generation', () => {
  it('creates the store count of each hub inside its radius', () => {
    const stores = generateStores(hubs, 42);
    expect(stores).toHaveLength(hubs.reduce((s, h) => s + h.storeCount, 0));
    for (const st of stores) {
      const hub = hubs.find((h) => h.id === st.homeHubId);
      expect(hub).toBeDefined();
      expect(haversineKm(hub!, st)).toBeLessThanOrEqual(hub!.radiusKm + 1);
    }
  });

  it('is stable for the same seed and changes with another seed', () => {
    const a = generateStores(hubs, 7);
    const b = generateStores(hubs, 7);
    const c = generateStores(hubs, 8);
    expect(a).toEqual(b);
    expect(a[0]?.lat).not.toEqual(c[0]?.lat);
  });

  it('keeps stores of other hubs in place when one hub changes', () => {
    const a = generateStores(hubs, 7);
    const changed = hubs.map((h) => (h.id === 'hub-venlo' ? { ...h, storeCount: 50 } : h));
    const b = generateStores(changed, 7);
    const kontichA = a.filter((s) => s.homeHubId === 'hub-kontich');
    const kontichB = b.filter((s) => s.homeHubId === 'hub-kontich');
    expect(kontichA).toEqual(kontichB);
  });
});

describe('store assignment', () => {
  const store = (id: string, lat: number, lon: number): Store => ({
    id,
    name: id,
    lat,
    lon,
    country: 'DE',
    weeklyVolume: 1,
    homeHubId: null,
    isDummy: true,
  });

  it('assigns each store to the nearest open hub', () => {
    const nodes = servingNodes('stock', hubs.map((h) => h.id), hubs, dc);
    const nearVenlo = store('a', 51.4, 6.2);
    const nearMunich = store('b', 48.2, 11.5);
    const result = assignStores([nearVenlo, nearMunich], nodes, 1.25);
    expect(result[0]?.nodeId).toBe('hub-venlo');
    expect(result[1]?.nodeId).toBe('hub-muenchen');
  });

  it('moves the stores of a closed hub to the nearest open hub', () => {
    const allStores = generateStores(hubs, 11);
    const kassel = hubs.find((h) => h.id === 'hub-kassel')!;
    const openIds = hubs.filter((h) => h.id !== 'hub-kassel').map((h) => h.id);
    const nodes = servingNodes('stock', openIds, hubs, dc);
    const result = assignStores(allStores, nodes, 1.25);
    const byStore = new Map(result.map((r) => [r.storeId, r]));
    const kasselStores = allStores.filter((s) => s.homeHubId === kassel.id);
    expect(kasselStores.length).toBe(kassel.storeCount);
    for (const st of kasselStores) {
      const assigned = byStore.get(st.id)!;
      expect(assigned.nodeId).not.toBe('hub-kassel');
      const expected = nearestHubId(st, hubs.filter((h) => openIds.includes(h.id)));
      expect(assigned.nodeId).toBe(expected);
      // no open hub is closer than the assigned one
      for (const id of openIds) {
        const h = hubs.find((x) => x.id === id)!;
        expect(haversineKm(h, st) * 1.25).toBeGreaterThanOrEqual(assigned.roadKm - 1e-9);
      }
    }
  });

  it('uses the DC as the only node when the model has no hubs', () => {
    const nodes = servingNodes('none', hubs.map((h) => h.id), hubs, dc);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe(DC_NODE_ID);
    const result = assignStores([store('x', 50, 7)], nodes, 1.25);
    expect(result[0]?.nodeId).toBe(DC_NODE_ID);
  });

  it('falls back to the DC when every hub is closed', () => {
    const nodes = servingNodes('stock', [], hubs, dc);
    expect(nodes[0]?.kind).toBe('dc');
  });

  it('stores road km as straight-line km times the road factor', () => {
    const nodes = servingNodes('stock', ['hub-venlo'], hubs, dc);
    const st = store('a', 51.5, 6.3);
    const result = assignStores([st], nodes, 1.3);
    expect(result[0]?.roadKm).toBeCloseTo(haversineKm(hubs[0]!, st) * 1.3, 9);
  });
});
