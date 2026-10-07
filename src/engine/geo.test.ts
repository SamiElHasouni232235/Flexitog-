import { describe, expect, it } from 'vitest';
import { haversineKm, offsetPoint, roadKm } from './geo';

describe('distance', () => {
  it('returns 0 for the same point', () => {
    expect(haversineKm({ lat: 51, lon: 6 }, { lat: 51, lon: 6 })).toBe(0);
  });

  it('matches a known distance: Paris to London is about 344 km', () => {
    const km = haversineKm({ lat: 48.8566, lon: 2.3522 }, { lat: 51.5074, lon: -0.1278 });
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(348);
  });

  it('gives one degree of latitude as about 111.2 km', () => {
    expect(haversineKm({ lat: 50, lon: 8 }, { lat: 51, lon: 8 })).toBeCloseTo(111.2, 0);
  });

  it('is symmetric', () => {
    const a = { lat: 51.37, lon: 6.17 };
    const b = { lat: 48.14, lon: 11.58 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it('applies the road factor', () => {
    const a = { lat: 50, lon: 8 };
    const b = { lat: 51, lon: 8 };
    expect(roadKm(a, b, 1.25)).toBeCloseTo(haversineKm(a, b) * 1.25, 9);
  });

  it('offsets a point by the requested distance', () => {
    const origin = { lat: 51, lon: 6 };
    const p = offsetPoint(origin, 80, 1.1);
    expect(haversineKm(origin, p)).toBeCloseTo(80, 0);
  });
});
