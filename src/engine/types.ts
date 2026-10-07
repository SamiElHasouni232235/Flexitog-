// Domain types shared by the engine, the store and the UI.
// No React imports in this folder.

export type CountryCode = 'NL' | 'BE' | 'LU' | 'FR' | 'DE';

export type ProductCategory = 'small' | 'standard' | 'bulky';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: ProductCategory;
  /** Weight per unit in kg. */
  unitKg: number;
  unitsPerCarton: number;
  cartonsPerPallet: number;
  /** Cost value per unit in EUR, used for inventory carrying cost. */
  unitValueEur: number;
  /** Share of annual units in percent. The engine normalises the total to 100. */
  salesMixPct: number;
  isDummy: boolean;
}

export interface DistributionCentre {
  name: string;
  lat: number;
  lon: number;
  locationToConfirm: boolean;
  isDummy: boolean;
}

export interface Hub {
  id: string;
  name: string;
  country: CountryCode;
  lat: number;
  lon: number;
  radiusKm: number;
  storeCount: number;
  isDummy: boolean;
}

export interface Store {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: CountryCode | string;
  /** Weekly units. Used as demand weight in volume scenarios. Generated stores use 1. */
  weeklyVolume: number;
  /** Hub the store belongs to in the baseline network. Null when unknown. */
  homeHubId: string | null;
  isDummy: boolean;
}

export interface StoreSet {
  /** generated: stores come from hub radius and store count. imported: stores come from CSV. */
  mode: 'generated' | 'imported';
  seed: number;
  imported: Store[];
  isDummy: boolean;
}

export type ScenarioType = 'test-order' | 'forecast' | 'target' | 'baseline';
export type ScenarioMode = 'volume' | 'test-order';

export interface VolumeInput {
  annualUnits: number;
  /** Multiplier on the store count. 1.2 means 20% more stores. */
  storeGrowthFactor: number;
  deliveriesPerStorePerWeek: number;
  linesPerOrder: number;
}

export interface OrderLine {
  id: string;
  /** Store id or hub id. */
  targetId: string;
  productId: string;
  quantity: number;
}

export interface TestOrderInput {
  lines: OrderLine[];
  /** Factor to scale the test order to a year. 52 for a weekly order. */
  annualisationFactor: number;
}

export interface Scenario {
  id: string;
  name: string;
  type: ScenarioType;
  mode: ScenarioMode;
  volume: VolumeInput;
  testOrder: TestOrderInput;
  isDummy: boolean;
}

export type HubRole = 'stock' | 'cross-dock' | 'none';
export type HubOperator = 'own' | '3pl';
export type LinehaulMode = 'ftl' | 'groupage';
export type LastMileMode = 'own-vans' | 'carrier';
export type ModelTag = 'network' | '3PL' | 'staffing' | 'transport' | 'other';

export interface OperationsParams {
  pickRateLinesPerHour: number;
  stockDaysAtHub: number;
  stopsPerVanRoute: number;
  extraDcFloorM2: number;
}

export interface ContractParams {
  noticeWeeks: number;
  /** Units per year. 0 means no limit. */
  capacityUnitsPerYear: number;
  setupWeeks: number;
}

export interface AdminParams {
  adminFteBase: number;
  adminFtePerHub: number;
  systemsCostPerYear: number;
}

export interface ExtraStaff {
  id: string;
  role: string;
  fte: number;
  annualCostPerFte: number;
}

export interface CustomParam {
  id: string;
  key: string;
  value: string;
  unit: string;
}

export interface Model {
  id: string;
  name: string;
  colour: string;
  description: string;
  strengths: string[];
  weaknesses: string[];
  tags: ModelTag[];
  hubRole: HubRole;
  openHubIds: string[];
  hubOperator: HubOperator;
  linehaul: LinehaulMode;
  lastMile: LastMileMode;
  operations: OperationsParams;
  contract: ContractParams;
  admin: AdminParams;
  extraStaff: ExtraStaff[];
  costOverrides: Partial<Record<AssumptionKey, number>>;
  /** Criterion id to rating 1 to 5. */
  ratings: Record<string, number>;
  customParams: CustomParam[];
  isDummy: boolean;
}

export type MetricKey =
  | 'ownFte'
  | 'flexibility'
  | 'growthCostPerUnit'
  | 'co2Per1000Units'
  | 'buildingsCost'
  | 'movementCost'
  | 'adminCost'
  | 'totalCost'
  | 'costPerUnit'
  | 'co2Kg'
  | 'truckKm'
  | 'vanKm'
  | 'floorM2'
  | 'sites'
  | 'setupWeeks'
  | 'manual';

export interface Criterion {
  id: string;
  name: string;
  weight: number;
  metric: MetricKey;
  higherIsBetter: boolean;
}

export type AssumptionGroup =
  | 'labour'
  | 'handling'
  | 'buildings and stock'
  | 'linehaul'
  | 'last mile'
  | '3PL tariffs'
  | 'emissions';

export type AssumptionKey =
  | 'labourRatePerHour'
  | 'driverRatePerHour'
  | 'productiveHoursPerFte'
  | 'adminFteCostPerYear'
  | 'palletHandlingMinutes'
  | 'orderHandlingMinutes'
  | 'rentPerM2Year'
  | 'm2PerPalletPosition'
  | 'fixedHubM2'
  | 'workingDaysPerYear'
  | 'weeksPerYear'
  | 'inventoryCarryingRate'
  | 'capacityPenaltyPerUnit'
  | 'ftlCostPerKm'
  | 'groupageCostPerPalletKm'
  | 'palletsPerTruck'
  | 'truckFillRate'
  | 'roadFactor'
  | 'minTripsPerWeekStockHub'
  | 'minTripsPerWeekCrossDock'
  | 'vanCostPerKm'
  | 'vanSpeedKmh'
  | 'minutesPerStop'
  | 'kmBetweenStops'
  | 'carrierCostPerStop'
  | 'carrierCostPerCarton'
  | 'tplCostPerLine'
  | 'tplCostPerPallet'
  | 'tplCostPerOrder'
  | 'tplStoragePerPalletWeek'
  | 'co2PerTruckKm'
  | 'co2PerVanKm'
  | 'co2PerCarrierStop'
  | 'co2PerM2Year';

export interface Assumption {
  key: AssumptionKey;
  label: string;
  group: AssumptionGroup;
  unit: string;
  value: number;
  defaultValue: number;
  isDummy: boolean;
}

export type AssumptionValues = Record<AssumptionKey, number>;

export interface Settings {
  /** Weight of calculated scores in the blend, 0 to 1. Rating weight is 1 minus this. */
  blendCalculated: number;
  baselineModelId: string;
  selectedScenarioId: string;
  theme: 'system' | 'light' | 'dark';
}

export interface Workspace {
  version: number;
  products: Product[];
  dc: DistributionCentre;
  hubs: Hub[];
  storeSet: StoreSet;
  scenarios: Scenario[];
  models: Model[];
  criteria: Criterion[];
  assumptions: Assumption[];
  settings: Settings;
}
