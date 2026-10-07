// One pure function per cost component. All costs in EUR per year.

import type { AssumptionValues, ExtraStaff, AdminParams, HubOperator, HubRole, LastMileMode, LinehaulMode } from './types';

const safeDiv = (a: number, b: number): number => (b > 0 ? a / b : 0);

export interface LinehaulInput {
  mode: LinehaulMode;
  /** Annual pallets to the hub. */
  pallets: number;
  /** One-way road km DC to hub. */
  distanceKm: number;
  /** Minimum departures per week, set by hub role. */
  minTripsPerWeek: number;
}

export interface LinehaulResult {
  trips: number;
  truckKm: number;
  cost: number;
}

/**
 * Full truck: trips/week = max(ceil(pallets/week / (palletsPerTruck * fill)), min trips/week).
 * Trips/year = trips/week * weeks. Truck km = trips * 2 * distance. Cost = truck km * €/km.
 * Groupage: cost = pallets * distance * €/pallet/km. Truck km (for CO2) = pallets / (palletsPerTruck * fill) * distance.
 */
export function linehaulCost(input: LinehaulInput, a: AssumptionValues): LinehaulResult {
  const effective = a.palletsPerTruck * a.truckFillRate;
  if (input.pallets <= 0 || input.distanceKm <= 0) return { trips: 0, truckKm: 0, cost: 0 };
  if (input.mode === 'ftl') {
    const palletsPerWeek = safeDiv(input.pallets, a.weeksPerYear);
    const tripsPerWeek = Math.max(Math.ceil(safeDiv(palletsPerWeek, effective)), input.minTripsPerWeek);
    const trips = tripsPerWeek * a.weeksPerYear;
    const truckKm = trips * 2 * input.distanceKm;
    return { trips, truckKm, cost: truckKm * a.ftlCostPerKm };
  }
  const trips = safeDiv(input.pallets, effective);
  return {
    trips,
    truckKm: trips * input.distanceKm,
    cost: input.pallets * input.distanceKm * a.groupageCostPerPalletKm,
  };
}

export interface HandlingVolume {
  pallets: number;
  orders: number;
  lines: number;
}

export interface LabourResult {
  hours: number;
  fte: number;
  cost: number;
}

function labour(hours: number, a: AssumptionValues): LabourResult {
  return { hours, fte: safeDiv(hours, a.productiveHoursPerFte), cost: hours * a.labourRatePerHour };
}

/**
 * DC handling with own staff.
 * Stock hubs: the DC ships full pallets, hours = pallets * min/pallet / 60.
 * Cross-dock or no hubs: the DC picks store orders,
 * hours = lines / pick rate + orders * min/order / 60 + pallets * min/pallet / 60.
 */
export function dcHandlingCost(role: HubRole, v: HandlingVolume, pickRate: number, a: AssumptionValues): LabourResult {
  const palletHours = (v.pallets * a.palletHandlingMinutes) / 60;
  if (role === 'stock') return labour(palletHours, a);
  const hours = safeDiv(v.lines, pickRate) + (v.orders * a.orderHandlingMinutes) / 60 + palletHours;
  return labour(hours, a);
}

export interface HubHandlingResult extends LabourResult {
  ownCost: number;
  tplCost: number;
}

/**
 * Hub handling.
 * Own staff, stock hub: hours = lines / pick rate + pallets * min/pallet / 60 + orders * min/order / 60.
 * Own staff, cross-dock: hours = pallets * min/pallet / 60 + orders * min/order / 60.
 * 3PL, stock hub: fees = lines * €/line + pallets * €/pallet + orders * €/order.
 * 3PL, cross-dock: fees = pallets * €/pallet + orders * €/order.
 */
export function hubHandlingCost(
  role: HubRole,
  operator: HubOperator,
  v: HandlingVolume,
  pickRate: number,
  a: AssumptionValues,
): HubHandlingResult {
  if (role === 'none') return { hours: 0, fte: 0, cost: 0, ownCost: 0, tplCost: 0 };
  const picks = role === 'stock';
  if (operator === '3pl') {
    const tplCost =
      (picks ? v.lines * a.tplCostPerLine : 0) + v.pallets * a.tplCostPerPallet + v.orders * a.tplCostPerOrder;
    return { hours: 0, fte: 0, cost: tplCost, ownCost: 0, tplCost };
  }
  const hours =
    (picks ? safeDiv(v.lines, pickRate) : 0) +
    (v.pallets * a.palletHandlingMinutes) / 60 +
    (v.orders * a.orderHandlingMinutes) / 60;
  const l = labour(hours, a);
  return { ...l, ownCost: l.cost, tplCost: 0 };
}

export interface BuildingResult {
  palletPositions: number;
  floorM2: number;
  rent: number;
  storage: number;
  cost: number;
}

/**
 * Hub building.
 * Pallet positions = annual pallets / working days * stock days (stock hubs only).
 * Floor m² = positions * m²/position + fixed hub m².
 * Own site: rent = floor m² * €/m²/year. 3PL: storage = positions * €/pallet/week * weeks, no rent.
 */
export function buildingCost(
  role: HubRole,
  operator: HubOperator,
  annualPallets: number,
  stockDays: number,
  a: AssumptionValues,
): BuildingResult {
  if (role === 'none') return { palletPositions: 0, floorM2: 0, rent: 0, storage: 0, cost: 0 };
  const palletPositions = role === 'stock' ? safeDiv(annualPallets, a.workingDaysPerYear) * Math.max(0, stockDays) : 0;
  const floorM2 = palletPositions * a.m2PerPalletPosition + a.fixedHubM2;
  if (operator === '3pl') {
    const storage = palletPositions * a.tplStoragePerPalletWeek * a.weeksPerYear;
    return { palletPositions, floorM2, rent: 0, storage, cost: storage };
  }
  const rent = floorM2 * a.rentPerM2Year;
  return { palletPositions, floorM2, rent, storage: 0, cost: rent };
}

/** Extra DC floor space for the model, rented at the shared rent. */
export function dcExtraSpaceCost(extraM2: number, a: AssumptionValues): BuildingResult {
  const floorM2 = Math.max(0, extraM2);
  const rent = floorM2 * a.rentPerM2Year;
  return { palletPositions: 0, floorM2, rent, storage: 0, cost: rent };
}

export interface InventoryResult {
  stockValueEur: number;
  cost: number;
}

/** Hub stock value = annual value / working days * stock days. Cost = stock value * carrying rate. */
export function inventoryCost(role: HubRole, annualValueEur: number, stockDays: number, a: AssumptionValues): InventoryResult {
  if (role !== 'stock') return { stockValueEur: 0, cost: 0 };
  const stockValueEur = safeDiv(annualValueEur, a.workingDaysPerYear) * Math.max(0, stockDays);
  return { stockValueEur, cost: stockValueEur * a.inventoryCarryingRate };
}

export interface LastMileInput {
  mode: LastMileMode;
  /** Annual stops, one per store order. */
  stops: number;
  cartons: number;
  /** Average road km from node to store. */
  avgStoreKm: number;
  stopsPerRoute: number;
}

export interface LastMileResult {
  routes: number;
  vanKm: number;
  driverHours: number;
  driverFte: number;
  vanKmCost: number;
  driverCost: number;
  carrierStops: number;
  carrierCost: number;
  cost: number;
}

/**
 * Own vans: routes = stops / stops per route. Route km = 2 * avg store km + (stops per route - 1) * km between stops.
 * Van km = routes * route km. Driver hours = van km / speed + stops * min/stop / 60.
 * Cost = van km * €/km + driver hours * €/h.
 * Carrier: cost = stops * €/stop + cartons * €/carton.
 */
export function lastMileCost(input: LastMileInput, a: AssumptionValues): LastMileResult {
  const zero: LastMileResult = {
    routes: 0,
    vanKm: 0,
    driverHours: 0,
    driverFte: 0,
    vanKmCost: 0,
    driverCost: 0,
    carrierStops: 0,
    carrierCost: 0,
    cost: 0,
  };
  if (input.stops <= 0) return zero;
  if (input.mode === 'carrier') {
    const carrierCost = input.stops * a.carrierCostPerStop + input.cartons * a.carrierCostPerCarton;
    return { ...zero, carrierStops: input.stops, carrierCost, cost: carrierCost };
  }
  const stopsPerRoute = Math.max(1, input.stopsPerRoute);
  const routes = input.stops / stopsPerRoute;
  const routeKm = 2 * input.avgStoreKm + (stopsPerRoute - 1) * a.kmBetweenStops;
  const vanKm = routes * routeKm;
  const driverHours = safeDiv(vanKm, a.vanSpeedKmh) + (input.stops * a.minutesPerStop) / 60;
  const vanKmCost = vanKm * a.vanCostPerKm;
  const driverCost = driverHours * a.driverRatePerHour;
  return {
    ...zero,
    routes,
    vanKm,
    driverHours,
    driverFte: safeDiv(driverHours, a.productiveHoursPerFte),
    vanKmCost,
    driverCost,
    cost: vanKmCost + driverCost,
  };
}

export interface AdminResult {
  adminFte: number;
  adminCost: number;
  systemsCost: number;
  extraStaffFte: number;
  extraStaffCost: number;
}

/** Admin FTE = base + per hub * open hubs. Admin cost = admin FTE * €/FTE. Extra staff cost = sum(FTE * €/FTE). */
export function adminCost(admin: AdminParams, openHubs: number, extraStaff: ExtraStaff[], a: AssumptionValues): AdminResult {
  const adminFte = Math.max(0, admin.adminFteBase) + Math.max(0, admin.adminFtePerHub) * openHubs;
  const extraStaffFte = extraStaff.reduce((s, x) => s + Math.max(0, x.fte), 0);
  const extraStaffCost = extraStaff.reduce((s, x) => s + Math.max(0, x.fte) * Math.max(0, x.annualCostPerFte), 0);
  return {
    adminFte,
    adminCost: adminFte * a.adminFteCostPerYear,
    systemsCost: Math.max(0, admin.systemsCostPerYear),
    extraStaffFte,
    extraStaffCost,
  };
}

export interface EmissionInput {
  truckKm: number;
  vanKm: number;
  carrierStops: number;
  floorM2: number;
}

/** CO2 kg = truck km * kg/km + van km * kg/km + carrier stops * kg/stop + floor m² * kg/m²/year. */
export function emissionsKg(e: EmissionInput, a: AssumptionValues): number {
  return (
    e.truckKm * a.co2PerTruckKm + e.vanKm * a.co2PerVanKm + e.carrierStops * a.co2PerCarrierStop + e.floorM2 * a.co2PerM2Year
  );
}
