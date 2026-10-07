import { describe, expect, it } from 'vitest';
import { seedWorkspace } from '../data/seed';
import { clearDummyData, normaliseWorkspace } from './workspace';

describe('workspace import', () => {
  it('round-trips a JSON export', () => {
    const ws = seedWorkspace();
    const back = normaliseWorkspace(JSON.parse(JSON.stringify(ws)));
    expect(back).toEqual(ws);
  });

  it('rejects files that are not a workspace', () => {
    expect(() => normaliseWorkspace([1, 2])).toThrow();
    expect(() => normaliseWorkspace({ foo: 1 })).toThrow();
    expect(() => normaliseWorkspace({ products: 'x' })).toThrow();
  });

  it('adds missing assumption keys from the seed', () => {
    const ws = seedWorkspace();
    const partial = { ...ws, assumptions: ws.assumptions.slice(0, 3).map((a) => ({ ...a, value: 99, isDummy: false })) };
    const back = normaliseWorkspace(partial);
    expect(back.assumptions).toHaveLength(ws.assumptions.length);
    expect(back.assumptions[0]!.value).toBe(99);
    expect(back.assumptions[0]!.isDummy).toBe(false);
    expect(back.assumptions[5]!.isDummy).toBe(true);
  });
});

describe('clear dummy data', () => {
  it('removes dummy records and keeps real ones', () => {
    const ws = seedWorkspace();
    ws.products[0] = { ...ws.products[0]!, isDummy: false };
    ws.hubs[1] = { ...ws.hubs[1]!, isDummy: false };
    const cleared = clearDummyData(ws);
    expect(cleared.products).toHaveLength(1);
    expect(cleared.hubs.map((h) => h.id)).toEqual(['hub-kontich']);
    expect(cleared.models).toHaveLength(0);
    expect(cleared.scenarios).toHaveLength(0);
    expect(cleared.assumptions.every((a) => a.value === 0)).toBe(true);
    expect(cleared.storeSet.mode).toBe('imported');
    expect(cleared.settings.baselineModelId).toBe('');
  });
});
