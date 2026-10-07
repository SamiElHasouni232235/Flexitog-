import { describe, expect, it } from 'vitest';
import { seedHubs, seedProducts, seedScenarios } from '../data/seed';
import { nodeDemands, storeDemands } from './demand';
import { lineProfile, mixProfilePerUnit, productTotals, summariseTestOrder } from './products';
import { generateStores } from './stores';
import type { Product, Scenario } from './types';

const products = seedProducts();
const hubs = seedHubs();
const stores = generateStores(hubs, 3);

const product = (over: Partial<Product>): Product => ({
  id: 'p',
  sku: 'P',
  name: 'P',
  category: 'small',
  unitKg: 1,
  unitsPerCarton: 10,
  cartonsPerPallet: 50,
  unitValueEur: 5,
  salesMixPct: 50,
  isDummy: true,
  ...over,
});

describe('product mix', () => {
  it('builds a per-unit profile from the normalised mix', () => {
    const p = mixProfilePerUnit([
      product({ id: 'a', salesMixPct: 30, unitsPerCarton: 10, cartonsPerPallet: 50, unitKg: 1, unitValueEur: 4 }),
      product({ id: 'b', salesMixPct: 10, unitsPerCarton: 2, cartonsPerPallet: 20, unitKg: 5, unitValueEur: 20 }),
    ]);
    expect(p.units).toBeCloseTo(1, 9);
    expect(p.cartons).toBeCloseTo(0.75 / 10 + 0.25 / 2, 9);
    expect(p.pallets).toBeCloseTo(0.75 / 500 + 0.25 / 40, 9);
    expect(p.kg).toBeCloseTo(0.75 + 1.25, 9);
    expect(p.valueEur).toBeCloseTo(3 + 5, 9);
  });

  it('rounds cartons up per order line', () => {
    const p = lineProfile(product({ unitsPerCarton: 12, cartonsPerPallet: 60 }), 25);
    expect(p.cartons).toBe(3);
    expect(p.pallets).toBeCloseTo(3 / 60, 9);
  });

  it('gives mix totals and averages for the products screen', () => {
    const t = productTotals(products);
    expect(t.mixPct).toBeCloseTo(100, 6);
    expect(t.unitsPerPallet).toBeGreaterThan(0);
    expect(t.valuePerUnit).toBeGreaterThan(0);
  });
});

describe('scenario demand', () => {
  const volumeScenario = seedScenarios()[1] as Scenario;

  it('volume mode: spreads annual units over stores and derives orders and lines', () => {
    const d = storeDemands(volumeScenario, stores, products, hubs, 52);
    const units = d.reduce((s, x) => s + x.units, 0);
    const orders = d.reduce((s, x) => s + x.orders, 0);
    expect(units).toBeCloseTo(volumeScenario.volume.annualUnits, 3);
    expect(orders).toBeCloseTo(stores.length * 1 * 52, 6);
    expect(d.reduce((s, x) => s + x.lines, 0)).toBeCloseTo(orders * 12, 6);
  });

  it('volume mode: store growth factor raises orders, not units', () => {
    const grown: Scenario = { ...volumeScenario, volume: { ...volumeScenario.volume, storeGrowthFactor: 1.2 } };
    const d = storeDemands(grown, stores, products, hubs, 52);
    expect(d.reduce((s, x) => s + x.orders, 0)).toBeCloseTo(stores.length * 1.2 * 52, 6);
    expect(d.reduce((s, x) => s + x.units, 0)).toBeCloseTo(volumeScenario.volume.annualUnits, 3);
  });

  it('test order mode: converts lines and scales to a year', () => {
    const storeId = stores[0]!.id;
    const scenario: Scenario = {
      ...volumeScenario,
      mode: 'test-order',
      testOrder: {
        annualisationFactor: 52,
        lines: [
          { id: '1', targetId: storeId, productId: 'prod-a', quantity: 96 },
          { id: '2', targetId: storeId, productId: 'prod-t', quantity: 3 },
        ],
      },
    };
    const d = storeDemands(scenario, stores, products, hubs, 52);
    const s = d.find((x) => x.storeId === storeId)!;
    expect(s.units).toBeCloseTo(99 * 52, 6);
    expect(s.orders).toBe(52);
    expect(s.lines).toBe(104);
    // product A: 48 per carton -> 2 cartons. product T: 1 per carton -> 3 cartons
    expect(s.cartons).toBeCloseTo(5 * 52, 6);
    expect(d.filter((x) => x.orders > 0)).toHaveLength(1);
  });

  it('test order mode: a hub line spreads over the hub stores', () => {
    const venloStores = stores.filter((s) => s.homeHubId === 'hub-venlo');
    const scenario: Scenario = {
      ...volumeScenario,
      mode: 'test-order',
      testOrder: { annualisationFactor: 1, lines: [{ id: '1', targetId: 'hub-venlo', productId: 'prod-a', quantity: 1280 }] },
    };
    const d = storeDemands(scenario, stores, products, hubs, 52);
    const ordering = d.filter((x) => x.orders > 0);
    expect(ordering).toHaveLength(venloStores.length);
    expect(d.reduce((s, x) => s + x.units, 0)).toBeCloseTo(1280, 6);
    expect(d.reduce((s, x) => s + x.lines, 0)).toBeCloseTo(Math.min(1280, venloStores.length), 6);
  });

  it('test order summary matches the engine totals', () => {
    const scenario = seedScenarios()[0] as Scenario;
    const summary = summariseTestOrder(scenario.testOrder.lines, products, stores, hubs);
    const d = storeDemands({ ...scenario, testOrder: { ...scenario.testOrder, annualisationFactor: 1 } }, stores, products, hubs, 52);
    expect(summary.invalidLines).toBe(0);
    expect(d.reduce((s, x) => s + x.units, 0)).toBeCloseTo(summary.units, 6);
    expect(d.reduce((s, x) => s + x.orders, 0)).toBeCloseTo(summary.orders, 6);
    expect(d.reduce((s, x) => s + x.lines, 0)).toBeCloseTo(summary.lines, 6);
    expect(d.reduce((s, x) => s + x.cartons, 0)).toBeCloseTo(summary.cartons, 6);
  });

  it('sums store demand per node with an order-weighted average distance', () => {
    const demands = [
      { storeId: 'a', units: 10, cartons: 1, pallets: 0.1, kg: 1, valueEur: 1, orders: 10, lines: 20, storeCount: 1 },
      { storeId: 'b', units: 30, cartons: 3, pallets: 0.3, kg: 3, valueEur: 3, orders: 30, lines: 60, storeCount: 1 },
    ];
    const n = nodeDemands(
      demands,
      [
        { storeId: 'a', nodeId: 'x', roadKm: 10 },
        { storeId: 'b', nodeId: 'x', roadKm: 50 },
      ],
      ['x', 'y'],
    );
    expect(n[0]!.units).toBe(40);
    expect(n[0]!.avgStoreKm).toBeCloseTo((10 * 10 + 30 * 50) / 40, 9);
    expect(n[1]!.units).toBe(0);
  });
});
