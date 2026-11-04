// "Add a business" form in the business switcher.
// How it works: name, type and city; the person becomes its owner. It starts on Starter, or on Pro when the person
// already owns a Pro business, and opens straight away.

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { Button, Field, Input, Modal, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { addBusiness } from "../live";

const TYPES = [
  ["agency", "briefcase", "Sells and rents property for owners"],
  ["hotel", "hotel", "Rooms, front desk, restaurant and bar"],
  ["host", "bed-double", "Homestays and holiday homes"],
  ["developer", "building-2", "Builds and sells projects in units"],
  ["sponsor", "hand-coins", "Raises money from investors for projects"],
];

export function AddBusiness({ open, onClose, onAdded }) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState("agency");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (name.trim().length < 2) return setErr("Give the business a name.");
    setBusy(true);
    try {
      const r = await addBusiness({ name: name.trim(), type, ...(city.trim() ? { city: city.trim() } : {}) });
      toast(r.message);
      setName(""); setCity(""); setErr("");
      onAdded?.(r.data.id);
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a business" wide
      footer={<><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button icon="plus" disabled={busy} onClick={submit}>{busy ? "Adding…" : "Add business"}</Button></>}>
      <div className="pf-stack">
        <p className="muted" style={{ margin: 0 }}>You'll be its owner. It gets its own menu, team, branches and plan, and starts on the free Starter plan. Switch between your businesses from the name at the top of the sidebar.</p>
        <Field label="Business name" error={err}><Input value={name} autoFocus onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="e.g. Lakeside Homestay" /></Field>
        <Field label="What kind of business?">
          <div className="pf-role-pick">
            {TYPES.map(([id, icon, desc]) => (
              <button key={id} type="button" className={type === id ? "on" : ""} aria-pressed={type === id} onClick={() => setType(id)}>
                <b><Icon name={icon} size={15} /> {t(`type.${id}`)}</b><span>{desc}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Pokhara" /></Field>
      </div>
    </Modal>
  );
}
