// Dummy seed data. Every record carries isDummy: true.
// Figures are placeholders for testing the tool, not company data.

import type {
  Assumption,
  AssumptionGroup,
  AssumptionKey,
  Criterion,
  DistributionCentre,
  Hub,
  Model,
  OrderLine,
  Product,
  ProductCategory,
  Scenario,
  Settings,
  StoreSet,
  Workspace,
} from '../engine/types';

export const WORKSPACE_VERSION = 1;

type ProductRow = [string, ProductCategory, number, number, number, number, number];

// letter, category, unitKg, unitsPerCarton, cartonsPerPallet, unitValueEur, salesMixPct
const productRows: ProductRow[] = [
  ['A', 'small', 0.25, 48, 110, 2.4, 8],
  ['B', 'small', 0.3, 36, 120, 3.1, 7],
  ['C', 'small', 0.4, 36, 100, 4.2, 7],
  ['D', 'small', 0.5, 24, 100, 5.5, 6],
  ['E', 'small', 0.6, 24, 90, 6.8, 6],
  ['F', 'small', 0.7, 24, 90, 7.4, 5],
  ['G', 'small', 0.8, 24, 80, 8.0, 5],
  ['H', 'standard', 1.1, 12, 70, 6.5, 6],
  ['I', 'standard', 1.4, 12, 65, 8.2, 5],
  ['J', 'standard', 1.6, 12, 60, 9.9, 5],
  ['K', 'standard', 1.9, 10, 60, 11.5, 5],
  ['L', 'standard', 2.2, 8, 60, 12.9, 4],
  ['M', 'standard', 2.5, 8, 55, 14.0, 4],
  ['N', 'standard', 2.8, 6, 55, 16.2, 4],
  ['O', 'standard', 3.0, 6, 50, 18.0, 3],
  ['P', 'bulky', 5.5, 4, 40, 22.0, 6],
  ['Q', 'bulky', 7.0, 2, 36, 29.0, 5],
  ['R', 'bulky', 9.0, 2, 30, 38.0, 4],
  ['S', 'bulky', 12.0, 1, 28, 47.0, 3],
  ['T', 'bulky', 15.0, 1, 20, 59.0, 2],
];

export function seedProducts(): Product[] {
  return productRows.map(([letter, category, unitKg, unitsPerCarton, cartonsPerPallet, unitValueEur, salesMixPct]) => ({
    id: `prod-${letter.toLowerCase()}`,
    sku: `DUM-${letter}${String(100 + letter.charCodeAt(0) - 64).slice(1)}`,
    name: `Dummy product ${letter}`,
    category,
    unitKg,
    unitsPerCarton,
    cartonsPerPallet,
    unitValueEur,
    salesMixPct,
    isDummy: true,
  }));
}

export function seedDc(): DistributionCentre {
  return {
    name: 'Central DC',
    lat: 50.8686,
    lon: 9.7064,
    locationToConfirm: true,
    isDummy: true,
  };
}

export function seedHubs(): Hub[] {
  return [
    { id: 'hub-venlo', name: 'Venlo', country: 'NL', lat: 51.3704, lon: 6.1724, radiusKm: 100, storeCount: 128, isDummy: true },
    { id: 'hub-kontich', name: 'Kontich', country: 'BE', lat: 51.134, lon: 4.446, radiusKm: 100, storeCount: 117, isDummy: true },
    { id: 'hub-mannheim', name: 'Mannheim', country: 'DE', lat: 49.4875, lon: 8.466, radiusKm: 100, storeCount: 136, isDummy: true },
    { id: 'hub-kassel', name: 'Kassel', country: 'DE', lat: 51.3127, lon: 9.4797, radiusKm: 100, storeCount: 94, isDummy: true },
    { id: 'hub-muenchen', name: 'München', country: 'DE', lat: 48.1351, lon: 11.582, radiusKm: 100, storeCount: 109, isDummy: true },
  ];
}

export function seedStoreSet(): StoreSet {
  return { mode: 'generated', seed: 20240601, imported: [], isDummy: true };
}

function seedTestOrderLines(): OrderLine[] {
  const hubLines: Array<[string, string, number]> = [];
  const hubs = seedHubs();
  const productLetters = ['a', 'b', 'c', 'h', 'i', 'k', 'p', 'q'];
  const baseQty = [3200, 2800, 2600, 1900, 1500, 1300, 900, 600];
  hubs.forEach((hub, h) => {
    productLetters.forEach((letter, p) => {
      const qty = Math.round(((baseQty[p] ?? 1000) * hub.storeCount) / 115 / 10) * 10 + h * 10;
      hubLines.push([hub.id, `prod-${letter}`, qty]);
    });
  });
  const storeLines: Array<[string, string, number]> = [
    ['hub-venlo-s001', 'prod-d', 48],
    ['hub-venlo-s001', 'prod-t', 4],
    ['hub-kontich-s002', 'prod-e', 72],
    ['hub-mannheim-s003', 'prod-r', 6],
    ['hub-kassel-s004', 'prod-j', 36],
    ['hub-muenchen-s005', 'prod-s', 3],
  ];
  return [...hubLines, ...storeLines].map(([targetId, productId, quantity], i) => ({
    id: `line-${i + 1}`,
    targetId,
    productId,
    quantity,
  }));
}

export function seedScenarios(): Scenario[] {
  const emptyVolume = { annualUnits: 0, storeGrowthFactor: 1, deliveriesPerStorePerWeek: 1, linesPerOrder: 10 };
  return [
    {
      id: 'scn-test-order',
      name: 'Dummy weekly test order',
      type: 'test-order',
      mode: 'test-order',
      volume: emptyVolume,
      testOrder: { lines: seedTestOrderLines(), annualisationFactor: 52 },
      isDummy: true,
    },
    {
      id: 'scn-forecast',
      name: 'Dummy forecast next year',
      type: 'forecast',
      mode: 'volume',
      volume: { annualUnits: 6_000_000, storeGrowthFactor: 1, deliveriesPerStorePerWeek: 1, linesPerOrder: 12 },
      testOrder: { lines: [], annualisationFactor: 52 },
      isDummy: true,
    },
    {
      id: 'scn-growth',
      name: 'Dummy growth target',
      type: 'target',
      mode: 'volume',
      volume: { annualUnits: 8_500_000, storeGrowthFactor: 1.3, deliveriesPerStorePerWeek: 1.5, linesPerOrder: 11 },
      testOrder: { lines: [], annualisationFactor: 52 },
      isDummy: true,
    },
  ];
}

export function seedCriteria(): Criterion[] {
  return [
    { id: 'crit-people', name: 'People', weight: 15, metric: 'ownFte', higherIsBetter: false },
    { id: 'crit-flexibility', name: 'Flexibility', weight: 15, metric: 'flexibility', higherIsBetter: true },
    { id: 'crit-growth', name: 'Growth', weight: 15, metric: 'growthCostPerUnit', higherIsBetter: false },
    { id: 'crit-sustainability', name: 'Sustainability', weight: 10, metric: 'co2Per1000Units', higherIsBetter: false },
    { id: 'crit-buildings', name: 'Buildings', weight: 15, metric: 'buildingsCost', higherIsBetter: false },
    { id: 'crit-movement', name: 'Movement and material handling', weight: 20, metric: 'movementCost', higherIsBetter: false },
    { id: 'crit-admin', name: 'Administration', weight: 10, metric: 'adminCost', higherIsBetter: false },
  ];
}

type AssumptionRow = [AssumptionKey, string, AssumptionGroup, string, number];

const assumptionRows: AssumptionRow[] = [
  ['labourRatePerHour', 'Warehouse labour rate', 'labour', '€/h', 32],
  ['driverRatePerHour', 'Driver rate', 'labour', '€/h', 30],
  ['productiveHoursPerFte', 'Productive hours per FTE', 'labour', 'h/year', 1650],
  ['adminFteCostPerYear', 'Admin FTE cost', 'labour', '€/year', 62000],
  ['palletHandlingMinutes', 'Handling time per pallet', 'handling', 'min/pallet', 6],
  ['orderHandlingMinutes', 'Handling time per order', 'handling', 'min/order', 6],
  ['rentPerM2Year', 'Rent', 'buildings and stock', '€/m²/year', 75],
  ['m2PerPalletPosition', 'Floor space per pallet position', 'buildings and stock', 'm²/position', 0.6],
  ['fixedHubM2', 'Fixed hub space (docks, office, staging)', 'buildings and stock', 'm²/hub', 600],
  ['workingDaysPerYear', 'Working days per year', 'buildings and stock', 'days/year', 250],
  ['weeksPerYear', 'Weeks per year', 'buildings and stock', 'weeks/year', 52],
  ['inventoryCarryingRate', 'Inventory carrying rate', 'buildings and stock', 'share/year', 0.2],
  ['capacityPenaltyPerUnit', 'Growth penalty above capacity', 'buildings and stock', '€/unit', 1.5],
  ['ftlCostPerKm', 'Full truck cost', 'linehaul', '€/km', 1.65],
  ['groupageCostPerPalletKm', 'Groupage cost', 'linehaul', '€/pallet/km', 0.11],
  ['palletsPerTruck', 'Pallets per truck', 'linehaul', 'pallets', 33],
  ['truckFillRate', 'Truck fill rate', 'linehaul', 'share', 0.85],
  ['roadFactor', 'Road factor on straight-line distance', 'linehaul', 'factor', 1.25],
  ['minTripsPerWeekStockHub', 'Minimum trips per week to a stock hub', 'linehaul', 'trips/week', 2],
  ['minTripsPerWeekCrossDock', 'Minimum trips per week to a cross-dock hub', 'linehaul', 'trips/week', 5],
  ['vanCostPerKm', 'Van cost', 'last mile', '€/km', 0.55],
  ['vanSpeedKmh', 'Average van speed', 'last mile', 'km/h', 50],
  ['minutesPerStop', 'Time per stop', 'last mile', 'min/stop', 15],
  ['kmBetweenStops', 'Distance between stops', 'last mile', 'km', 8],
  ['carrierCostPerStop', 'Carrier cost per stop', 'last mile', '€/stop', 18],
  ['carrierCostPerCarton', 'Carrier cost per carton', 'last mile', '€/carton', 2.4],
  ['tplCostPerLine', '3PL fee per order line', '3PL tariffs', '€/line', 0.6],
  ['tplCostPerPallet', '3PL fee per pallet', '3PL tariffs', '€/pallet', 7],
  ['tplCostPerOrder', '3PL fee per order', '3PL tariffs', '€/order', 2.5],
  ['tplStoragePerPalletWeek', '3PL storage fee', '3PL tariffs', '€/pallet/week', 2.3],
  ['co2PerTruckKm', 'CO2 per truck km', 'emissions', 'kg/km', 0.85],
  ['co2PerVanKm', 'CO2 per van km', 'emissions', 'kg/km', 0.24],
  ['co2PerCarrierStop', 'CO2 per carrier stop', 'emissions', 'kg/stop', 0.6],
  ['co2PerM2Year', 'CO2 per m² floor space', 'emissions', 'kg/m²/year', 22],
];

export function seedAssumptions(): Assumption[] {
  return assumptionRows.map(([key, label, group, unit, value]) => ({
    key,
    label,
    group,
    unit,
    value,
    defaultValue: value,
    isDummy: true,
  }));
}

export const ASSUMPTION_GROUPS: AssumptionGroup[] = [
  'labour',
  'handling',
  'buildings and stock',
  'linehaul',
  'last mile',
  '3PL tariffs',
  'emissions',
];

function ratings(values: [number, number, number, number, number, number, number]): Record<string, number> {
  const ids = seedCriteria().map((c) => c.id);
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    out[id] = values[i] ?? 3;
  });
  return out;
}

const allHubIds = seedHubs().map((h) => h.id);

export function seedModels(): Model[] {
  return [
    {
      id: 'model-baseline',
      name: 'Baseline',
      colour: '#2a78d6',
      description: 'Current way of working. Central DC replenishes five hubs that hold stock and pick store orders. Own staff and own vans.',
      strengths: ['Short lead time to stores', 'Full control over service', 'Known processes'],
      weaknesses: ['Stock spread over five sites', 'High fixed staff and rent', 'No hub for France'],
      tags: ['network'],
      hubRole: 'stock',
      openHubIds: [...allHubIds],
      hubOperator: 'own',
      linehaul: 'ftl',
      lastMile: 'own-vans',
      operations: { pickRateLinesPerHour: 60, stockDaysAtHub: 10, stopsPerVanRoute: 12, extraDcFloorM2: 0 },
      contract: { noticeWeeks: 13, capacityUnitsPerYear: 0, setupWeeks: 0 },
      admin: { adminFteBase: 3, adminFtePerHub: 1, systemsCostPerYear: 120000 },
      extraStaff: [],
      costOverrides: {},
      ratings: ratings([3, 2, 3, 3, 3, 3, 3]),
      customParams: [],
      isDummy: true,
    },
    {
      id: 'model-3pl',
      name: '3PL runs all hubs and delivery',
      colour: '#eb6834',
      description: 'A 3PL operates the five hubs and delivers to stores. The company keeps the DC and linehaul.',
      strengths: ['Variable cost', 'Less own staff to manage', 'Capacity on demand'],
      weaknesses: ['Long notice period', 'Less control over service', 'Tariff risk at renewal'],
      tags: ['3PL', 'transport'],
      hubRole: 'stock',
      openHubIds: [...allHubIds],
      hubOperator: '3pl',
      linehaul: 'ftl',
      lastMile: 'carrier',
      operations: { pickRateLinesPerHour: 60, stockDaysAtHub: 10, stopsPerVanRoute: 12, extraDcFloorM2: 0 },
      contract: { noticeWeeks: 26, capacityUnitsPerYear: 9_000_000, setupWeeks: 16 },
      admin: { adminFteBase: 2, adminFtePerHub: 0.3, systemsCostPerYear: 180000 },
      extraStaff: [],
      costOverrides: {},
      ratings: ratings([4, 4, 3, 3, 3, 3, 3]),
      customParams: [{ id: 'cp-1', key: 'Contract term', value: '3', unit: 'years' }],
      isDummy: true,
    },
    {
      id: 'model-crossdock',
      name: 'Cross-dock hubs with stock only at DC',
      colour: '#1baf7a',
      description: 'The DC picks every store order. Hubs only sort and dispatch, with no stock.',
      strengths: ['One stock point', 'Smaller hubs', 'Lower inventory'],
      weaknesses: ['Daily linehaul needed', 'DC needs more space and pickers', 'Longer order cut-off'],
      tags: ['network'],
      hubRole: 'cross-dock',
      openHubIds: [...allHubIds],
      hubOperator: 'own',
      linehaul: 'ftl',
      lastMile: 'own-vans',
      operations: { pickRateLinesPerHour: 75, stockDaysAtHub: 0, stopsPerVanRoute: 12, extraDcFloorM2: 1800 },
      contract: { noticeWeeks: 13, capacityUnitsPerYear: 0, setupWeeks: 12 },
      admin: { adminFteBase: 3, adminFtePerHub: 0.6, systemsCostPerYear: 140000 },
      extraStaff: [],
      costOverrides: {},
      ratings: ratings([3, 3, 3, 3, 3, 3, 3]),
      customParams: [],
      isDummy: true,
    },
    {
      id: 'model-3hubs',
      name: 'Consolidate to 3 hubs',
      colour: '#eda100',
      description: 'Keep Venlo, Mannheim and München as stock hubs. Stores of Kontich and Kassel move to the nearest open hub.',
      strengths: ['Fewer sites', 'Lower rent', 'Less admin'],
      weaknesses: ['Longer van routes', 'Belgium served from Venlo', 'Transition effort'],
      tags: ['network'],
      hubRole: 'stock',
      openHubIds: ['hub-venlo', 'hub-mannheim', 'hub-muenchen'],
      hubOperator: 'own',
      linehaul: 'ftl',
      lastMile: 'own-vans',
      operations: { pickRateLinesPerHour: 65, stockDaysAtHub: 10, stopsPerVanRoute: 10, extraDcFloorM2: 0 },
      contract: { noticeWeeks: 13, capacityUnitsPerYear: 0, setupWeeks: 20 },
      admin: { adminFteBase: 3, adminFtePerHub: 1, systemsCostPerYear: 110000 },
      extraStaff: [],
      costOverrides: {},
      ratings: ratings([3, 2, 3, 3, 4, 3, 3]),
      customParams: [],
      isDummy: true,
    },
    {
      id: 'model-direct',
      name: 'Direct from DC by carrier',
      colour: '#e87ba4',
      description: 'Close all hubs. The DC picks every order and a parcel or pallet carrier delivers to stores.',
      strengths: ['No hubs', 'Fully variable delivery cost', 'Short notice'],
      weaknesses: ['Long transit to Belgium and Bavaria', 'Carrier cost per carton', 'DC needs more space'],
      tags: ['network', 'transport', 'staffing'],
      hubRole: 'none',
      openHubIds: [],
      hubOperator: 'own',
      linehaul: 'ftl',
      lastMile: 'carrier',
      operations: { pickRateLinesPerHour: 80, stockDaysAtHub: 0, stopsPerVanRoute: 12, extraDcFloorM2: 2500 },
      contract: { noticeWeeks: 4, capacityUnitsPerYear: 0, setupWeeks: 8 },
      admin: { adminFteBase: 2.5, adminFtePerHub: 0, systemsCostPerYear: 100000 },
      extraStaff: [{ id: 'xs-1', role: 'Carrier and customer service desk', fte: 2, annualCostPerFte: 52000 }],
      costOverrides: {},
      ratings: ratings([3, 4, 3, 2, 3, 2, 3]),
      customParams: [],
      isDummy: true,
    },
  ];
}

export function seedSettings(): Settings {
  return {
    blendCalculated: 0.6,
    baselineModelId: 'model-baseline',
    selectedScenarioId: 'scn-forecast',
    theme: 'system',
  };
}

export function seedWorkspace(): Workspace {
  return {
    version: WORKSPACE_VERSION,
    products: seedProducts(),
    dc: seedDc(),
    hubs: seedHubs(),
    storeSet: seedStoreSet(),
    scenarios: seedScenarios(),
    models: seedModels(),
    criteria: seedCriteria(),
    assumptions: seedAssumptions(),
    settings: seedSettings(),
  };
}
