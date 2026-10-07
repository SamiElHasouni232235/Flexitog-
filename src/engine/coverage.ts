import { haversineKm } from './geo';
import type { CountryCode, Hub } from './types';

/** Reference cities per sales country, used to check hub radius coverage. */
export const REFERENCE_CITIES: Record<CountryCode, Array<{ name: string; lat: number; lon: number }>> = {
  NL: [
    { name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
    { name: 'Rotterdam', lat: 51.9244, lon: 4.4777 },
    { name: 'Eindhoven', lat: 51.4416, lon: 5.4697 },
    { name: 'Groningen', lat: 53.2194, lon: 6.5665 },
    { name: 'Utrecht', lat: 52.0907, lon: 5.1214 },
  ],
  BE: [
    { name: 'Brussels', lat: 50.8503, lon: 4.3517 },
    { name: 'Antwerp', lat: 51.2194, lon: 4.4025 },
    { name: 'Gent', lat: 51.0543, lon: 3.7174 },
    { name: 'Liège', lat: 50.6326, lon: 5.5797 },
    { name: 'Charleroi', lat: 50.4108, lon: 4.4446 },
  ],
  LU: [{ name: 'Luxembourg', lat: 49.6116, lon: 6.1319 }],
  FR: [
    { name: 'Paris', lat: 48.8566, lon: 2.3522 },
    { name: 'Lille', lat: 50.6292, lon: 3.0573 },
    { name: 'Strasbourg', lat: 48.5734, lon: 7.7521 },
    { name: 'Metz', lat: 49.1193, lon: 6.1757 },
    { name: 'Lyon', lat: 45.764, lon: 4.8357 },
  ],
  DE: [
    { name: 'Berlin', lat: 52.52, lon: 13.405 },
    { name: 'Hamburg', lat: 53.5511, lon: 9.9937 },
    { name: 'Köln', lat: 50.9375, lon: 6.9603 },
    { name: 'Frankfurt', lat: 50.1109, lon: 8.6821 },
    { name: 'Stuttgart', lat: 48.7758, lon: 9.1829 },
    { name: 'München', lat: 48.1351, lon: 11.582 },
    { name: 'Nürnberg', lat: 49.4521, lon: 11.0767 },
    { name: 'Hannover', lat: 52.3759, lon: 9.732 },
  ],
};

export interface CountryCoverage {
  country: CountryCode;
  covered: string[];
  uncovered: string[];
  share: number;
  /** full: every reference city inside a hub radius. partial: some. gap: none. */
  status: 'full' | 'partial' | 'gap';
  gap: boolean;
}

export function countryCoverage(hubs: Hub[]): CountryCoverage[] {
  return (Object.keys(REFERENCE_CITIES) as CountryCode[]).map((country) => {
    const cities = REFERENCE_CITIES[country];
    const covered: string[] = [];
    const uncovered: string[] = [];
    for (const city of cities) {
      const inside = hubs.some((h) => haversineKm(h, city) <= h.radiusKm);
      (inside ? covered : uncovered).push(city.name);
    }
    const share = cities.length > 0 ? covered.length / cities.length : 0;
    const status = covered.length === 0 ? 'gap' : uncovered.length === 0 ? 'full' : 'partial';
    return { country, covered, uncovered, share, status, gap: status === 'gap' };
  });
}
