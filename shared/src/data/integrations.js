// Platform integrations: every outside service Sheetal connects to, set up from Admin → Setup center.
// Each one is a list of steps; its status comes from the steps:
//   off    — nothing done yet ("Not set up")
//   review — started, or waiting on someone else (DNS, Meta review, template approval) ("In review")
//   done   — every step finished ("Setup complete")
// The backend stores the same shape and fills the "check" results; secrets are write-only (shown as ••••).

export const API_BASE = "https://api.sheetalproperty.com";

// Cloudflare Email Routing: incoming mail for any address on a domain goes to Cloudflare's MX servers,
// an Email Worker turns each message into JSON and posts it to our webhook, which saves it in the database.
export const emailDnsRecords = (domain, dkimSelector = "sheetal", dkimValue = "") => [
  { id: "mx1", type: "MX", host: "@", value: "route1.mx.cloudflare.net", prio: 13, purpose: "Receive mail" },
  { id: "mx2", type: "MX", host: "@", value: "route2.mx.cloudflare.net", prio: 86, purpose: "Receive mail" },
  { id: "mx3", type: "MX", host: "@", value: "route3.mx.cloudflare.net", prio: 24, purpose: "Receive mail" },
  { id: "spf", type: "TXT", host: "@", value: "v=spf1 include:_spf.mx.cloudflare.net include:_spf.sheetalproperty.com ~all", purpose: "Allowed senders (SPF)" },
  { id: "dkim", type: "TXT", host: `${dkimSelector}._domainkey`, value: dkimValue || "v=DKIM1; k=rsa; p=… (made by the backend)", purpose: "Signature (DKIM)" },
  { id: "dmarc", type: "TXT", host: "_dmarc", value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, purpose: "Policy (DMARC)" },
];

export const WA_TEMPLATES = [
  { id: "lead_reply", name: "lead_reply", lang: "en", category: "UTILITY", body: "Namaste {{1}}, thank you for asking about {{2}}. Our agent will call you shortly.", status: "draft" },
  { id: "visit_confirm", name: "visit_confirm", lang: "en", category: "UTILITY", body: "Your site visit for {{1}} is confirmed on {{2}} at {{3}}.", status: "draft" },
  { id: "payment_receipt", name: "payment_receipt", lang: "en", category: "UTILITY", body: "We received Rs. {{1}} for {{2}}. Receipt: {{3}}", status: "draft" },
  { id: "plan_renewal", name: "plan_renewal", lang: "en", category: "UTILITY", body: "Your {{1}} plan renews on {{2}}. Pay here: {{3}}", status: "draft" },
  { id: "new_listings", name: "new_listings", lang: "ne", category: "MARKETING", body: "{{1}} मा तपाईंको बजेटमा नयाँ सम्पत्ति आयो: {{2}}. Reply STOP to stop these messages.", status: "draft" },
];

// Fresh setup: nothing connected yet. Template status: draft → in_review (sent to Meta) → approved | rejected.
export function seedIntegrations() {
  return {
    email: {
      cfAccountId: "", cfToken: "", cfTokenOk: false,
      domain: "sheetalproperty.com", dnsAuto: true, dns: {}, // record id → "ok" | "pending" | "missing"
      worker: { name: "sheetal-inbound-mail", secret: "", deployed: false },
      outbound: { method: "cloudflare", from: "Sheetal Property <no-reply@sheetalproperty.com>", smtpHost: "", smtpPort: 587, smtpUser: "", dkimSelector: "sheetal", tested: false },
      addresses: [
        { id: "a1", local: "admin", deliver: "staff:s1", note: "Super admin", system: true },
        { id: "a2", local: "support", deliver: "inbox:support", note: "Support inbox for businesses and customers", system: true },
        { id: "a3", local: "no-reply", deliver: "none", note: "Sends only (password resets, receipts)", system: true },
      ],
    },
    whatsapp: {
      mode: "cloud", // "cloud" = official WhatsApp Cloud API, "qr" = linked device (unofficial, like the old site)
      appId: "", appSecret: "", wabaId: "", phoneNumberId: "", number: "", token: "",
      verifyToken: "", webhookOk: false, displayName: "Sheetal Property", nameStatus: "not_sent", // not_sent | in_review | approved
      templates: WA_TEMPLATES, testSent: false,
      qr: { state: "idle", device: "" }, // idle | waiting | linked
      businessesOwnNumber: false, // let businesses connect their own WhatsApp number
    },
    meta: { appId: "", appSecret: "", pageId: "", pageName: "", instagram: "", webhookOk: false, login: false, review: "not_sent" },
    google: {
      clientId: "", clientSecret: "", signIn: false,
      ga4: "", searchConsole: "", sitemapSent: false, business: "", mapsKey: "",
    },
    sms: { provider: "", on: false },
    // Sheetal's own paid AI: powers every AI feature (listing writer, lead finder, blog, Ask AI, voice assistant)
    // on the website, admin and business apps, counted against each plan's AI credits.
    ai: {
      provider: "anthropic", key: "", model: "claude-sonnet-5-5", tested: false,
      voiceKey: "", voiceOk: false, sttProvider: "elevenlabs", sttKey: "",
      workerUrl: "", workerOk: false,
      allowOwnKeys: true, // businesses may connect their own AI and voice accounts (their free tiers) instead
    },
  };
}

export const integrationsOf = (db) => db.integrations || seedIntegrations();

const filled = (...v) => v.every((x) => String(x || "").trim());

// Steps per integration: { id, label, done, wait } — `wait` marks steps waiting on someone else.
export function stepsOf(id, x, db) {
  if (id === "email") {
    const dnsOk = emailDnsRecords(x.domain).every((r) => x.dns[r.id] === "ok");
    const dnsSome = Object.values(x.dns).some((v) => v);
    return [
      { id: "cloudflare", label: "Connect Cloudflare", done: x.cfTokenOk },
      { id: "dns", label: `Mail records on ${x.domain}`, done: dnsOk, wait: dnsSome && !dnsOk },
      { id: "worker", label: "Inbound Email Worker", done: x.worker.deployed },
      { id: "outbound", label: "Sending replies", done: x.outbound.tested },
      { id: "addresses", label: "Platform addresses", done: x.addresses.length > 0 && dnsOk },
    ];
  }
  if (id === "whatsapp") {
    if (x.mode === "qr") return [
      { id: "qr", label: "Link a phone by QR", done: x.qr.state === "linked", wait: x.qr.state === "waiting" },
      { id: "test", label: "Send a test message", done: x.testSent },
    ];
    const approved = x.templates.filter((t) => t.status === "approved").length;
    return [
      { id: "app", label: "Meta app", done: filled(x.appId, x.appSecret) },
      { id: "number", label: "Business account and number", done: filled(x.wabaId, x.phoneNumberId, x.number) },
      { id: "token", label: "Access token", done: filled(x.token) },
      { id: "webhook", label: "Webhook", done: x.webhookOk },
      { id: "name", label: "Display name review", done: x.nameStatus === "approved", wait: x.nameStatus === "in_review" },
      { id: "templates", label: `Message templates (${approved} approved)`, done: approved > 0 && !x.templates.some((t) => t.status === "in_review"), wait: x.templates.some((t) => t.status === "in_review") },
      { id: "test", label: "Send a test message", done: x.testSent },
    ];
  }
  if (id === "meta") return [
    { id: "app", label: "Meta app", done: filled(x.appId, x.appSecret) },
    { id: "page", label: "Facebook page and Instagram", done: filled(x.pageId) },
    { id: "webhook", label: "Webhook for Messenger and Instagram", done: x.webhookOk },
    { id: "review", label: "Meta app review", done: x.review === "approved", wait: x.review === "in_review" },
  ];
  if (id === "google") return [
    { id: "signin", label: "Sign in with Google", done: x.signIn && filled(x.clientId, x.clientSecret) },
    { id: "ga4", label: "Google Analytics", done: filled(x.ga4) },
    { id: "search", label: "Search Console and sitemap", done: filled(x.searchConsole) && x.sitemapSent, wait: filled(x.searchConsole) && !x.sitemapSent },
    { id: "business", label: "Google Business Profile", done: filled(x.business) },
  ];
  if (id === "ai") return [
    { id: "model", label: "AI model subscription", done: filled(x.key) && x.tested },
    { id: "voice", label: "Voice (ElevenLabs)", done: x.voiceOk },
    { id: "stt", label: "Speech to text", done: filled(x.sttKey) || (x.sttProvider === "elevenlabs" && x.voiceOk) },
    { id: "worker", label: "Voice call server", done: x.workerOk },
  ];
  if (id === "sms") return [];
  if (id === "payments") {
    const s = db.platformSettings, k = s.gatewayKeys || {};
    return [
      { id: "khalti", label: "Khalti keys", done: filled(k.khalti_public, k.khalti_secret) },
      { id: "esewa", label: "eSewa merchant", done: filled(k.esewa_merchant) },
      { id: "fonepay", label: "Fonepay merchant", done: filled(k.fonepay_merchant) },
    ];
  }
  return [];
}

export function statusOf(steps) {
  if (!steps.length || steps.every((s) => !s.done && !s.wait)) return "off";
  if (steps.every((s) => s.done)) return "done";
  return "review";
}

// AI providers. Model ids for Claude are the current ones; others are typed in.
export const AI_PROVIDERS = [
  { id: "anthropic", name: "Anthropic Claude", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], note: "Recommended: best Nepali and English writing." },
  { id: "openai", name: "OpenAI", models: [], note: "Pay as you go. A ChatGPT Plus subscription does not include API use." },
  { id: "gemini", name: "Google Gemini", models: [], note: "Has a free tier with daily limits." },
  { id: "nvidia", name: "NVIDIA (old site)", models: [], note: "What the old voice agent used." },
];

export const STATUS_LABEL = { off: "Not set up", review: "In review", done: "Setup complete" };
export const STATUS_TONE = { off: "neutral", review: "progress", done: "done" };

export const INTEGRATIONS = [
  { id: "email", icon: "mail", name: "Email (own system)", sub: "Your own mail on Cloudflare: addresses like admin@ and support@ arrive in the dashboard inbox; replies go out from the same address." },
  { id: "whatsapp", icon: "message-circle", name: "WhatsApp", sub: "Messages, lead replies and notifications on WhatsApp. Used instead of SMS." },
  { id: "meta", icon: "facebook", name: "Facebook and Instagram", sub: "Messenger and Instagram messages in the inbox, and Facebook login." },
  { id: "google", icon: "search", name: "Google", sub: "Sign in with Google, Analytics, Search Console and Business Profile." },
  { id: "ai", icon: "sparkles", name: "AI models and voice", sub: "Sheetal's paid AI and voice subscription that runs every AI feature. Businesses may use their own free accounts instead." },
  { id: "payments", icon: "credit-card", name: "Payment gateways", sub: "Khalti, eSewa and Fonepay keys.", to: "/admin/settings" },
  { id: "channels", icon: "network", name: "Channel manager (OTA)", sub: "Booking.com, Airbnb, Agoda and others for hotels and stays.", to: "/admin/channels" },
  { id: "sms", icon: "smartphone", name: "SMS", sub: "Not used for now. WhatsApp sends every message instead." },
];

// Random token for webhook verify tokens and signing secrets.
export const makeSecret = (n = 32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
