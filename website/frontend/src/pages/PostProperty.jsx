// Post a property: the form owners and agencies use to send a listing for Sheetal's review.

import { useState } from "react";
import { useSEO } from "../utils/seo";
import { useSearchParams } from "react-router-dom";
import { SitePostForm } from "../components/SitePostForm";
import { EmailVerify } from "../components/EmailVerify";
import { PostLayout } from "../components/PostLayout";
import { isEmailVerified } from "../utils/sitePosts";
import { PostTypePicker } from "../market/SiteRows";
import { Link, useNavigate } from "react-router-dom";
import { Upload, X, ArrowLeft, Check, LogIn } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../api/endpoints";
import { toItem } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { PageHead, Empty } from "../components/ui";
import { fmtPrice } from "../utils/format";

const STEPS = ["Basics", "Details", "Location", "Photos", "Contact"];
const FALLBACK = {
  purposes: ["Sale", "Rent"].map((name, i) => ({ id: i + 1, name })),
  property_types: ["House", "Land", "Apartment", "Flat", "Commercial Space", "Office Space", "Bungalow"].map((name, i) => ({ id: i + 1, name })),
  facilities: ["Parking", "Water Supply", "Security", "CCTV", "Power Backup", "Garden", "Balcony", "Lift", "WiFi", "Gym"].map((name, i) => ({ id: i + 1, name })),
};
const DISTRICTS = ["Kathmandu", "Lalitpur", "Bhaktapur", "Kaski", "Chitwan", "Rupandehi", "Morang", "Sunsari", "Jhapa", "Kavrepalanchok"];

export default function PostProperty() {
  useSEO("Post your property", "List your house, land or flat on Sheetal Property.");
  const { user, setAuth, toast } = useApp();
  const nav = useNavigate();
  const { data: attrs } = useAsync(() => api.attributes().then(toItem), []);
  const a = { ...FALLBACK, ...(attrs?.data || attrs || {}) };
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [category, setCategory] = useState("Home");
  const [f, setF] = useState({
    name: "", purpose_id: "", propertytype_id: "", total_price: "", rent_per_month: "",
    bedrooms: "", bathrooms: "", kitchens: "", living_room: "", floors: "", parking: "", completion_year: "",
    land_area_in_anna_lal: "", land_area_in_ropani_lal: "", road_access: "", land_facing: "",
    property_location: "", district: "", town: "", tol: "", ward_no: "", lat: "", lng: "",
    property_highlights: "", property_description: "", youtube_url: "",
    owner_name: "", owner_info: "", owner_email: "", facilities_id: [],
  });
  const [feature, setFeature] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [params] = useSearchParams();
  const type = params.get("type") || "sell";
  const [verified, setVerified] = useState(() => isEmailVerified(user));
  const rentId = a.purposes.find((p) => /rent/i.test(p.name))?.id, saleId = a.purposes.find((p) => /sale|sell|buy/i.test(p.name))?.id;
  if (type === "rent" && rentId && !f.purpose_id) setTimeout(() => setF((x) => (x.purpose_id ? x : { ...x, purpose_id: rentId })), 0);
  if (type === "sell" && saleId && !f.purpose_id) setTimeout(() => setF((x) => (x.purpose_id ? x : { ...x, purpose_id: saleId })), 0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isRent = String(a.purposes.find((p) => String(p.id) === String(f.purpose_id))?.name || "").toLowerCase().includes("rent");

  if (!user) return <div className="container"><Empty icon={LogIn} title="Log in to post a property">Listing is free for owners and agencies.<button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setAuth("login")}>Log in</button></Empty></div>;

  if (["stay", "project", "invest"].includes(type)) return <SitePostForm key={type + (params.get("edit") || "")} type={type} />;

  const valid = () => {
    if (step === 0 && (!f.name.trim() || !f.purpose_id || !f.propertytype_id)) return "Add a title, purpose and type.";
    if (step === 2 && !f.property_location.trim()) return "Add the property location.";
    if (step === 3 && !feature) return "Add a cover photo.";
    if (step === 4 && !f.owner_info.trim()) return "Add a contact number.";
    return "";
  };
  const next = () => { const e = valid(); setErr(e); if (!e) { setStep(step + 1); window.scrollTo({ top: 0, behavior: "smooth" }); } };

  const submit = async () => {
    const e = valid(); setErr(e); if (e) return;
    if (!verified) { setErr("Verify your email first."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => Array.isArray(v) ? v.forEach((x) => fd.append(`${k}[]`, x)) : fd.append(k, v || ""));
      fd.append("propertycategory", category);
      fd.append("country", "Nepal");
      fd.append("feature_image", feature.file);
      gallery.forEach((g) => fd.append("gallery_images[]", g.file));
      const r = await api.postProperty(fd);
      toast(r?.message || "Sent for review. We'll email you when it's live.");
      nav("/my-profile?tab=listings");
    } catch (x) {
      setErr(x.errors ? Object.values(x.errors).flat()[0] : x.message);
    } finally { setBusy(false); }
  };

  const Opt = ({ list, k }) => (
    <div className="row-wrap" style={{ gap: 8 }}>{list.map((o) => <button type="button" key={o.id} className={`chip ${String(f[k]) === String(o.id) ? "active" : ""}`} onClick={() => setF({ ...f, [k]: o.id })}>{o.name}</button>)}</div>
  );
  const input = (k, l, t = "text", ph = "") => <div className="field"><label>{l}</label><input className="input" type={t} placeholder={ph} value={f[k]} onChange={set(k)} /></div>;

  const STEP_INFO = [["Basics", "Title, purpose and price"], ["Details", "Rooms, size and facilities"], ["Location", "Address and district"], ["Photos", "Cover and gallery"], ["Contact", "Owner and description"]];
  const HEAD = [["What are you listing?", "Buyers and tenants see the title and price first."], ["Size and features", "Fill in what applies. Leave the rest empty."], ["Where is it?", "District and address help people find it in search."], ["Photos", "Bright, wide photos get more enquiries. The first one is the cover."], ["Contact and description", "Enquiries come to this phone and to your email."]];
  return (
    <PostLayout type={isRent || type === "rent" ? "rent" : "sell"} steps={STEP_INFO} step={step} onStep={(i) => { setErr(""); setStep(i); }} section={HEAD[step][0]} sub={HEAD[step][1]} error={err}
      preview={{ cover: feature?.url, title: f.name, price: isRent ? f.rent_per_month : f.total_price, per: isRent ? " / month" : "", location: [f.property_location, f.district].filter(Boolean).join(", "), facts: [category, f.bedrooms && f.bedrooms + " bed", f.bathrooms && f.bathrooms + " bath", f.land_area_in_anna_lal && f.land_area_in_anna_lal + " aana", f.road_access && f.road_access + " road"] }}
      actions={<>
        {step > 0 ? <button className="btn btn-ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Back</button> : <Link to="/" className="btn btn-ghost">Cancel</Link>}
        {step < STEPS.length - 1 ? <button className="btn btn-primary" onClick={next}>Continue</button>
          : <button className="btn btn-primary" disabled={busy || !verified} onClick={submit}>{busy ? "Sending…" : "Send for review"}</button>}
      </>}>
      {step === 0 && <>
        <div className="field"><label>Listing type</label><div className="seg" style={{ alignSelf: "flex-start" }}>{["Home", "Land", "Apartment"].map((c) => <button type="button" key={c} className={category === c ? "on" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div></div>
        {input("name", "Title", "text", "e.g. 4 BHK house in Budhanilkantha")}
        <div className="field"><label>Purpose</label><Opt list={a.purposes.filter((p) => !/invest/i.test(p.name))} k="purpose_id" /></div>
        <div className="field"><label>Property type</label><Opt list={a.property_types} k="propertytype_id" /></div>
        <div className="form-grid">
          <div className="field"><label>{isRent ? "Rent per month (Rs.)" : "Total price (Rs.)"}</label><input className="input" type="number" value={isRent ? f.rent_per_month : f.total_price} onChange={set(isRent ? "rent_per_month" : "total_price")} />{(f.total_price || f.rent_per_month) && <span className="tiny muted">{fmtPrice(isRent ? f.rent_per_month : f.total_price)}</span>}</div>
          {input("youtube_url", "YouTube video (optional)", "url", "https://youtube.com/…")}
        </div>
      </>}

      {step === 1 && <>
        {category !== "Land" && <div className="form-grid">{input("bedrooms", "Bedrooms", "number")}{input("bathrooms", "Bathrooms", "number")}{input("kitchens", "Kitchens", "number")}{input("living_room", "Living rooms", "number")}{input("floors", "Floors", "number")}{input("completion_year", "Year built", "number", "2078 / 2021")}{input("parking", "Parking", "text", "1 car, 2 bikes")}</div>}
        <div className="form-grid">{input("land_area_in_anna_lal", "Land area (aana)", "number")}{input("land_area_in_ropani_lal", "Land area (ropani)", "number")}{input("road_access", "Road access (ft)", "text", "13 ft")}
          <div className="field"><label>Facing</label><select className="select" value={f.land_facing} onChange={set("land_facing")}><option value="">Select</option>{["East", "West", "North", "South", "North-East", "North-West", "South-East", "South-West"].map((d) => <option key={d}>{d}</option>)}</select></div>
        </div>
        <div className="field"><label>Facilities</label>
          <div className="row-wrap" style={{ gap: 8 }}>{(a.facilities || []).map((o) => { const on = f.facilities_id.includes(o.id); return <button type="button" key={o.id} className={`chip ${on ? "active" : ""}`} onClick={() => setF({ ...f, facilities_id: on ? f.facilities_id.filter((x) => x !== o.id) : [...f.facilities_id, o.id] })}>{on && <Check size={14} />}{o.name}</button>; })}</div>
        </div>
      </>}

      {step === 2 && <>
        {input("property_location", "Address", "text", "e.g. Dhapasi Height, Kathmandu")}
        <div className="form-grid">
          <div className="field"><label>District</label><select className="select" value={f.district} onChange={set("district")}><option value="">Select district</option>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</select></div>
          {input("town", "Municipality / town")}{input("tol", "Tole")}{input("ward_no", "Ward no.", "number")}{input("lat", "Latitude (optional)", "text", "27.7172")}{input("lng", "Longitude (optional)", "text", "85.3240")}
        </div>
      </>}

      {step === 3 && <>
        <div className="field"><label>Cover photo</label>
          {feature
            ? <div className="thumbs" style={{ gridTemplateColumns: "minmax(0, 320px)" }}><div style={{ aspectRatio: "4/3" }}><img src={feature.url} alt="" /><button type="button" onClick={() => setFeature(null)} aria-label="Remove"><X size={14} /></button></div></div>
            : <label className="drop"><Upload size={26} style={{ margin: "0 auto 8px" }} />Click to upload the main photo<input type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files[0]; if (file) setFeature({ file, url: URL.createObjectURL(file) }); }} /></label>}
        </div>
        <div className="field"><label>Gallery ({gallery.length})</label>
          <label className="drop"><Upload size={22} style={{ margin: "0 auto 8px" }} />Add more photos<input type="file" accept="image/*" multiple hidden onChange={(e) => setGallery([...gallery, ...Array.from(e.target.files).map((file) => ({ file, url: URL.createObjectURL(file) }))])} /></label>
          {gallery.length > 0 && <div className="thumbs">{gallery.map((g, i) => <div key={g.url}><img src={g.url} alt="" /><button type="button" onClick={() => setGallery(gallery.filter((_, k) => k !== i))} aria-label="Remove"><X size={14} /></button></div>)}</div>}
        </div>
      </>}

      {step === 4 && <>
        <div className="form-grid">{input("owner_name", "Owner / contact name")}{input("owner_info", "Contact phone", "tel", "98XXXXXXXX")}<div className="full">{input("owner_email", "Contact email", "email")}</div></div>
        <div className="field"><label>Highlights</label><textarea className="textarea" style={{ minHeight: 80 }} placeholder="Corner plot, 20 ft road, lal purja ready…" value={f.property_highlights} onChange={set("property_highlights")} /></div>
        <div className="field"><label>Description</label><textarea className="textarea" placeholder="Describe the property, neighbourhood and nearby facilities" value={f.property_description} onChange={set("property_description")} /></div>
        {!verified && <EmailVerify user={user} onVerified={(email) => { setVerified(true); setF({ ...f, owner_email: f.owner_email || email }); setErr(""); }} />}
      </>}

    </PostLayout>
  );
}
