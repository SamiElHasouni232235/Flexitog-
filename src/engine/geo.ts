export interface LatLon {
  lat: number;
  lon: number;
}

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in km between two points. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Road distance in km: straight-line distance times the road factor. */
export function roadKm(a: LatLon, b: LatLon, roadFactor: number): number {
  return haversineKm(a, b) * roadFactor;
}

/** Point at a given distance (km) and bearing (radians, 0 = east, counter-clockwise) from an origin. Flat-earth approximation, fine below 200 km. */
export function offsetPoint(origin: LatLon, distanceKm: number, angleRad: number): LatLon {
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(toRad(origin.lat));
  return {
    lat: origin.lat + (distanceKm * Math.sin(angleRad)) / kmPerDegLat,
    lon: origin.lon + (distanceKm * Math.cos(angleRad)) / kmPerDegLon,
  };
}
