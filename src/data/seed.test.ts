import { describe, expect, it } from 'vitest';
import { seedWorkspace } from './seed';

describe('dummy seed data', () => {
  const ws = seedWorkspace();

  it('seeds 20 products named Dummy product A to T across three categories', () => {
    expect(ws.products).toHaveLength(20);
    expect(ws.products[0]?.name).toBe('Dummy product A');
    expect(ws.products[19]?.name).toBe('Dummy product T');
    expect(new Set(ws.products.map((p) => p.category))).toEqual(new Set(['small', 'standard', 'bulky']));
  });

  it('has a sales mix of 100%', () => {
    const total = ws.products.reduce((s, p) => s + p.salesMixPct, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it('seeds five hubs with store counts between 90 and 140', () => {
    expect(ws.hubs.map((h) => h.name)).toEqual(['Venlo', 'Kontich', 'Mannheim', 'Kassel', 'München']);
    for (const hub of ws.hubs) {
      expect(hub.storeCount).toBeGreaterThanOrEqual(90);
      expect(hub.storeCount).toBeLessThanOrEqual(140);
    }
  });

  it('seeds three scenarios, five models and seven criteria', () => {
    expect(ws.scenarios.map((s) => s.type)).toEqual(['test-order', 'forecast', 'target']);
    expect(ws.models).toHaveLength(5);
    expect(ws.criteria).toHaveLength(7);
  });

  it('marks every seeded record as dummy', () => {
    const records = [
      ...ws.products,
      ws.dc,
      ...ws.hubs,
      ws.storeSet,
      ...ws.scenarios,
      ...ws.models,
      ...ws.assumptions,
    ];
    expect(records.every((r) => r.isDummy === true)).toBe(true);
  });

  it('labels the DC location as to be confirmed', () => {
    expect(ws.dc.locationToConfirm).toBe(true);
  });
});
