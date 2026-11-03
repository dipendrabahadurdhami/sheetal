import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Button, Field, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { brandTheme, extractPalette } from "@sheetal/shared/core/palette";
import { fileToBase64 } from "../api";
import { saveBranding } from "../live";

// Upload the logo: its main colours (up to 4) are read in the browser, can be changed, and on saving the whole
// workspace (top bar, sidebar, buttons, active item) uses them for everyone in the business, on every device.

const loadImage = (url) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't a picture we can read.")); i.src = url; });

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
  const { update } = useStore();
  const [logo, setLogo] = useState(null); // { file, url }
  const [colors, setColors] = useState(tenant.brandColors || []);
  const [busy, setBusy] = useState(false);
  const preview = brandTheme(colors);
  const changed = !!logo || colors.join() !== (tenant.brandColors || []).join();

  const pick = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("Use a PNG, JPG or WebP logo.");
    if (file.size > 2 * 1024 * 1024) return toast("Logos can be up to 2 MB.");
    const url = URL.createObjectURL(file);
    try {
      const found = extractPalette(await loadImage(url), 4);
      setLogo({ file, url });
      setColors(found);
      toast(found.length ? `Found ${found.length} colour${found.length > 1 ? "s" : ""} in your logo.` : "No clear colours found; pick them below.");
    } catch (e) { toast(e.message); }
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
      setColors([]);
      toast("Back to Sheetal's colours.");
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="pf-stack" style={{ marginBottom: 8 }}>
      <div className="pf-row-actions" style={{ alignItems: "center", gap: 16 }}>
        <span className="pf-ws-logo" style={{ width: 64, height: 64, background: "#fff", border: "1px solid var(--line)" }}>{logo?.url || tenant.logoUrl ? <img src={logo?.url || tenant.logoUrl} alt="Logo" /> : <Icon name="image" size={22} />}</span>
        <div className="pf-two" style={{ flex: 1 }}><b>Logo and workspace colours</b><small className="muted">Upload your logo and your workspace takes its colours in every theme: light, dark and your own colour theme. Everyone in your team sees them.</small></div>
        {canEdit && <label className="btn btn-outline"><input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files[0])} /><Icon name="upload" size={16} />{tenant.logoUrl || logo ? "Change logo" : "Upload logo"}</label>}
      </div>
      <Field label="Colours (up to 4)" hint="The most colourful one becomes your brand colour (buttons, and the third theme). Light and dark colours are used for the bars in light and dark themes. Text is always made readable.">
        <div className="pf-row-actions" style={{ flexWrap: "wrap", justifyContent: "flex-start" }}>
          {colors.map((c, i) => (
            <span key={i} className="pf-swatch-custom" title={i === 0 ? "Colour 1: top bar and sidebar" : i === 1 ? "Colour 2: buttons" : `Colour ${i + 1}`}>
              <input type="color" value={c} disabled={!canEdit} aria-label={`Colour ${i + 1}`} onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} />
              <span className="tnum">{c}</span>
              {canEdit && <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${c}`} onClick={() => setColors(colors.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>}
            </span>
          ))}
          {canEdit && colors.length < 4 && <Button size="sm" variant="ghost" icon="plus" onClick={() => setColors([...colors, colors[0] ? "#59595B" : "#9D1D21"])}>Add colour</Button>}
        </div>
      </Field>
      {preview && (
        <div className="pf-grid-3 tight" aria-label="Preview of the three themes" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {[["Light", preview.lightBar, "#1F1F21", "#FFFFFF"], ["Dark", preview.darkBar, "#FFFFFF", "#2B2B2D"], ["Your colour", preview.darkBar, "#FFFFFF", preview.deep]].map(([name, bar, ink, page]) => (
            <div key={name} style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", display: "flex", height: 84 }}>
              <div style={{ width: 54, background: bar, color: ink, fontSize: 11, padding: 8 }}><b>Menu</b></div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ height: 24, background: bar, color: ink, fontSize: 11, padding: "5px 8px" }}>{name}</div>
                <div style={{ flex: 1, background: page, padding: 8 }}><span style={{ background: preview.accent, color: preview.accentText, borderRadius: 999, padding: "3px 10px", fontSize: 11 }}>Button</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
      {canEdit && <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
        <Button disabled={busy || !changed} onClick={save}>{busy ? "Saving…" : "Save branding"}</Button>
        {(tenant.brandColors || []).length > 0 && <Button variant="ghost" disabled={busy} onClick={reset}>Use Sheetal's colours</Button>}
      </div>}
    </div>
  );
}
