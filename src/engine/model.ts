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
import type { AdminResult, BuildingResult, HubHandlingResult, InventoryResult, LastMileResult, LabourResult, LinehaulResult } from './costs';
import { nodeDemands, storeDemands, UNIT_SCALE } from './demand';
import type { DemandScale, NodeDemand } from './demand';
import { roadKm } from './geo';
import { assignStores, servingNodes } from './stores';
import type { ServingNode, StoreAssignment } from './stores';
import type {
  Assumption,
  AssumptionKey,
  AssumptionValues,
  DistributionCentre,
  Hub,
  MetricKey,
  Model,
  Product,
  Scenario,
  Store,
} from './types';

export interface EngineInput {
  products: Product[];
  dc: DistributionCentre;
  hubs: Hub[];
  stores: Store[];
  assumptions: Assumption[];
}

/** Shared assumptions with the model's overrides applied. */
export function resolveAssumptions(
  assumptions: Assumption[],
  overrides: Partial<Record<AssumptionKey, number>> = {},
): AssumptionValues {
  const values = {} as AssumptionValues;
  for (const a of assumptions) values[a.key] = a.value;
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'number' && Number.isFinite(value)) values[key as AssumptionKey] = value;
  }
  return values;
}

export interface CostBreakdown {
  linehaul: number;
  dcHandling: number;
  hubHandling: number;
  buildings: number;
  inventory: number;
  lastMile: number;
  admin: number;
  systems: number;
  extraStaff: number;
}

export const COST_LABELS: Record<keyof CostBreakdown, string> = {
  linehaul: 'Linehaul',
  dcHandling: 'DC handling',
  hubHandling: 'Hub handling',
  buildings: 'Buildings',
  inventory: 'Inventory carrying',
  lastMile: 'Last mile',
  admin: 'Admin staff',
  systems: 'Systems',
  extraStaff: 'Extra staffing',
};

export interface NodeResult {
  node: ServingNode;
  demand: NodeDemand;
  linehaulKm: number;
  linehaul: LinehaulResult;
  hubHandling: HubHandlingResult;
  building: BuildingResult;
  inventory: InventoryResult;
  lastMile: LastMileResult;
  cost: number;
}

export interface FteBreakdown {
  dc: number;
  hubs: number;
  drivers: number;
  admin: number;
  extra: number;
}

export interface ModelRun {
  modelId: string;
  nodes: NodeResult[];
  assignments: StoreAssignment[];
  dcHandling: LabourResult;
  dcExtraSpace: BuildingResult;
  admin: AdminResult;
  breakdown: CostBreakdown;
  totalCost: number;
  units: number;
  orders: number;
  lines: number;
  cartons: number;
  pallets: number;
  storeCount: number;
  costPerUnit: number;
  ownFte: number;
  fte: FteBreakdown;
  sites: number;
  floorM2: number;
  truckKm: number;
  vanKm: number;
  carrierStops: number;
  co2Kg: number;
  variableCost: number;
  variableShare: number;
  /** Units divided by capacity. Null when capacity has no limit. */
  capacityUse: number | null;
  warnings: string[];
}

export interface GrowthResult {
  run: ModelRun;
  extraUnits: number;
  extraCost: number;
  overCapacityUnits: number;
  penalty: number;
  /** (extra cost + penalty) / extra units, EUR per unit. Null when there are no extra units. */
  costPerExtraUnit: number | null;
}

export interface ModelResult extends ModelRun {
  growth: GrowthResult;
  metrics: Record<Exclude<MetricKey, 'manual'>, number | null>;
}

const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

/** Run one model on one scenario at a demand scale. */
export function runModel(input: EngineInput, model: Model, scenario: Scenario, scale: DemandScale = UNIT_SCALE): ModelRun {
  const a = resolveAssumptions(input.assumptions, model.costOverrides);
  const warnings: string[] = [];
  const nodes = servingNodes(model.hubRole, model.openHubIds, input.hubs, input.dc);
  const usesHubs = nodes[0]?.kind === 'hub';
  const role = usesHubs ? model.hubRole : 'none';
  if (model.hubRole !== 'none' && !usesHubs) warnings.push('No open hubs. The model ships from the DC.');

  const assignments = assignStores(input.stores, nodes, a.roadFactor);
  const demands = storeDemands(scenario, input.stores, input.products, input.hubs, a.weeksPerYear, scale);
  const perNode = nodeDemands(
    demands,
    assignments,
    nodes.map((n) => n.id),
  );

  const nodeResults: NodeResult[] = nodes.map((node, i) => {
    const demand = perNode[i] as NodeDemand;
    const linehaulKm = usesHubs ? roadKm(input.dc, node, a.roadFactor) : 0;
    const minTrips =
      demand.pallets > 0 ? (role === 'cross-dock' ? a.minTripsPerWeekCrossDock : a.minTripsPerWeekStockHub) : 0;
    const linehaul = usesHubs
      ? linehaulCost({ mode: model.linehaul, pallets: demand.pallets, distanceKm: linehaulKm, minTripsPerWeek: minTrips }, a)
      : { trips: 0, truckKm: 0, cost: 0 };
    const hubHandling = hubHandlingCost(role, model.hubOperator, demand, model.operations.pickRateLinesPerHour, a);
    const building = buildingCost(role, model.hubOperator, demand.pallets, model.operations.stockDaysAtHub, a);
    const inventory = inventoryCost(role, demand.valueEur, model.operations.stockDaysAtHub, a);
    const lastMile = lastMileCost(
      {
        mode: model.lastMile,
        stops: demand.orders,
        cartons: demand.cartons,
        avgStoreKm: demand.avgStoreKm,
        stopsPerRoute: model.operations.stopsPerVanRoute,
      },
      a,
    );
    return {
      node,
      demand,
      linehaulKm,
      linehaul,
      hubHandling,
      building,
      inventory,
      lastMile,
      cost: linehaul.cost + hubHandling.cost + building.cost + inventory.cost + lastMile.cost,
    };
  });

  const units = sum(perNode.map((d) => d.units));
  const orders = sum(perNode.map((d) => d.orders));
  const lines = sum(perNode.map((d) => d.lines));
  const cartons = sum(perNode.map((d) => d.cartons));
  const pallets = sum(perNode.map((d) => d.pallets));
  const storeCount = sum(perNode.map((d) => d.storeCount));

  const dcHandling = dcHandlingCost(role, { pallets, orders, lines }, model.operations.pickRateLinesPerHour, a);
  const dcExtraSpace = dcExtraSpaceCost(model.operations.extraDcFloorM2, a);
  const openHubs = usesHubs ? nodes.length : 0;
  const admin = adminCost(model.admin, openHubs, model.extraStaff, a);

  const breakdown: CostBreakdown = {
    linehaul: sum(nodeResults.map((n) => n.linehaul.cost)),
    dcHandling: dcHandling.cost,
    hubHandling: sum(nodeResults.map((n) => n.hubHandling.cost)),
    buildings: sum(nodeResults.map((n) => n.building.cost)) + dcExtraSpace.cost,
    inventory: sum(nodeResults.map((n) => n.inventory.cost)),
    lastMile: sum(nodeResults.map((n) => n.lastMile.cost)),
    admin: admin.adminCost,
    systems: admin.systemsCost,
    extraStaff: admin.extraStaffCost,
  };
  const totalCost = sum(Object.values(breakdown));

  const fte: FteBreakdown = {
    dc: dcHandling.fte,
    hubs: sum(nodeResults.map((n) => n.hubHandling.fte)),
    drivers: sum(nodeResults.map((n) => n.lastMile.driverFte)),
    admin: admin.adminFte,
    extra: admin.extraStaffFte,
  };
  const ownFte = sum(Object.values(fte));

  const floorM2 = sum(nodeResults.map((n) => n.building.floorM2)) + dcExtraSpace.floorM2;
  const truckKm = sum(nodeResults.map((n) => n.linehaul.truckKm));
  const vanKm = sum(nodeResults.map((n) => n.lastMile.vanKm));
  const carrierStops = sum(nodeResults.map((n) => n.lastMile.carrierStops));
  const co2Kg = emissionsKg({ truckKm, vanKm, carrierStops, floorM2 }, a);

  // Variable cost: bought per unit of activity and stops when volume stops.
  const variableCost =
    breakdown.linehaul +
    sum(nodeResults.map((n) => n.hubHandling.tplCost + n.building.storage + n.lastMile.carrierCost + n.lastMile.vanKmCost));
  const capacity = model.contract.capacityUnitsPerYear;
  if (capacity > 0 && units > capacity) warnings.push('Volume is above the model capacity.');

  return {
    modelId: model.id,
    nodes: nodeResults,
    assignments,
    dcHandling,
    dcExtraSpace,
    admin,
    breakdown,
    totalCost,
    units,
    orders,
    lines,
    cartons,
    pallets,
    storeCount,
    costPerUnit: units > 0 ? totalCost / units : 0,
    ownFte,
    fte,
    sites: 1 + openHubs,
    floorM2,
    truckKm,
    vanKm,
    carrierStops,
    co2Kg,
    variableCost,
    variableShare: totalCost > 0 ? variableCost / totalCost : 0,
    capacityUse: capacity > 0 ? units / capacity : null,
    warnings,
  };
}

export const GROWTH_SCALE: DemandScale = { volume: 1.5, stores: 1.5 };

/**
 * Growth metric: run again at 150% volume and stores.
 * Cost per extra unit = (cost at 150% - cost at 100% + penalty) / (units at 150% - units at 100%).
 * Penalty = units above capacity at 150% * penalty per unit (only when capacity is set).
 */
export function growthRun(input: EngineInput, model: Model, scenario: Scenario, base: ModelRun): GrowthResult {
  const a = resolveAssumptions(input.assumptions, model.costOverrides);
  const run = runModel(input, model, scenario, GROWTH_SCALE);
  const extraUnits = run.units - base.units;
  const extraCost = run.totalCost - base.totalCost;
  const capacity = model.contract.capacityUnitsPerYear;
  const overCapacityUnits = capacity > 0 ? Math.max(0, run.units - capacity) : 0;
  const penalty = overCapacityUnits * a.capacityPenaltyPerUnit;
  return {
    run,
    extraUnits,
    extraCost,
    overCapacityUnits,
    penalty,
    costPerExtraUnit: extraUnits > 0 ? (extraCost + penalty) / extraUnits : null,
  };
}

/** Full evaluation of one model: base run, growth run and all metrics. */
export function evaluateModel(input: EngineInput, model: Model, scenario: Scenario): ModelResult {
  const base = runModel(input, model, scenario);
  const growth = growthRun(input, model, scenario, base);
  const metrics: ModelResult['metrics'] = {
    ownFte: base.ownFte,
    flexibility: base.variableShare * 100 - 0.5 * model.contract.noticeWeeks,
    growthCostPerUnit: growth.costPerExtraUnit,
    co2Per1000Units: base.units > 0 ? (base.co2Kg / base.units) * 1000 : null,
    buildingsCost: base.breakdown.buildings,
    movementCost: base.breakdown.linehaul + base.breakdown.dcHandling + base.breakdown.hubHandling + base.breakdown.lastMile,
    adminCost: base.breakdown.admin + base.breakdown.systems,
    totalCost: base.totalCost,
    costPerUnit: base.units > 0 ? base.costPerUnit : null,
    co2Kg: base.co2Kg,
    truckKm: base.truckKm,
    vanKm: base.vanKm,
    floorM2: base.floorM2,
    sites: base.sites,
    setupWeeks: model.contract.setupWeeks,
  };
  return { ...base, growth, metrics };
}

export function evaluateAll(input: EngineInput, models: Model[], scenario: Scenario): ModelResult[] {
  return models.map((m) => evaluateModel(input, m, scenario));
}
