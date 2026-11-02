import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Link } from "@sheetal/shared/core/router";
import { inDays } from "@sheetal/shared/core/format";
import { Badge, Button, Checkbox, Drawer, Empty, Field, Input, PageHead, Panel, Seg, Select, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { integrationsOf, STATUS_LABEL, STATUS_TONE } from "@sheetal/shared/data/integrations";

// Channels and alerts, social sharing and the AI voice assistant for one business.
// Demo note: connect/test buttons simulate the result; the backend does the real work
// (WhatsApp service, Meta Graph API, voice engine) and saves the same fields.

const later = (fn, ms = 900) => setTimeout(fn, ms);
const Ok = ({ st }) => <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>;
const stOf = (done, started) => (done ? "done" : started ? "review" : "off");

function useBiz(tenant, key, seed) {
  const { db, update } = useStore();
  const v = db[key]?.[tenant.id] || seed(tenant, db);
  const set = (fn) => update((d) => { d[key] = d[key] || {}; const cur = structuredClone(d[key][tenant.id] || seed(tenant, d)); fn(cur); d[key][tenant.id] = cur; });
  return [v, set, db];
}

// ───────────────────────── Channels and alerts ─────────────────────────
const ALERT_EVENTS = [
  ["lead", "New lead or enquiry"], ["match", "A buyer requirement matches your listing"], ["visit", "Site visit or tour booked"],
  ["payment", "Payment received"], ["listing", "Your listing goes live (share it to the group)"], ["daily", "Daily summary at 8 pm"],
];
const seedChannels = (tenant) => ({
  wa: { mode: "sheetal", state: "idle", phone: "", sendTo: "self", group: "", groups: [], events: { lead: true, match: true, visit: true, payment: true, listing: true, daily: false } },
  meta: { pageName: "", instagram: "" },
  web: { on: true },
  email: tenant.email,
});

export function Channels({ tenant }) {
  const toast = useToast();
  const [c, set, db] = useBiz(tenant, "bizChannels", seedChannels);
  const platformWa = integrationsOf(db).whatsapp;
  const ownAllowed = platformWa.businessesOwnNumber || platformWa.mode === "qr";
  const dom = db.domains?.[tenant.id];
  const waSt = c.wa.mode === "sheetal" ? "done" : stOf(c.wa.state === "linked", c.wa.state === "waiting");
  const embed = `<script src="https://sheetalproperty.com/chat.js" data-business="${tenant.id}" async></script>`;
  return (
    <>
      <PageHead title="Channels and alerts" sub="Where customers reach you, and where you get told about new leads." />
      <Panel title="WhatsApp" sub="Customer messages come into Inbox. Alerts go to your own chat or a WhatsApp group." pad actions={<Ok st={waSt} />}>
        <div className="pf-stack">
          <Field label="Number used"><Seg value={c.wa.mode} onChange={(v) => set((x) => { x.wa.mode = v; })} options={[{ id: "sheetal", label: "Sheetal's number (ready now)" }, { id: "own", label: "My own WhatsApp" }]} /></Field>
          {c.wa.mode === "own" && (!ownAllowed
            ? <div className="pf-note"><Icon name="info" size={16} /><span>Sheetal hasn't turned on own numbers yet. You can use Sheetal's number until then.</span></div>
            : c.wa.state === "linked"
              ? <div className="pf-note"><Icon name="smartphone" size={16} /><span>Linked to <b>{c.wa.phone}</b>. Keep this phone online. <button type="button" className="link" onClick={() => set((x) => { x.wa.state = "idle"; x.wa.phone = ""; x.wa.groups = []; })}>Unlink</button></span></div>
              : <div className="pf-stack tight">
                  {c.wa.state === "waiting" && <div className="pf-qr-box"><Icon name="qr-code" size={110} strokeWidth={1} /><span className="small muted">On your phone: WhatsApp → Linked devices → Link a device, then scan.</span></div>}
                  <div><Button icon="qr-code" disabled={c.wa.state === "waiting"} onClick={() => { set((x) => { x.wa.state = "waiting"; }); later(() => { set((x) => { x.wa.state = "linked"; x.wa.phone = tenant.phone; x.wa.groups = [{ id: "g1", name: `${tenant.name} team` }, { id: "g2", name: "Kathmandu property buyers" }]; }); toast("WhatsApp linked"); }, 2500); }}>{c.wa.state === "waiting" ? "Waiting for scan…" : "Link with QR code"}</Button></div>
                </div>)}
          <h4 className="pf-subhead">Send alerts to</h4>
          <Seg value={c.wa.sendTo} onChange={(v) => set((x) => { x.wa.sendTo = v; })} options={[{ id: "self", label: "My WhatsApp chat" }, { id: "group", label: "A WhatsApp group" }]} />
          {c.wa.sendTo === "group" && (c.wa.mode === "own" && c.wa.state === "linked"
            ? <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
                <Select value={c.wa.group} onChange={(v) => set((x) => { x.wa.group = v; })} options={[{ id: "", label: "Choose a group…" }, ...c.wa.groups.map((g) => ({ id: g.id, label: g.name }))]} />
                <Button variant="outline" icon="plus" onClick={() => { const id = `g${Date.now()}`; set((x) => { x.wa.groups.push({ id, name: `${tenant.name} alerts` }); x.wa.group = id; }); toast("Group created with you as admin"); }}>Create a new group</Button>
              </div>
            : <div className="pf-note"><Icon name="info" size={16} /><span>Group alerts need your own WhatsApp linked by QR (WhatsApp's official API can't post to groups).</span></div>)}
          <div className="pf-check-grid">{ALERT_EVENTS.map(([k, l]) => <Checkbox key={k} label={l} checked={!!c.wa.events[k]} onChange={(v) => set((x) => { x.wa.events[k] = v; })} />)}</div>
          <div><Button variant="outline" icon="send" onClick={() => toast(c.wa.sendTo === "group" && c.wa.group ? "Test alert sent to the group" : "Test alert sent to your WhatsApp")}>Send a test alert</Button></div>
        </div>
      </Panel>

      <Panel title="Email" sub="Addresses on your own domain (like info@ and sales@) arrive in Inbox; you reply from the dashboard." pad actions={<Ok st={stOf(dom?.step === "done", !!dom)} />}>
        <div className="pf-row-actions" style={{ justifyContent: "space-between" }}>
          <span className="small">{dom?.step === "done" ? <>Domain <b>{dom.name}</b> · {(dom.addresses || dom.mailboxes || []).length} addresses</> : <>Until then, customer email goes to <b>{c.email}</b>.</>}</span>
          <Link to="/business/domains" className="btn btn-outline"><Icon name="globe" size={16} />{dom ? "Manage domain and addresses" : "Connect your domain"}</Link>
        </div>
      </Panel>

      <Panel title="Facebook and Instagram" sub="Messenger and Instagram messages in Inbox, and sharing your listings to your page." pad actions={<Ok st={stOf(!!c.meta.pageName, false)} />}>
        <div className="pf-row-actions" style={{ justifyContent: "space-between" }}>
          <span className="small">{c.meta.pageName ? <>Page <b>{c.meta.pageName}</b>{c.meta.instagram && <> · Instagram <b>{c.meta.instagram}</b></>}</> : "Not connected."}</span>
          {c.meta.pageName
            ? <Button variant="outline" onClick={() => set((x) => { x.meta = { pageName: "", instagram: "" }; })}>Disconnect</Button>
            : <Button icon="facebook" onClick={() => { set((x) => { x.meta = { pageName: tenant.name, instagram: "@" + tenant.name.toLowerCase().replace(/[^a-z]/g, "") }; }); toast("Page connected"); }}>Connect with Facebook</Button>}
        </div>
      </Panel>

      <Panel title="Web chat" sub="A chat button on your listings and your own website." pad actions={<Ok st={c.web.on ? "done" : "off"} />}>
        <div className="pf-stack">
          <ToggleRow title="Show the chat button" sub="On your Sheetal pages" checked={c.web.on} onChange={(v) => set((x) => { x.web.on = v; })} />
          <Field label="Add to your own website" hint="Paste before </body>."><code className="pf-break">{embed}</code></Field>
        </div>
      </Panel>

      <Panel title="SMS" pad actions={<Badge tone="neutral">Not available</Badge>}>
        <p className="small muted">Sheetal sends messages on WhatsApp instead of SMS for now.</p>
      </Panel>
    </>
  );
}

// ───────────────────────── Social sharing ─────────────────────────
const PLATFORMS = [["facebook", "Facebook page", "facebook"], ["instagram", "Instagram", "instagram"], ["wagroup", "WhatsApp group", "message-circle"]];
const seedSocial = () => {
  return {
    auto: { facebook: true, instagram: true, wagroup: true },
    template: "{title}\n{price} · {area}\nSee photos and details: {link}",
    posts: [],
  };
};

export function Social({ tenant }) {
  const toast = useToast();
  const [s, set, db] = useBiz(tenant, "bizSocial", seedSocial);
  const ch = db.bizChannels?.[tenant.id] || seedChannels(tenant);
  const linked = { facebook: !!ch.meta.pageName, instagram: !!ch.meta.instagram, wagroup: ch.wa.sendTo === "group" && !!ch.wa.group };
  const mine = (db.listings || []).filter((l) => l.tenantId === tenant.id && l.status === "published");
  const [edit, setEdit] = useState(null);
  return (
    <>
      <PageHead title="Social sharing" sub="Post your listings to Facebook, Instagram and WhatsApp groups, now or at a set time." actions={<Button icon="plus" disabled={!mine.length} onClick={() => setEdit({ listingId: mine[0]?.id, platforms: PLATFORMS.map(([k]) => k).filter((k) => linked[k]), at: `${inDays(1)}T10:00` })}>Schedule a post</Button>} />
      <div className="pf-stats">{PLATFORMS.map(([k, l, ic]) => (
        <div key={k} className="card pf-stat"><span><Icon name={ic} size={14} /> {l}</span><b style={{ fontSize: 16 }}>{linked[k] ? <Badge tone="done">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}</b>{!linked[k] && <small><Link to="/business/channels" className="link">Connect in Channels</Link></small>}</div>
      ))}</div>
      <Panel title="Share automatically" sub="When a listing goes live, post it to:" pad>
        <div className="pf-stack">
          <div className="pf-check-grid">{PLATFORMS.map(([k, l]) => <Checkbox key={k} label={l} checked={!!s.auto[k]} disabled={!linked[k]} onChange={(v) => set((x) => { x.auto[k] = v; })} />)}</div>
          <Field label="Post text" hint="{title} {price} {area} {link} are filled in for each listing. The cover photo is attached."><Textarea rows={3} value={s.template} onChange={(e) => set((x) => { x.template = e.target.value; })} /></Field>
        </div>
      </Panel>
      <Panel title="Posts">
        {s.posts.length ? <Table rows={s.posts} minWidth={760} columns={[
          { key: "l", label: "Listing", render: (p) => <span className="pf-two"><b>{p.title}</b><small className="tnum">{p.listingId}</small></span> },
          { key: "w", label: "Where", render: (p) => <span className="pf-row-actions" style={{ justifyContent: "flex-start", gap: 6 }}>{p.platforms.map((k) => { const r = p.results[k]; return <Badge key={k} tone={!r ? "neutral" : r === "posted" ? "done" : "problem"} icon={PLATFORMS.find((x) => x[0] === k)[2]}>{r ? (r === "posted" ? "Posted" : r.replace("failed: ", "Failed: ")) : "Waiting"}</Badge>; })}</span> },
          { key: "t", label: "When", render: (p) => <span className="tnum small">{p.at.replace("T", " ")}</span> },
          { key: "s", label: "Status", render: (p) => <Badge tone={p.status === "posted" ? "done" : "progress"}>{p.status === "posted" ? "Posted" : "Scheduled"}</Badge> },
        ]} /> : <Empty icon="megaphone" title="No posts yet">Publish a listing or schedule a post.</Empty>}
      </Panel>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title="Schedule a post"
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit?.platforms.length} onClick={() => { const l = mine.find((x) => x.id === edit.listingId); set((x) => { x.posts.unshift({ id: `sp${Date.now()}`, listingId: l.id, title: l.title, platforms: edit.platforms, at: edit.at, status: "scheduled", results: {} }); }); setEdit(null); toast("Post scheduled"); }}>Schedule</Button></>}>
        {edit && <div className="pf-stack">
          <Field label="Listing"><Select value={edit.listingId} onChange={(v) => setEdit({ ...edit, listingId: v })} options={mine.map((l) => ({ id: l.id, label: l.title }))} /></Field>
          <Field label="Post to"><div className="pf-stack tight">{PLATFORMS.map(([k, l]) => <Checkbox key={k} label={l} disabled={!linked[k]} checked={edit.platforms.includes(k)} onChange={(v) => setEdit({ ...edit, platforms: v ? [...edit.platforms, k] : edit.platforms.filter((x) => x !== k) })} />)}</div></Field>
          <Field label="When"><Input type="datetime-local" value={edit.at} onChange={(e) => setEdit({ ...edit, at: e.target.value })} /></Field>
        </div>}
      </Drawer>
    </>
  );
}

// ───────────────────────── AI voice assistant ─────────────────────────
const VOICES = [["sita", "Sita", "Warm female · Nepali and English"], ["ram", "Ram", "Calm male · Nepali and English"], ["maya", "Maya", "Bright female · English first"]];
const SKILLS = [
  ["needs", "Understand what the caller needs", "Buy, rent, stay or invest; area; budget; size; when they want to move"],
  ["match", "Suggest matching listings", "Reads your live listings and suggests the best 3"],
  ["visit", "Book site visits", "Offers free times and books the visit"],
  ["lead", "Save every caller as a lead", "Name, phone and needs go to Inbox"],
  ["wa", "Send a WhatsApp summary", "Listings and visit details to the caller after the call"],
  ["handoff", "Hand over to a person", "When the caller asks, or is upset"],
];
const seedVoice = (tenant) => ({
  name: `${tenant.name} assistant`, voice: "sita", langs: "auto", speed: "normal",
  provider: "sheetal", // "sheetal" = included voices, "eleven" = the business's own ElevenLabs (connected once in AI accounts)
  greeting: `Namaste! ${tenant.name} ma swagat chha. Tapai ghar, jagga kinna, bhadama linna, ki aru kehi khojdai hunuhunchha?`,
  learnListings: true, info: "",
  faqs: [],
  skills: { needs: true, match: true, visit: true, lead: true, wa: true, handoff: true }, handoffPhone: tenant.phone, hours: "always",
  tested: false, widget: true, live: false,
  calls: [],
});
const OUTCOME = { visit: ["Visit booked", "done"], lead: ["Lead saved", "progress"], handoff: ["Handed to agent", "action"], info: ["Info only", "neutral"] };

// ───────────────────────── AI accounts (connect once, used by every AI feature) ─────────────────────────
const TEXT_PROVIDERS = [["gemini", "Google Gemini", "Free tier with daily limits"], ["openai", "OpenAI (ChatGPT models)", "Pay as you go; ChatGPT Plus does not include API use"], ["anthropic", "Anthropic Claude", "Pay as you go"]];
const seedAi = () => ({ mode: "sheetal", text: { provider: "gemini", key: "", ok: false }, voice: { key: "", ok: false, voiceId: "", voices: [] } });
export const useBizAi = (tenant) => useBiz(tenant, "bizAi", seedAi);

function KeyInput({ saved, placeholder, onSave }) {
  const [key, setKey] = useState("");
  return (
    <div className="pf-row-actions" style={{ flexWrap: "nowrap" }}>
      <Input type="password" autoComplete="off" value={key} placeholder={saved ? "••••••••••••" : placeholder} style={{ flex: 1 }} onChange={(e) => setKey(e.target.value)} />
      <Button variant="outline" disabled={!key.trim()} onClick={() => { onSave(); setKey(""); }}>Connect</Button>
    </div>
  );
}

export function AiAccounts({ tenant }) {
  const toast = useToast();
  const [a, set, db] = useBizAi(tenant);
  const allowed = integrationsOf(db).ai.allowOwnKeys;
  return (
    <>
      <PageHead title="AI accounts" sub="Connect once. Every AI feature (voice assistant, listing writer, lead finder, blog, Ask AI) then uses it." />
      <Panel title="Where your AI comes from" pad>
        <div className="pf-stack">
          <div className="pf-mode-pick">
            <button type="button" className={a.mode === "sheetal" ? "on" : ""} onClick={() => set((x) => { x.mode = "sheetal"; })}><Icon name="sparkles" size={22} /><b>Sheetal AI (included)</b><span>Ready now. Uses your plan's AI credits.</span></button>
            <button type="button" className={a.mode === "own" ? "on" : ""} disabled={!allowed} onClick={() => set((x) => { x.mode = "own"; })}><Icon name="key-round" size={22} /><b>My own accounts</b><span>{allowed ? "Free with your own free tiers. No AI credits used." : "Not turned on by Sheetal yet."}</span></button>
          </div>
        </div>
      </Panel>
      {a.mode === "own" && <>
        <Panel title="Writing and understanding" sub="Listing text, lead finding, blog, Ask AI and the voice assistant's thinking." pad actions={<Badge tone={a.text.ok ? "done" : a.text.key ? "progress" : "neutral"}>{a.text.ok ? "Connected" : a.text.key ? "Checking…" : "Not connected"}</Badge>}>
          <div className="pf-stack">
            <Field label="Provider"><div className="pf-stack tight">{TEXT_PROVIDERS.map(([id, n, d]) => <label key={id} className="check"><input type="radio" name="aiprov" checked={a.text.provider === id} onChange={() => set((x) => { x.text = { provider: id, key: "", ok: false }; })} /> <b>{n}</b> <span className="small muted">· {d}</span></label>)}</div></Field>
            <Field label="API key" hint={a.text.key ? "Saved. Paste a new key to replace it." : "Gemini: aistudio.google.com → Get API key. OpenAI: platform.openai.com → API keys. Claude: console.anthropic.com."}>
              <KeyInput saved={!!a.text.key} placeholder="Paste your API key" onSave={() => { set((x) => { x.text.key = "saved"; x.text.ok = false; }); later(() => { set((x) => { x.text.ok = true; }); toast("AI account connected"); }); }} />
            </Field>
          </div>
        </Panel>
        <ElevenLabs a={a} set={set} toast={toast} />
      </>}
    </>
  );
}

// ElevenLabs voice: free plan works (about 10 minutes of speech a month); paid plans for more.
function ElevenLabs({ a, set, toast }) {
  return (
    <Panel title="Voice (ElevenLabs)" sub="The voice your AI voice assistant speaks with." pad actions={<Badge tone={a.voice.ok ? "done" : a.voice.key ? "progress" : "neutral"}>{a.voice.ok ? "Connected" : a.voice.key ? "Checking…" : "Not connected"}</Badge>}>
      <div className="pf-stack">
        <div className="pf-note"><Icon name="info" size={16} /><span>Make a free account at elevenlabs.io → Profile → API keys. The free plan gives about 10 minutes of speech a month; calls use your own ElevenLabs minutes.</span></div>
        <Field label="ElevenLabs API key" hint={a.voice.key ? "Saved. Paste a new key to replace it." : ""}>
          <KeyInput saved={!!a.voice.key} placeholder="sk_…" onSave={() => { set((x) => { x.voice = { key: "saved", ok: false, voiceId: "", voices: [] }; }); later(() => { set((x) => { x.voice.ok = true; x.voice.voices = [{ id: "el1", name: "Rachel · calm" }, { id: "el2", name: "Adam · deep" }, { id: "el3", name: "My cloned voice" }]; x.voice.voiceId = "el1"; }); toast("ElevenLabs connected"); }); }} />
        </Field>
        {a.voice.ok && <Field label="Voice from your account"><Select value={a.voice.voiceId} onChange={(val) => set((x) => { x.voice.voiceId = val; })} options={a.voice.voices.map((o) => ({ id: o.id, label: o.name }))} /></Field>}
      </div>
    </Panel>
  );
}

// Demo replies: the live assistant uses the AI model; this shows how it reads needs from what people say.
function demoReply(text) {
  const low = text.toLowerCase(), got = [];
  if (/rent|bhada|bhaad/.test(low)) got.push("Rent"); else if (/buy|kinn|kin/.test(low)) got.push("Buy"); else if (/sell|bech/.test(low)) got.push("Sell");
  const area = ["baneshwor", "budhanilkantha", "lalitpur", "bhaktapur", "kapan", "imadol", "thamel", "pokhara"].find((a) => low.includes(a));
  if (area) got.push(area[0].toUpperCase() + area.slice(1));
  const money = text.match(/(\d+(?:\.\d+)?)\s*(crore|cr|lakh|k|thousand|hajar)/i); if (money) got.push(`Rs. ${money[1]} ${money[2]}`);
  const beds = low.match(/(\d)\s*(bhk|bed)/); if (beds) got.push(`${beds[1]} bedrooms`);
  return { got, say: got.length ? `Understood: ${got.join(", ")}. I'll look for matching listings. Shall I book a site visit?` : "Could you tell me if you want to buy, rent or sell, and in which area?" };
}

export function VoiceAssistant({ tenant }) {
  const toast = useToast();
  const [v, set] = useBiz(tenant, "voiceAssist", seedVoice);
  const [ai] = useBizAi(tenant);
  const [tab, setTab] = useState("setup");
  const [open, setOpen] = useState(null);
  const [say, setSay] = useState("");
  const [chat, setChat] = useState([]);
  const steps = [
    ["voice", "Voice and language", !!v.name && (v.provider === "eleven" ? ai.voice.ok : !!v.voice)],
    ["greeting", "Greeting", v.greeting.trim().length > 10],
    ["knowledge", "What it knows", v.learnListings || v.faqs.length > 0],
    ["skills", "What it does", Object.values(v.skills).some(Boolean)],
    ["test", "Test it", v.tested],
    ["live", "Go live", v.live],
  ];
  const done = steps.filter((s) => s[2]).length;
  const st = v.live ? "done" : done ? "review" : "off";
  return (
    <>
      <PageHead title="AI voice assistant" sub="Answers calls from your listings and website in a clear voice, in Nepali and English, understands what each caller needs, and books visits."
        actions={<Badge tone={STATUS_TONE[st]}>{v.live ? "Live" : STATUS_LABEL[st]}</Badge>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "setup", label: "Set up", icon: "list-checks" }, { id: "calls", label: "Conversations", icon: "phone-incoming", count: v.calls.length }]} />
      {tab === "setup" && <>
        <section className="card pf-panel pf-pad"><ol className="pf-setup-steps">{steps.map(([id, l, ok], i) => <li key={id} className={ok ? "done" : ""}><span>{ok ? <Icon name="check" size={12} /> : i + 1}</span>{l}</li>)}</ol></section>

        <Panel title="1. Voice and language" pad>
          <div className="pf-stack">
            <Field label="Assistant name"><Input value={v.name} onChange={(e) => set((x) => { x.name = e.target.value; })} /></Field>
            <Field label="Voice comes from">
              <Seg value={v.provider} onChange={(val) => set((x) => { x.provider = val; })} options={[{ id: "sheetal", label: "Sheetal voices (included)" }, { id: "eleven", label: "My own ElevenLabs account" }]} />
            </Field>
            {v.provider === "eleven" ? (ai.voice.ok
              ? <div className="pf-note"><Icon name="check" size={16} /><span>Using <b>{ai.voice.voices.find((o) => o.id === ai.voice.voiceId)?.name}</b> from your ElevenLabs account. <Link to="/business/ai-accounts" className="link">Change in AI accounts</Link></span></div>
              : <div className="pf-note"><Icon name="info" size={16} /><span>Connect your ElevenLabs once in <Link to="/business/ai-accounts" className="link">AI accounts</Link>; every AI feature then uses it.</span></div>) : <Field label="Voice" hint="Studio-quality voices, tuned for clear Nepali.">
              <div className="pf-mode-pick">{VOICES.map(([id, n, d]) => <button key={id} type="button" className={v.voice === id ? "on" : ""} onClick={() => set((x) => { x.voice = id; })}><Icon name="phone-call" size={20} /><b>{n}</b><span>{d}</span><span className="link small" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); toast(`Playing ${n}'s sample`); }}>Play sample</span></button>)}</div>
            </Field>}
            <div className="pf-grid-2 tight">
              <Field label="Language"><Seg value={v.langs} onChange={(val) => set((x) => { x.langs = val; })} options={[{ id: "auto", label: "Follow the caller" }, { id: "ne", label: "Nepali" }, { id: "en", label: "English" }]} /></Field>
              <Field label="Speaking speed"><Seg value={v.speed} onChange={(val) => set((x) => { x.speed = val; })} options={[{ id: "slow", label: "Slower" }, { id: "normal", label: "Normal" }]} /></Field>
            </div>
          </div>
        </Panel>

        <Panel title="2. Greeting" sub="The first thing callers hear." pad>
          <Textarea rows={3} value={v.greeting} onChange={(e) => set((x) => { x.greeting = e.target.value; })} />
        </Panel>

        <Panel title="3. What it knows" sub="Train it with your listings, business details and common questions." pad>
          <div className="pf-stack">
            <ToggleRow title="Learn from my live listings" sub="Prices, areas, sizes and photos. Updates by itself when listings change." checked={v.learnListings} onChange={(val) => set((x) => { x.learnListings = val; })} />
            <Field label="About the business" hint="Hours, fees, office address, areas you cover."><Textarea rows={3} value={v.info} onChange={(e) => set((x) => { x.info = e.target.value; })} /></Field>
            <h4 className="pf-subhead">Questions and answers</h4>
            {v.faqs.map((f, i) => (
              <div key={i} className="pf-grid-2 tight">
                <Input value={f.q} aria-label="Question" onChange={(e) => set((x) => { x.faqs[i].q = e.target.value; })} />
                <div className="pf-row-actions" style={{ flexWrap: "nowrap" }}><Input value={f.a} aria-label="Answer" style={{ flex: 1 }} onChange={(e) => set((x) => { x.faqs[i].a = e.target.value; })} /><button type="button" className="btn btn-ghost btn-icon" aria-label="Remove" onClick={() => set((x) => { x.faqs.splice(i, 1); })}><Icon name="trash-2" size={15} /></button></div>
              </div>
            ))}
            <div><Button variant="outline" icon="plus" onClick={() => set((x) => { x.faqs.push({ q: "", a: "" }); })}>Add a question</Button></div>
          </div>
        </Panel>

        <Panel title="4. What it does" sub="It listens for what the caller needs and acts on it." pad>
          <div className="pf-stack">
            {SKILLS.map(([k, l, d]) => <ToggleRow key={k} title={l} sub={d} checked={!!v.skills[k]} onChange={(val) => set((x) => { x.skills[k] = val; })} />)}
            {v.skills.handoff && <div className="pf-grid-2 tight"><Field label="Hand over to this number"><Input value={v.handoffPhone} onChange={(e) => set((x) => { x.handoffPhone = e.target.value; })} /></Field>
              <Field label="Answer calls"><Seg value={v.hours} onChange={(val) => set((x) => { x.hours = val; })} options={[{ id: "always", label: "24 hours" }, { id: "after", label: "Outside office hours" }]} /></Field></div>}
          </div>
        </Panel>

        <Panel title="5. Test it" sub="Type what a caller might say. The live assistant speaks and listens; this shows what it understands." pad>
          <div className="pf-stack">
            <div className="pf-msgs" style={{ minHeight: 120, maxHeight: 280 }}>
              <div className="pf-msg"><small>{v.name}</small>{v.greeting}</div>
              {chat.map((m, i) => <div key={i} className={`pf-msg ${m.me ? "out" : ""}`}>{!m.me && <small>{v.name}</small>}{m.text}{m.got?.length > 0 && <span className="pf-row-actions" style={{ justifyContent: "flex-start", gap: 4, marginTop: 6 }}>{m.got.map((g) => <Badge key={g} tone="done">{g}</Badge>)}</span>}</div>)}
            </div>
            <div className="pf-row-actions" style={{ flexWrap: "nowrap" }}>
              <Input value={say} placeholder="e.g. Baneshwor ma 2 bhk flat bhada ma chahiyo, 30k samma" style={{ flex: 1 }} onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === "Enter" && say.trim() && (() => { const r = demoReply(say); setChat([...chat, { me: true, text: say }, { text: r.say, got: r.got }]); setSay(""); set((x) => { x.tested = true; }); })()} />
              <Button icon="send" disabled={!say.trim()} onClick={() => { const r = demoReply(say); setChat([...chat, { me: true, text: say }, { text: r.say, got: r.got }]); setSay(""); set((x) => { x.tested = true; }); }}>Send</Button>
            </div>
          </div>
        </Panel>

        <Panel title="6. Go live" pad actions={<Badge tone={v.live ? "done" : "neutral"}>{v.live ? "Live" : "Off"}</Badge>}>
          <div className="pf-stack">
            <ToggleRow title="“Talk to us” button on my listings" sub="Callers talk in the browser, no phone bill." checked={v.widget} onChange={(val) => set((x) => { x.widget = val; })} />
            <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
              <Button icon="phone-call" disabled={!v.tested && !v.live} onClick={() => { set((x) => { x.live = !x.live; }); toast(v.live ? "Assistant turned off" : "Assistant is live"); }}>{v.live ? "Turn off" : "Go live"}</Button>
              {!v.tested && !v.live && <span className="small muted">Test it first (step 5).</span>}
            </div>
          </div>
        </Panel>
      </>}

      {tab === "calls" && <Panel title="Conversations" sub="Every call, what the caller needed, and what happened. Open one to read who said what.">
        <Table rows={v.calls} minWidth={820} onRowClick={(c) => setOpen(c)} columns={[
          { key: "w", label: "Caller", render: (c) => <span className="pf-two"><b>{c.who}</b><small className="tnum">{c.phone} · {c.via}</small></span> },
          { key: "t", label: "When", render: (c) => <span className="tnum small">{c.at.replace("T", " ")} · {Math.floor(c.secs / 60)}:{String(c.secs % 60).padStart(2, "0")}</span> },
          { key: "n", label: "Needs understood", render: (c) => <span className="pf-row-actions" style={{ justifyContent: "flex-start", gap: 4 }}>{c.needs.map((n) => <Badge key={n} tone="neutral">{n}</Badge>)}</span> },
          { key: "o", label: "Result", render: (c) => <Badge tone={OUTCOME[c.outcome][1]}>{OUTCOME[c.outcome][0]}</Badge> },
        ]} />
      </Panel>}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.who} sub={open && `${open.via} · ${open.at.replace("T", " ")}`}
        footer={<><Link to="/business/inbox" className="btn btn-outline"><Icon name="messages-square" size={16} />Open lead in Inbox</Link><Button onClick={() => setOpen(null)}>Close</Button></>}>
        {open && <div className="pf-stack">
          <div className="pf-row-actions" style={{ justifyContent: "flex-start", gap: 4 }}>{open.needs.map((n) => <Badge key={n} tone="done">{n}</Badge>)}<Badge tone={OUTCOME[open.outcome][1]}>{OUTCOME[open.outcome][0]}</Badge></div>
          <div className="pf-msgs">{open.lines.map(([who, text], i) => <div key={i} className={`pf-msg ${who === "user" ? "out" : ""}`}><small>{who === "user" ? open.who : v.name}</small>{text}</div>)}</div>
        </div>}
      </Drawer>
    </>
  );
}
