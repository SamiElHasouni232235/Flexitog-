import type { MetricKey } from './types';

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  description: string;
}

export const METRICS: MetricDef[] = [
  { key: 'ownFte', label: 'Own FTE needed', unit: 'FTE', higherIsBetter: false, description: 'DC, hub, driver, admin and extra staff FTE.' },
  {
    key: 'flexibility',
    label: 'Variable cost share minus notice',
    unit: 'points',
    higherIsBetter: true,
    description: 'Variable cost share in percent minus 0.5 points per week of notice.',
  },
  {
    key: 'growthCostPerUnit',
    label: 'Cost per extra unit at +50%',
    unit: '€/unit',
    higherIsBetter: false,
    description: 'Extra cost per extra unit when volume and stores rise 50%, plus a penalty above capacity.',
  },
  { key: 'co2Per1000Units', label: 'CO2 per 1,000 units', unit: 'kg', higherIsBetter: false, description: 'Total CO2 divided by units, times 1,000.' },
  { key: 'buildingsCost', label: 'Rent and storage cost', unit: '€/year', higherIsBetter: false, description: 'Hub rent, 3PL storage and extra DC space.' },
  {
    key: 'movementCost',
    label: 'Transport and handling cost',
    unit: '€/year',
    higherIsBetter: false,
    description: 'Linehaul, DC handling, hub handling and last mile.',
  },
  { key: 'adminCost', label: 'Admin and systems cost', unit: '€/year', higherIsBetter: false, description: 'Admin FTE cost plus systems cost.' },
  { key: 'totalCost', label: 'Total cost', unit: '€/year', higherIsBetter: false, description: 'Sum of all cost components.' },
  { key: 'costPerUnit', label: 'Cost per unit', unit: '€/unit', higherIsBetter: false, description: 'Total cost divided by annual units.' },
  { key: 'co2Kg', label: 'Total CO2', unit: 'kg/year', higherIsBetter: false, description: 'Truck, van, carrier and floor space emissions.' },
  { key: 'truckKm', label: 'Truck km', unit: 'km/year', higherIsBetter: false, description: 'Linehaul truck km.' },
  { key: 'vanKm', label: 'Van km', unit: 'km/year', higherIsBetter: false, description: 'Own van km.' },
  { key: 'floorM2', label: 'Floor space', unit: 'm²', higherIsBetter: false, description: 'Hub floor space plus extra DC floor space.' },
  { key: 'sites', label: 'Sites', unit: 'sites', higherIsBetter: false, description: 'DC plus open hubs.' },
  { key: 'setupWeeks', label: 'Setup time', unit: 'weeks', higherIsBetter: false, description: 'Weeks to set up the model.' },
  { key: 'manual', label: 'Manual rating only', unit: '', higherIsBetter: true, description: 'Scored from the model rating only.' },
];

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
