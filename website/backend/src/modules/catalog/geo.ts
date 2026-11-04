// Location privacy for sale and rent listings.
// Where it fits: used whenever a listing's map point leaves the server.
// How it works: the point is moved 150–350 m in a direction fixed by the listing, so it stays the same between visits
// but never shows the property itself. shared/src/core/geo.js draws the matching ~500 m area.

const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

export function approx(lat: number, lng: number, seed: string | number): [number, number] {
  const h = hash(String(seed));
  const angle = ((h % 3600) / 3600) * 2 * Math.PI;
  const dist = 150 + ((h >>> 12) % 200);
  const dLat = (dist * Math.cos(angle)) / 111320;
  const dLng = (dist * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [Number((lat + dLat).toFixed(4)), Number((lng + dLng).toFixed(4))];
}

export const validLatLng = (lat?: number | null, lng?: number | null): [number, number] | null =>
  lat && lng && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
