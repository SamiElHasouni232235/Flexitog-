import { describe, expect, it } from 'vitest';
import {
  adminCost,
  buildingCost,
  dcExtraSpaceCost,
  dcHandlingCost,
  emissionsKg,
  hubHandlingCost,
  inventoryCost,
  lastMileCost,
  linehaulCost,
} from './costs';
import { seedAssumptionValues } from './testUtils';

const a = seedAssumptionValues();

describe('linehaul', () => {
  it('full truck: trips from pallets, truck size and fill rate, round-trip km', () => {
    // 5,200 pallets/year = 100/week. 33 * 0.85 = 28.05 per truck. ceil(100 / 28.05) = 4 trips/week.
    const r = linehaulCost({ mode: 'ftl', pallets: 5200, distanceKm: 200, minTripsPerWeek: 2 }, a);
    expect(r.trips).toBe(4 * 52);
    expect(r.truckKm).toBe(4 * 52 * 400);
    expect(r.cost).toBeCloseTo(4 * 52 * 400 * 1.65, 6);
  });

  it('full truck: applies the minimum trips per week', () => {
    const r = linehaulCost({ mode: 'ftl', pallets: 520, distanceKm: 100, minTripsPerWeek: 5 }, a);
    expect(r.trips).toBe(5 * 52);
  });

  it('groupage: cost per pallet km', () => {
    const r = linehaulCost({ mode: 'groupage', pallets: 1000, distanceKm: 150, minTripsPerWeek: 5 }, a);
    expect(r.cost).toBeCloseTo(1000 * 150 * 0.11, 6);
    expect(r.truckKm).toBeCloseTo((1000 / 28.05) * 150, 6);
  });

  it('returns zero without pallets', () => {
    expect(linehaulCost({ mode: 'ftl', pallets: 0, distanceKm: 100, minTripsPerWeek: 2 }, a).cost).toBe(0);
  });
});

describe('DC handling', () => {
  const v = { pallets: 1000, orders: 2000, lines: 24000 };

  it('stock hubs: pallet handling only', () => {
    const r = dcHandlingCost('stock', v, 60, a);
    expect(r.hours).toBeCloseTo(100, 6);
    expect(r.cost).toBeCloseTo(100 * 32, 6);
    expect(r.fte).toBeCloseTo(100 / 1650, 6);
  });

  it('cross-dock and direct: order picking at the DC', () => {
    const r = dcHandlingCost('cross-dock', v, 60, a);
    // 24000/60 + 2000*6/60 + 1000*6/60 = 400 + 200 + 100
    expect(r.hours).toBeCloseTo(700, 6);
    expect(dcHandlingCost('none', v, 60, a).hours).toBeCloseTo(700, 6);
  });
});

describe('hub handling', () => {
  const v = { pallets: 1000, orders: 2000, lines: 24000 };

  it('own staff at a stock hub: labour hours times the labour rate', () => {
    const r = hubHandlingCost('stock', 'own', v, 60, a);
    expect(r.hours).toBeCloseTo(400 + 100 + 200, 6);
    expect(r.cost).toBeCloseTo(700 * 32, 6);
    expect(r.tplCost).toBe(0);
  });

  it('own staff at a cross-dock hub: no picking', () => {
    const r = hubHandlingCost('cross-dock', 'own', v, 60, a);
    expect(r.hours).toBeCloseTo(300, 6);
  });

  it('3PL at a stock hub: fees per line, pallet and order', () => {
    const r = hubHandlingCost('stock', '3pl', v, 60, a);
    expect(r.cost).toBeCloseTo(24000 * 0.6 + 1000 * 7 + 2000 * 2.5, 6);
    expect(r.fte).toBe(0);
  });

  it('3PL at a cross-dock hub: no line fee', () => {
    expect(hubHandlingCost('cross-dock', '3pl', v, 60, a).cost).toBeCloseTo(1000 * 7 + 2000 * 2.5, 6);
  });

  it('no hubs: zero', () => {
    expect(hubHandlingCost('none', 'own', v, 60, a).cost).toBe(0);
  });
});

describe('buildings', () => {
  it('own stock hub: positions from stock days, floor from positions plus fixed space, rent', () => {
    // 5000 pallets / 250 days * 10 days = 200 positions. 200 * 0.6 + 600 = 720 m².
    const r = buildingCost('stock', 'own', 5000, 10, a);
    expect(r.palletPositions).toBeCloseTo(200, 6);
    expect(r.floorM2).toBeCloseTo(720, 6);
    expect(r.rent).toBeCloseTo(720 * 75, 6);
    expect(r.storage).toBe(0);
  });

  it('3PL stock hub: storage fee per pallet per week, no rent', () => {
    const r = buildingCost('stock', '3pl', 5000, 10, a);
    expect(r.storage).toBeCloseTo(200 * 2.3 * 52, 6);
    expect(r.rent).toBe(0);
  });

  it('cross-dock hub: fixed space only', () => {
    const r = buildingCost('cross-dock', 'own', 5000, 10, a);
    expect(r.palletPositions).toBe(0);
    expect(r.floorM2).toBe(600);
  });

  it('extra DC space at the shared rent', () => {
    expect(dcExtraSpaceCost(1000, a).cost).toBe(75000);
  });
});

describe('inventory carrying', () => {
  it('stock value from stock days times the carrying rate', () => {
    // 2,500,000 / 250 * 10 = 100,000 stock value. 20% = 20,000.
    const r = inventoryCost('stock', 2_500_000, 10, a);
    expect(r.stockValueEur).toBeCloseTo(100_000, 6);
    expect(r.cost).toBeCloseTo(20_000, 6);
  });

  it('no hub stock for cross-dock', () => {
    expect(inventoryCost('cross-dock', 2_500_000, 10, a).cost).toBe(0);
  });
});

describe('last mile', () => {
  it('own vans: routes, km, driver hours and cost', () => {
    const r = lastMileCost({ mode: 'own-vans', stops: 1200, cartons: 5000, avgStoreKm: 40, stopsPerRoute: 12 }, a);
    const routes = 100;
    const routeKm = 2 * 40 + 11 * 8;
    const km = routes * routeKm;
    const hours = km / 50 + (1200 * 15) / 60;
    expect(r.routes).toBe(routes);
    expect(r.vanKm).toBeCloseTo(km, 6);
    expect(r.driverHours).toBeCloseTo(hours, 6);
    expect(r.cost).toBeCloseTo(km * 0.55 + hours * 30, 6);
    expect(r.driverFte).toBeCloseTo(hours / 1650, 6);
  });

  it('carrier: per stop plus per carton', () => {
    const r = lastMileCost({ mode: 'carrier', stops: 1200, cartons: 5000, avgStoreKm: 40, stopsPerRoute: 12 }, a);
    expect(r.cost).toBeCloseTo(1200 * 18 + 5000 * 2.4, 6);
    expect(r.carrierStops).toBe(1200);
    expect(r.vanKm).toBe(0);
  });
});

describe('admin and staffing', () => {
  it('admin FTE from base plus per hub, systems and extra staff', () => {
    const r = adminCost({ adminFteBase: 3, adminFtePerHub: 1, systemsCostPerYear: 120000 }, 5, [
      { id: 'x', role: 'Planner', fte: 2, annualCostPerFte: 50000 },
    ], a);
    expect(r.adminFte).toBe(8);
    expect(r.adminCost).toBe(8 * 62000);
    expect(r.systemsCost).toBe(120000);
    expect(r.extraStaffFte).toBe(2);
    expect(r.extraStaffCost).toBe(100000);
  });
});

describe('emissions', () => {
  it('sums truck km, van km, carrier stops and floor space', () => {
    const kg = emissionsKg({ truckKm: 1000, vanKm: 2000, carrierStops: 300, floorM2: 100 }, a);
    expect(kg).toBeCloseTo(1000 * 0.85 + 2000 * 0.24 + 300 * 0.6 + 100 * 22, 6);
  });
});
