import type { Model, Scenario } from '../engine/types';
import { seedCriteria, seedModels } from './seed';

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const PALETTE = ['#4b5563', '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#65a30d'];

export function nextColour(used: string[]): string {
  return PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length] ?? '#4b5563';
}

export function blankModel(hubIds: string[], usedColours: string[]): Model {
  const ratings: Record<string, number> = {};
  for (const c of seedCriteria()) ratings[c.id] = 3;
  return {
    id: uid('model'),
    name: 'New model',
    colour: nextColour(usedColours),
    description: '',
    strengths: [],
    weaknesses: [],
    tags: ['other'],
    hubRole: 'stock',
    openHubIds: [...hubIds],
    hubOperator: 'own',
    linehaul: 'ftl',
    lastMile: 'own-vans',
    operations: { pickRateLinesPerHour: 60, stockDaysAtHub: 10, stopsPerVanRoute: 12, extraDcFloorM2: 0 },
    contract: { noticeWeeks: 13, capacityUnitsPerYear: 0, setupWeeks: 0 },
    admin: { adminFteBase: 3, adminFtePerHub: 1, systemsCostPerYear: 120000 },
    extraStaff: [],
    costOverrides: {},
    ratings,
    customParams: [],
    isDummy: false,
  };
}

/** The five seeded models, offered as templates. */
export function modelTemplates(): Model[] {
  return seedModels();
}

export function fromTemplate(template: Model, usedColours: string[]): Model {
  return {
    ...structuredClone(template),
    id: uid('model'),
    name: `${template.name} (copy)`,
    colour: usedColours.includes(template.colour) ? nextColour(usedColours) : template.colour,
  };
}

export function blankScenario(mode: Scenario['mode']): Scenario {
  return {
    id: uid('scn'),
    name: mode === 'volume' ? 'New volume scenario' : 'New test order',
    type: mode === 'volume' ? 'forecast' : 'test-order',
    mode,
    volume: { annualUnits: 1_000_000, storeGrowthFactor: 1, deliveriesPerStorePerWeek: 1, linesPerOrder: 10 },
    testOrder: { lines: [], annualisationFactor: 52 },
    isDummy: false,
  };
}
