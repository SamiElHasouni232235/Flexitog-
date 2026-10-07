import { describe, expect, it } from 'vitest';
import { seedHubs, seedProducts, seedWorkspace } from '../data/seed';
import { countryCoverage } from './coverage';
import { parseCsv, parseNumber, parseOrderLinesCsv, parseStoresCsv, toCsv } from './csv';
import { countDummyInputs } from './dummy';
import { generateStores } from './stores';

describe('csv', () => {
  it('parses commas, semicolons and quotes', () => {
    expect(parseCsv('a,b\n"x, y",2')).toEqual([['a', 'b'], ['x, y', '2']]);
    expect(parseCsv('a;b\r\n1;2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('1,500.25')).toBe(1500.25);
  });

  it('round-trips through toCsv', () => {
    const rows = [['name', 'v'], ['a "b", c', 3]];
    expect(parseCsv(toCsv(rows))).toEqual([['name', 'v'], ['a "b", c', '3']]);
  });

  it('imports stores and links each to the nearest hub', () => {
    const r = parseStoresCsv('name,lat,lon,country,weekly volume\nShop 1,51.4,6.2,NL,120\nBad,x,1,NL,1', seedHubs());
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.homeHubId).toBe('hub-venlo');
    expect(r.items[0]!.weeklyVolume).toBe(120);
    expect(r.items[0]!.isDummy).toBe(false);
    expect(r.errors).toHaveLength(1);
  });

  it('imports test order lines by name or id', () => {
    const hubs = seedHubs();
    const stores = generateStores(hubs, 1);
    const r = parseOrderLinesCsv(
      'target,product,quantity\nVenlo,DUM-A01,100\nhub-kassel-s001,Dummy product B,5\nNowhere,DUM-A01,1',
      seedProducts(),
      stores,
      hubs,
    );
    expect(r.items.map((l) => [l.targetId, l.productId, l.quantity])).toEqual([
      ['hub-venlo', 'prod-a', 100],
      ['hub-kassel-s001', 'prod-b', 5],
    ]);
    expect(r.errors).toHaveLength(1);
  });
});

describe('dummy count', () => {
  it('counts inputs still marked dummy', () => {
    const ws = seedWorkspace();
    const all = countDummyInputs(ws, 'scn-forecast');
    expect(all.dummy).toBe(all.total);
    ws.products = ws.products.map((p, i) => (i < 4 ? { ...p, isDummy: false } : p));
    const after = countDummyInputs(ws, 'scn-forecast');
    expect(after.dummy).toBe(all.total - 4);
  });
});

describe('coverage', () => {
  it('flags France as a coverage gap in the seeded network', () => {
    const fr = countryCoverage(seedHubs()).find((c) => c.country === 'FR');
    expect(fr?.gap).toBe(true);
  });
});
