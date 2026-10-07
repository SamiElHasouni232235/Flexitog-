import { describe, expect, it } from 'vitest';
import { seedWorkspace } from '../data/seed';
import { evaluateModel, GROWTH_SCALE, resolveAssumptions, runModel } from './model';
import { seedInput } from './testUtils';
import type { Model, Scenario } from './types';

const ws = seedWorkspace();
const input = seedInput(ws);
const forecast = ws.scenarios.find((s) => s.id === 'scn-forecast') as Scenario;
const model = (id: string): Model => ws.models.find((m) => m.id === id) as Model;

describe('model run', () => {
  it('applies cost overrides for one model only', () => {
    const a = resolveAssumptions(ws.assumptions, { rentPerM2Year: 100 });
    expect(a.rentPerM2Year).toBe(100);
    expect(a.labourRatePerHour).toBe(32);
    const base = runModel(input, model('model-baseline'), forecast);
    const pricier = runModel(input, { ...model('model-baseline'), costOverrides: { rentPerM2Year: 150 } }, forecast);
    expect(pricier.breakdown.buildings).toBeCloseTo(base.breakdown.buildings * 2, 3);
  });

  it('keeps total cost equal to the sum of the breakdown', () => {
    const r = runModel(input, model('model-baseline'), forecast);
    const sum = Object.values(r.breakdown).reduce((s, x) => s + x, 0);
    expect(r.totalCost).toBeCloseTo(sum, 6);
    expect(r.costPerUnit).toBeCloseTo(r.totalCost / r.units, 9);
    expect(r.units).toBeCloseTo(forecast.volume.annualUnits, 3);
  });

  it('serves every store from an open hub only', () => {
    const r = runModel(input, model('model-3hubs'), forecast);
    const nodeIds = new Set(r.assignments.map((x) => x.nodeId));
    expect([...nodeIds].sort()).toEqual(['hub-mannheim', 'hub-muenchen', 'hub-venlo']);
    expect(r.sites).toBe(4);
  });

  it('direct model has no linehaul, no hubs and ships from the DC', () => {
    const r = runModel(input, model('model-direct'), forecast);
    expect(r.breakdown.linehaul).toBe(0);
    expect(r.breakdown.hubHandling).toBe(0);
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]!.node.kind).toBe('dc');
    expect(r.sites).toBe(1);
  });

  it('3PL model has no own hub or driver FTE', () => {
    const r = runModel(input, model('model-3pl'), forecast);
    expect(r.fte.hubs).toBe(0);
    expect(r.fte.drivers).toBe(0);
    expect(r.variableShare).toBeGreaterThan(runModel(input, model('model-baseline'), forecast).variableShare);
  });

  it('reports capacity use and a warning above capacity', () => {
    const limited = { ...model('model-3pl'), contract: { ...model('model-3pl').contract, capacityUnitsPerYear: 5_000_000 } };
    const r = runModel(input, limited, forecast);
    expect(r.capacityUse).toBeCloseTo(1.2, 6);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(runModel(input, model('model-baseline'), forecast).capacityUse).toBeNull();
  });
});

describe('growth run', () => {
  it('runs at 150% volume and stores', () => {
    const r = evaluateModel(input, model('model-baseline'), forecast);
    expect(GROWTH_SCALE).toEqual({ volume: 1.5, stores: 1.5 });
    expect(r.growth.run.units).toBeCloseTo(r.units * 1.5, 3);
    expect(r.growth.run.orders).toBeCloseTo(r.orders * 1.5, 3);
    expect(r.growth.costPerExtraUnit).toBeCloseTo(r.growth.extraCost / r.growth.extraUnits, 9);
    expect(r.metrics.growthCostPerUnit).toBe(r.growth.costPerExtraUnit);
  });

  it('adds a penalty for units above capacity', () => {
    const base = model('model-3pl');
    const capped = { ...base, contract: { ...base.contract, capacityUnitsPerYear: 7_000_000 } };
    const unlimited = { ...base, contract: { ...base.contract, capacityUnitsPerYear: 0 } };
    const a = evaluateModel(input, capped, forecast);
    const b = evaluateModel(input, unlimited, forecast);
    expect(a.growth.overCapacityUnits).toBeCloseTo(9_000_000 - 7_000_000, 3);
    expect(a.growth.penalty).toBeCloseTo(2_000_000 * 1.5, 3);
    expect(b.growth.penalty).toBe(0);
    expect(a.growth.costPerExtraUnit! - b.growth.costPerExtraUnit!).toBeCloseTo(3_000_000 / a.growth.extraUnits, 6);
  });

  it('computes the flexibility metric from variable share and notice', () => {
    const m = model('model-3pl');
    const r = evaluateModel(input, m, forecast);
    expect(r.metrics.flexibility).toBeCloseTo(r.variableShare * 100 - 0.5 * m.contract.noticeWeeks, 9);
  });

  it('computes CO2 per 1,000 units', () => {
    const r = evaluateModel(input, model('model-baseline'), forecast);
    expect(r.metrics.co2Per1000Units).toBeCloseTo((r.co2Kg / r.units) * 1000, 9);
  });
});
