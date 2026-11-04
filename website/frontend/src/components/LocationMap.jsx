// Where a listing is, on a map.
// How it works: AreaMap (sale and rent) shows a shaded circle around a shifted centre, never the exact spot; ExactMap
// (stays, which guests travel to) shows the exact pin with Google Maps and directions links.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Navigation, ExternalLink } from "lucide-react";

import { approx, directionsUrl, googleMapsUrl, validLatLng } from "@sheetal/shared/core/geo";
export { approx, validLatLng };

const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const AREA_RADIUS = 500; // metres

const pin = L.divIcon({ className: "loc-pin", iconSize: [30, 40], iconAnchor: [15, 40],
  html: '<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 25 15 25s15-14 15-25C30 6.7 23.3 0 15 0z"/><circle cx="15" cy="15" r="6"/></svg>' });

// Leaflet map in a div; `draw` adds the layers. Redraws only when `at` changes.
function LeafletBox({ at, zoom, label, draw }) {
  const ref = useRef(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const map = L.map(ref.current, { scrollWheelZoom: false }).setView(at, zoom);
    L.tileLayer(TILES, { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    drawRef.current(map);
    return () => map.remove();
  }, [at[0], at[1], zoom]);
  return <div ref={ref} className="map loc-canvas" role="img" aria-label={label} />;
}

// `shifted`: the API already sent an approximate point (sale and rent from the real API), so it isn't moved again.
export function AreaMap({ lat, lng, seed, area, shifted = false }) {
  const ll = validLatLng(lat, lng);
  if (!ll) return <div className="card card-pad muted">Exact location shared after you contact the agent.</div>;
  const centre = shifted ? ll : approx(ll[0], ll[1], seed);
  return (
    <div className="loc-map">
      <LeafletBox at={centre} zoom={15} label={`Map of the area around ${area || "this property"}`}
        draw={(map) => L.circle(centre, { radius: AREA_RADIUS, className: "loc-area" }).addTo(map)} />
      <p className="small muted loc-note"><MapPin size={14} /> Approximate area{area ? ` in ${area}` : ""}. The exact location is shared after you contact the agent.</p>
    </div>
  );
}

export function ExactMap({ lat, lng, name, address }) {
  const ll = validLatLng(lat, lng);
  if (!ll) return address ? <p className="small muted loc-note"><MapPin size={14} /> {address}</p> : null;
  return (
    <div className="loc-map">
      <LeafletBox at={ll} zoom={16} label={`Map showing ${name || "the location"}`}
        draw={(map) => L.marker(ll, { icon: pin, title: name || "Location" }).addTo(map)} />
      {address && <p className="small muted loc-note"><MapPin size={14} /> {address}</p>}
      <div className="loc-actions">
        <a className="btn btn-primary" href={directionsUrl(ll[0], ll[1])} target="_blank" rel="noreferrer"><Navigation size={16} /> Get directions</a>
        <a className="btn btn-outline" href={googleMapsUrl(ll[0], ll[1])} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open in Google Maps</a>
      </div>
    </div>
  );
}
