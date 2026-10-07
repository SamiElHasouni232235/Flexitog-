import { nearestHubId } from './stores';
import type { Hub, OrderLine, Product, Store } from './types';

/** Parse CSV text. Detects comma, semicolon or tab. Handles quoted fields with doubled quotes. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** Parse a number with a dot or comma decimal. */
export function parseNumber(s: string | undefined): number {
  if (s === undefined) return NaN;
  const t = s.replace(/\s/g, '');
  const normalised = t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t.replace(/,/g, '');
  return normalised === '' ? NaN : Number(normalised);
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function headerIndex(header: string[], names: string[]): number {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.indexOf(norm(n));
    if (i >= 0) return i;
  }
  return -1;
}

export interface CsvResult<T> {
  items: T[];
  errors: string[];
}

/** Stores CSV with header: name, lat, lon, country, weekly volume. */
export function parseStoresCsv(text: string, hubs: Hub[]): CsvResult<Store> {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) return { items: [], errors: ['The file needs a header row and at least one store.'] };
  const header = rows[0] as string[];
  const iName = headerIndex(header, ['name', 'store', 'store name']);
  const iLat = headerIndex(header, ['lat', 'latitude']);
  const iLon = headerIndex(header, ['lon', 'lng', 'longitude']);
  const iCountry = headerIndex(header, ['country']);
  const iVol = headerIndex(header, ['weekly volume', 'weeklyvolume', 'volume', 'weekly units']);
  if (iLat < 0 || iLon < 0) return { items: [], errors: ['Columns lat and lon are required.'] };
  const items: Store[] = [];
  rows.slice(1).forEach((r, idx) => {
    const lat = parseNumber(r[iLat]);
    const lon = parseNumber(r[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      errors.push(`Row ${idx + 2}: invalid coordinates.`);
      return;
    }
    const vol = iVol >= 0 ? parseNumber(r[iVol]) : 1;
    const point = { lat, lon };
    items.push({
      id: `store-${idx + 1}`,
      name: (iName >= 0 ? r[iName] : '') || `Store ${idx + 1}`,
      lat,
      lon,
      country: (iCountry >= 0 ? r[iCountry] : '') || '',
      weeklyVolume: Number.isFinite(vol) && vol >= 0 ? vol : 1,
      homeHubId: nearestHubId(point, hubs),
      isDummy: false,
    });
  });
  return { items, errors };
}

/**
 * Test order CSV with header: target, product, quantity.
 * Target matches a store or hub by id or name. Product matches by id, SKU or name.
 */
export function parseOrderLinesCsv(text: string, products: Product[], stores: Store[], hubs: Hub[]): CsvResult<OrderLine> {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length === 0) return { items: [], errors: ['No rows found.'] };
  const first = rows[0] as string[];
  const hasHeader = !Number.isFinite(parseNumber(first[2]));
  const header = hasHeader ? first : ['target', 'product', 'quantity'];
  let iTarget = headerIndex(header, ['target', 'store', 'hub', 'store or hub']);
  let iProduct = headerIndex(header, ['product', 'sku', 'product id']);
  let iQty = headerIndex(header, ['quantity', 'qty', 'units']);
  if (iTarget < 0) iTarget = 0;
  if (iProduct < 0) iProduct = 1;
  if (iQty < 0) iQty = 2;

  const targets = new Map<string, string>();
  for (const h of hubs) {
    targets.set(norm(h.id), h.id);
    targets.set(norm(h.name), h.id);
  }
  for (const s of stores) {
    targets.set(norm(s.id), s.id);
    targets.set(norm(s.name), s.id);
  }
  const productIds = new Map<string, string>();
  for (const p of products) {
    productIds.set(norm(p.id), p.id);
    productIds.set(norm(p.sku), p.id);
    productIds.set(norm(p.name), p.id);
  }

  const items: OrderLine[] = [];
  (hasHeader ? rows.slice(1) : rows).forEach((r, idx) => {
    const rowNo = idx + (hasHeader ? 2 : 1);
    const targetId = targets.get(norm(r[iTarget] ?? ''));
    const productId = productIds.get(norm(r[iProduct] ?? ''));
    const quantity = parseNumber(r[iQty]);
    if (!targetId) errors.push(`Row ${rowNo}: unknown store or hub "${r[iTarget] ?? ''}".`);
    else if (!productId) errors.push(`Row ${rowNo}: unknown product "${r[iProduct] ?? ''}".`);
    else if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Row ${rowNo}: quantity must be above 0.`);
    else items.push({ id: `line-${Date.now().toString(36)}-${idx}`, targetId, productId, quantity });
  });
  return { items, errors };
}

/** Serialise rows to CSV with quoting where needed. */
export function toCsv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v);
          return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}
