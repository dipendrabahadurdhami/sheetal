// Settings → Branding: upload the logo and set the workspace colours from it (Business and Pro plans).
// How it works: the logo is cleaned (background removed, saved as PNG) and its colours read in the browser, sorted
// into brand, dark and light; each can be changed by hand. Saving applies them for everyone in the business.

import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Button, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { brandTheme, cleanLogo, extractPalette, fillRoles, rolesFrom, savedRoles } from "@sheetal/shared/core/palette";
import { fileToBase64 } from "../api";
import { saveBranding } from "../live";

const loadImage = (url) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't a picture we can read.")); i.src = url; });

const SLOTS = [
  ["brand", "Brand colour", "The most colourful one: buttons, highlights and your colour themes."],
  ["dark", "Dark colour", "Top bar and sidebar in the dark theme, and text in the light theme."],
  ["light", "Light colour", "Top bar and sidebar in the light theme."],
];

export function BrandFromLogo({ tenant, canEdit, paid = true }) {
  if (!paid) {
    return (
      <div className="pf-alert action" style={{ marginBottom: 8 }}><Icon name="palette" size={18} />
        <div><b>Your own logo and colours</b><span>Upload your logo and your workspace takes its colours in every theme. This comes with the Business and Pro plans.</span></div>
        <a className="btn btn-sm btn-primary" href="/business/billing">See plans</a></div>
    );
  }
  return <BrandEditor tenant={tenant} canEdit={canEdit} />;
}

function BrandEditor({ tenant, canEdit }) {
  const toast = useToast();
  const { db, update } = useStore();
  const theme = db.session.theme;
  const saved = tenant.brandColors || [];
  const [logo, setLogo] = useState(null); // { file, url }
  const [roles, setRoles] = useState(() => savedRoles(saved)); // { brand, dark, light } or null
  const [made, setMade] = useState({ dark: false, light: false }); // roles made from the brand colour
  const [found, setFound] = useState([]); // every main colour found in the uploaded logo
  const [busy, setBusy] = useState(false);
  const colors = roles ? [roles.brand, roles.dark, roles.light] : [];
  const preview = brandTheme(colors);
  const was = savedRoles(saved);
  const changed = !!logo || colors.join() !== (was ? [was.brand, was.dark, was.light].join() : "");

  const fromColours = (list) => {
    const r = fillRoles(rolesFrom(list));
    setRoles({ brand: r.brand, dark: r.dark, light: r.light });
    setMade(r.made);
  };
  const pick = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("Use a PNG, JPG or WebP logo.");
    if (file.size > 8 * 1024 * 1024) return toast("Logos can be up to 8 MB.");
    try {
      // Any upload becomes a clean PNG: plain background removed, margin trimmed. Then every colour left is the logo's.
      const { blob, removed } = await cleanLogo(await loadImage(URL.createObjectURL(file)));
      const png = new File([blob], "logo.png", { type: "image/png" });
      const url = URL.createObjectURL(png);
      const list = extractPalette(await loadImage(url), 6, { keepLight: true });
      setLogo({ file: png, url });
      setFound(list);
      if (list.length) fromColours(list);
      toast(`${removed ? "Background removed. " : ""}${list.length ? `Found ${list.length} colour${list.length > 1 ? "s" : ""} in your logo.` : "No clear colours found; pick them below."}`);
    } catch (e) { toast(e.message); }
  };
  // Changing the brand colour by hand also remakes the roles that were made from it.
  const setRole = (key, value) => {
    const c = value.toUpperCase();
    if (key === "brand") {
      const r = fillRoles({ brand: c, dark: made.dark ? null : roles.dark, light: made.light ? null : roles.light });
      setRoles({ brand: r.brand, dark: r.dark, light: r.light });
    } else {
      setRoles({ ...roles, [key]: c });
      setMade({ ...made, [key]: false });
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveBranding(tenant.id, { colors, ...(logo ? { logo: await fileToBase64(logo.file) } : {}) });
      update((d) => { const t = d.tenants.find((x) => x.id === tenant.id); if (t) { t.brandColors = r.data.brandColors; t.logoUrl = r.data.logoUrl; } });
      setLogo(null);
      toast(r.message);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try {
      const r = await saveBranding(tenant.id, { colors: [] });
      update((d) => { const t = d.tenants.find((x) => x.id === tenant.id); if (t) t.brandColors = r.data.brandColors; });
      setRoles(null); setFound([]);
      toast("Back to Sheetal's colours.");
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="pf-stack" style={{ marginBottom: 8 }}>
      <div className="pf-row-actions" style={{ alignItems: "center", gap: 16 }}>
        <span className="pf-ws-logo pf-logo-check" style={{ width: 64, height: 64, border: "1px solid var(--line)" }}>{logo?.url || tenant.logoUrl ? <img src={logo?.url || tenant.logoUrl} alt="Logo" /> : <Icon name="image" size={22} />}</span>
        <div className="pf-two" style={{ flex: 1 }}><b>Logo and workspace colours</b><small className="muted">Upload your logo: its colours are found and sorted into three. Your workspace then uses only those three, in every theme, for everyone in your team.</small></div>
        {canEdit && <label className="btn btn-outline"><input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files[0])} /><Icon name="upload" size={16} />{tenant.logoUrl || logo ? "Change logo" : "Upload logo"}</label>}
      </div>

      {found.length > 0 && <small className="muted">Found in your logo: {found.length} colour{found.length > 1 ? "s" : ""}{found.length > 3 ? "; the workspace uses three" : ""}. Each was sorted into the slot it fits; change any slot below.</small>}

      {roles ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }} aria-label="Your three colours">
          {SLOTS.map(([key, name, hint]) => (
            <div key={key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input type="color" value={roles[key]} disabled={!canEdit} aria-label={`${name}: choose by hand`} title="Choose any colour by hand" onChange={(e) => setRole(key, e.target.value)}
                style={{ width: 40, height: 40, border: 0, padding: 0, background: "none", cursor: canEdit ? "pointer" : "default", flex: "none" }} />
              <div className="pf-two" style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>{name} <span className="tnum muted" style={{ fontWeight: 400 }}>{roles[key]}</span></b>
                <small className="muted">{hint}</small>
                {made[key] && <small className="muted"><Icon name="info" size={12} /> {key === "dark" ? "Your logo has no dark colour, so this one is made from your brand colour." : "Your logo has no light colour, so this is plain white."}</small>}
                {canEdit && found.length > 1 && (
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                    <small className="muted">From your logo:</small>
                    {found.map((c) => (
                      <button key={c} type="button" title={`Use ${c} as the ${name.toLowerCase()}`} aria-label={`Use ${c} as the ${name.toLowerCase()}`} aria-pressed={roles[key] === c} onClick={() => setRole(key, c)}
                        style={{ width: 20, height: 20, borderRadius: 999, background: c, padding: 0, cursor: "pointer", border: roles[key] === c ? "2px solid var(--accent)" : "1px solid var(--line-strong)", outline: roles[key] === c ? "2px solid color-mix(in srgb, var(--accent) 30%, transparent)" : "none" }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : canEdit && (
        <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
          <Button size="sm" variant="ghost" icon="palette" onClick={() => fromColours(["#9D1D21"])}>Pick colours by hand</Button>
        </div>
      )}
      {roles && canEdit && <small className="muted">To change a slot, tap a colour from your logo in it, or click its colour square to choose any colour by hand. Text on every colour is kept readable automatically.</small>}

      {preview && (
        <div aria-label="Preview of the themes" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {[["light", "Light", preview.lightBar, preview.lightText, "#FFFFFF"], ["dark", "Dark", preview.darkBar, "#FFFFFF", preview.darkPage], ["red", "Your colour", preview.darkBar, "#FFFFFF", preview.deep], ["bars", "Colour bars", preview.accentInk, "#FFFFFF", preview.darkPage]].filter(([id]) => id !== "bars" || saved.length > 0).map(([id, name, bar, ink, page]) => (
            // Click a preview to switch the workspace to that theme (it is saved for this browser).
            <button key={id} type="button" aria-pressed={theme === id} title={`Use the ${name.toLowerCase()} theme`} onClick={() => update((d) => { d.session.theme = id; })}
              style={{ borderRadius: 10, overflow: "hidden", border: theme === id ? "2px solid var(--accent)" : "1px solid var(--line)", outline: theme === id ? "2px solid color-mix(in srgb, var(--accent) 30%, transparent)" : "none", display: "flex", height: 84, padding: 0, cursor: "pointer", textAlign: "left", font: "inherit", background: "none" }}>
              <div style={{ width: 54, background: bar, color: ink, fontSize: 11, padding: 8 }}><b>Menu</b></div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ height: 24, background: bar, color: ink, fontSize: 11, padding: "5px 8px", display: "flex", justifyContent: "space-between" }}><span>{name}</span>{theme === id && <b>✓ In use</b>}</div>
                <div style={{ flex: 1, background: page, padding: 8 }}><span style={{ background: preview.accent, color: preview.accentText, borderRadius: 999, padding: "3px 10px", fontSize: 11 }}>Button</span></div>
              </div>
            </button>
          ))}
        </div>
      )}
      {canEdit && <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
        <Button disabled={busy || !changed} onClick={save}>{busy ? "Saving…" : "Save branding"}</Button>
        {saved.length > 0 && <Button variant="ghost" disabled={busy} onClick={reset}>Use Sheetal's colours</Button>}
      </div>}
    </div>
  );
}
