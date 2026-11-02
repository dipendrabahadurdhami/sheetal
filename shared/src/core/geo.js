// Location helpers shared by the website and the business app.

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// Shift a point 150–350 m in a direction fixed by the listing id: stable on every visit, never the property itself.
// Sale and rent listings show this point (with a ~500 m circle) instead of the real pin.
export function approx(lat, lng, seed) {
  const h = hash(seed), angle = ((h % 3600) / 3600) * 2 * Math.PI, dist = 150 + ((h >>> 12) % 200);
  const dLat = (dist * Math.cos(angle)) / 111320, dLng = (dist * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [Number((lat + dLat).toFixed(4)), Number((lng + dLng).toFixed(4))];
}

// Metres between two points (haversine).
export function metresBetween(p1, p2) {
  const [a1, o1] = p1, [a2, o2] = p2;
  const r = (d) => (d * Math.PI) / 180, R = 6371000;
  const x = Math.sin(r(a2 - a1) / 2) ** 2 + Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin(r(o2 - o1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const validLatLng = (lat, lng) => { const a = Number(lat), b = Number(lng); return a && b && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null; };
export const googleMapsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const directionsUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
