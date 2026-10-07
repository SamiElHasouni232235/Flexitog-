import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  const data = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
});

describe('app store', () => {
  it('keeps the dummy flag on edit until marked as real data', async () => {
    const { useApp } = await import('./store');
    const id = useApp.getState().ws.products[0]!.id;
    useApp.getState().updateProduct(id, { unitKg: 9 });
    expect(useApp.getState().ws.products[0]!.isDummy).toBe(true);
    useApp.getState().updateProduct(id, { isDummy: false });
    expect(useApp.getState().ws.products[0]!.isDummy).toBe(false);
  });

  it('removes a closed hub from model networks when the hub is deleted', async () => {
    const { useApp } = await import('./store');
    useApp.getState().removeHub('hub-kassel');
    expect(useApp.getState().ws.models.every((m) => !m.openHubIds.includes('hub-kassel'))).toBe(true);
  });

  it('persists to localStorage and resets to dummy data', async () => {
    const { useApp } = await import('./store');
    useApp.getState().updateSettings({ blendCalculated: 0.3 });
    const stored = JSON.parse(localStorage.getItem('supply-chain-benchmark-workspace') ?? '{}');
    expect(stored.state.ws.settings.blendCalculated).toBe(0.3);
    useApp.getState().resetToDummy();
    expect(useApp.getState().ws.hubs).toHaveLength(5);
    expect(useApp.getState().ws.settings.blendCalculated).toBe(0.6);
  });
});
