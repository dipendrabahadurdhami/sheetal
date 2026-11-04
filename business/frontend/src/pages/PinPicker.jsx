// The map pin for a listing: tap to place, drag to adjust, or use the device's location.
// Rules: stays show this exact pin to the public; other kinds show only an approximate area.

import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { showsExactLocation } from "@sheetal/shared/data/catalog";

const KATHMANDU = [27.7172, 85.324];
const pin = L.divIcon({ className: "loc-pin", iconSize: [30, 40], iconAnchor: [15, 40],
  html: '<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 25 15 25s15-14 15-25C30 6.7 23.3 0 15 0z"/><circle cx="15" cy="15" r="6"/></svg>' });

export function PinPicker({ value, onChange, kind, t }) {
  const box = useRef(null), map = useRef(null), marker = useRef(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const has = value && Number(value.lat) && Number(value.lng);

  const place = (ll) => {
    const v = { lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) };
    if (!marker.current) {
      marker.current = L.marker(ll, { icon: pin, draggable: true }).addTo(map.current);
      marker.current.on("dragend", () => place(marker.current.getLatLng()));
    } else marker.current.setLatLng(ll);
    changeRef.current(v);
  };

  useEffect(() => {
    const start = has ? [Number(value.lat), Number(value.lng)] : KATHMANDU;
    map.current = L.map(box.current, { scrollWheelZoom: false }).setView(start, has ? 16 : 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map.current);
    if (has) place(L.latLng(start));
    map.current.on("click", (e) => place(e.latlng));
    return () => { map.current.remove(); map.current = null; marker.current = null; };
  }, []);

  const locate = () => navigator.geolocation?.getCurrentPosition((p) => {
    const ll = L.latLng(p.coords.latitude, p.coords.longitude);
    map.current.setView(ll, 17);
    place(ll);
  });

  return (
    <div className="pf-stack tight">
      <div ref={box} className="map loc-canvas" style={{ height: 300 }} role="application" aria-label={t("wiz.tapMap")} />
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="outline" size="sm" icon="crosshair" onClick={locate}>{t("wiz.myLocation")}</Button>
        <span className="small muted tnum">{has ? t("wiz.pinned", { lat: value.lat, lng: value.lng }) : t("wiz.tapMap")}</span>
      </div>
      <div className="pf-note"><Icon name={showsExactLocation(kind) ? "map-pinned" : "shield-check"} size={16} />
        <span className="small">{t(showsExactLocation(kind) ? "wiz.pinPublic" : "wiz.pinPrivate")}</span></div>
    </div>
  );
}
