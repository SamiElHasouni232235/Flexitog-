import type { Hub, OrderLine, Product, Store } from './types';

/** Physical and value totals for a quantity of goods. */
export interface Profile {
  units: number;
  cartons: number;
  pallets: number;
  kg: number;
  valueEur: number;
}

export const emptyProfile = (): Profile => ({ units: 0, cartons: 0, pallets: 0, kg: 0, valueEur: 0 });

export function addProfiles(a: Profile, b: Profile): Profile {
  return {
    units: a.units + b.units,
    cartons: a.cartons + b.cartons,
    pallets: a.pallets + b.pallets,
    kg: a.kg + b.kg,
    valueEur: a.valueEur + b.valueEur,
  };
}

export function scaleProfile(p: Profile, f: number): Profile {
  return { units: p.units * f, cartons: p.cartons * f, pallets: p.pallets * f, kg: p.kg * f, valueEur: p.valueEur * f };
}

const safeDiv = (a: number, b: number): number => (b > 0 ? a / b : 0);

/**
 * Profile of one average unit from the sales mix. Mix shares are normalised to 100%.
 * cartons per unit = sum(w / unitsPerCarton), pallets per unit = sum(w / (unitsPerCarton * cartonsPerPallet)).
 */
export function mixProfilePerUnit(products: Product[]): Profile {
  const totalMix = products.reduce((s, p) => s + Math.max(0, p.salesMixPct), 0);
  if (totalMix <= 0) return emptyProfile();
  return products.reduce<Profile>((acc, p) => {
    const w = Math.max(0, p.salesMixPct) / totalMix;
    return {
      units: acc.units + w,
      cartons: acc.cartons + safeDiv(w, p.unitsPerCarton),
      pallets: acc.pallets + safeDiv(w, p.unitsPerCarton * p.cartonsPerPallet),
      kg: acc.kg + w * p.unitKg,
      valueEur: acc.valueEur + w * p.unitValueEur,
    };
  }, emptyProfile());
}

/** Profile of one order line. Cartons round up per line; pallets are carton fractions of a pallet. */
export function lineProfile(product: Product, quantity: number): Profile {
  const qty = Math.max(0, quantity);
  const cartons = product.unitsPerCarton > 0 ? Math.ceil(qty / product.unitsPerCarton) : 0;
  return {
    units: qty,
    cartons,
    pallets: safeDiv(cartons, product.cartonsPerPallet),
    kg: qty * product.unitKg,
    valueEur: qty * product.unitValueEur,
  };
}

export interface ProductTotals {
  mixPct: number;
  unitsPerPallet: number;
  valuePerUnit: number;
  kgPerUnit: number;
  unitsPerCarton: number;
}

/** Mix totals and weighted averages for the products screen. */
export function productTotals(products: Product[]): ProductTotals {
  const mixPct = products.reduce((s, p) => s + p.salesMixPct, 0);
  const per = mixProfilePerUnit(products);
  return {
    mixPct,
    unitsPerPallet: safeDiv(1, per.pallets),
    valuePerUnit: per.valueEur,
    kgPerUnit: per.kg,
    unitsPerCarton: safeDiv(1, per.cartons),
  };
}

export interface TestOrderSummary extends Profile {
  orders: number;
  lines: number;
  stores: number;
  invalidLines: number;
}

/**
 * Summary of one test order (before annualisation).
 * A store line counts as one order line for that store. A hub line is spread evenly over the
 * hub's stores: each store gets one order and the line counts min(quantity, stores) order lines.
 */
export function summariseTestOrder(
  lines: OrderLine[],
  products: Product[],
  stores: Store[],
  hubs: Hub[],
): TestOrderSummary {
  const productById = new Map(products.map((p) => [p.id, p]));
  const storeIds = new Set(stores.map((s) => s.id));
  const storesByHub = new Map<string, number>();
  for (const s of stores) {
    if (s.homeHubId) storesByHub.set(s.homeHubId, (storesByHub.get(s.homeHubId) ?? 0) + 1);
  }
  const hubIds = new Set(hubs.map((h) => h.id));
  const orderingStores = new Set<string>();
  const hubsWithLines = new Set<string>();
  let profile = emptyProfile();
  let lineCount = 0;
  let invalid = 0;
  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product || line.quantity <= 0) {
      invalid++;
      continue;
    }
    if (storeIds.has(line.targetId)) {
      orderingStores.add(line.targetId);
      lineCount += 1;
      profile = addProfiles(profile, lineProfile(product, line.quantity));
    } else if (hubIds.has(line.targetId) && (storesByHub.get(line.targetId) ?? 0) > 0) {
      const n = storesByHub.get(line.targetId) ?? 0;
      hubsWithLines.add(line.targetId);
      lineCount += Math.min(line.quantity, n);
      profile = addProfiles(profile, lineProfile(product, line.quantity));
    } else {
      invalid++;
    }
  }
  // orders: every store of a hub with hub lines, plus stores with own lines outside those hubs
  let orders = 0;
  for (const hubId of hubsWithLines) orders += storesByHub.get(hubId) ?? 0;
  const storeHub = new Map(stores.map((s) => [s.id, s.homeHubId]));
  for (const id of orderingStores) {
    const home = storeHub.get(id);
    if (!home || !hubsWithLines.has(home)) orders += 1;
  }
  return { ...profile, orders, lines: lineCount, stores: orders, invalidLines: invalid };
}
