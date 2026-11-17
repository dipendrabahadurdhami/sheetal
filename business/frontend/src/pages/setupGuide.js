// The words of the guided setup: for each first step, why it matters, how to do it in plain steps, and where the button goes.
// Where it fits: GettingStarted.jsx (the step-by-step page), Setup.jsx (the Overview card) and Help.jsx read these; the server (GET /setup) says which steps are done.
// How it works: GUIDE has one entry per step id; guideFor() adjusts the "first thing to add" for the kind of business.
// Rules: short plain English; every step says what to press; optional steps never block "ready".

const FIRST = {
  agency: { title: "Add your first listing", why: "Listings are what visitors see on the website. One good listing already brings enquiries.", how: ["Press Add my first listing.", "Fill in the type, price, place and a few photos.", "Press Send for review. Sheetal checks it and puts it on the website."], cta: "Add my first listing" },
  hotel: { title: "Add your rooms", why: "Guests can only book rooms you have added.", how: ["Press Add my rooms.", "Add each room type with its price and number of rooms.", "Open the Calendar to see your bookings."], cta: "Add my rooms", to: "/business/calendar" },
  host: { title: "Add your place", why: "Guests can only book a place you have added.", how: ["Press Add my place.", "Add the room or home with its price.", "Open the Calendar to see your bookings."], cta: "Add my place", to: "/business/calendar" },
  developer: { title: "Add your first project", why: "A project shows your building, its units and prices to buyers.", how: ["Press Add my first project.", "Add the name, place, photos and units.", "Press Send for review."], cta: "Add my first project", to: "/business/projects" },
  sponsor: { title: "Add your first offering", why: "An offering is the investment people can join.", how: ["Press Add my first offering.", "Add the amount, the return and the details.", "Press Send for review."], cta: "Add my first offering", to: "/business/listings/new" },
};

export const GUIDE = {
  details: { icon: "building-2", title: "Check your business details", why: "Your name, phone and address appear on bills and on your page. Customers trust a business with full details.", how: ["Press Open details.", "Check the name, phone, city and address.", "Add your PAN or VAT number if you have one, then press Save."], cta: "Open details" },
  logo: { icon: "palette", title: "Add your logo", why: "Your logo and colours make your bills, your page and this panel look like your own business.", how: ["Press Add my logo.", "Choose your logo picture.", "Sheetal reads the colours from it. Press Save."], cta: "Add my logo" },
  first: { icon: "house-plus" },
  team: { icon: "user-plus", title: "Invite your team", optional: true, why: "Each person gets their own login and sees only what they need. You can do this later.", how: ["Press Invite my team.", "Type the person's email and choose their role.", "They get an email link. When they accept, they can start."], cta: "Invite my team" },
  email: { icon: "mail", title: "Connect your own email", optional: true, why: "Send and receive email from your own business address, such as info@yourbusiness.com.", how: ["Press Connect email.", "Type your website name, for example yourbusiness.com.", "Follow the steps on the page. Sheetal can add the records for you if your domain is on Cloudflare."], cta: "Connect email" },
  verify: { icon: "shield-check", title: "Get verified", optional: true, why: "A verified business gets a badge and more trust from buyers.", how: ["Press Verify my business.", "Upload your company registration and PAN.", "Sheetal checks them and tells you."], cta: "Verify my business" },
  apps: { icon: "shopping-bag", title: "Look at the Marketplace", optional: true, why: "You start with the basics. When you need more, such as agreements, rentals or point of sale, add it here. You can try each one free first.", how: ["Press Open the Marketplace.", "Choose an app and read what it does.", "Press Try free, or Buy when you are ready."], cta: "Open the Marketplace" },
};

/** The guide text for one step of one business type. */
export function guideFor(type, id) {
  if (id === "first") return { ...GUIDE.first, ...(FIRST[type] || FIRST.agency) };
  return GUIDE[id];
}

/** The steps (from GET /setup) joined with their words; `to` is the guide's own address when it has one, else the server's. */
export function withWords(type, steps) {
  return (steps || []).map((s) => ({ ...s, ...guideFor(type, s.id), to: guideFor(type, s.id)?.to || s.to })).filter((s) => s.title);
}

/** The first step still to do (a required one before an optional one), or null when everything is done. */
export function nextStep(steps) {
  const todo = (steps || []).filter((s) => !s.done);
  return todo.find((s) => !s.optional) || todo[0] || null;
}

// The Help page: how-to guides with real steps.
export const HELP_GUIDES = [
  { id: "start", icon: "rocket", title: "Getting started", items: [
    { q: "What do I do first?", steps: ["Open Getting started from the Overview page.", "Do the steps one by one: details, logo, and your first listing or rooms.", "Everything else can wait."], to: "/business/start", cta: "Open Getting started" },
    { q: "How do I add more apps?", steps: ["Open the Marketplace.", "Choose an app and press Try free.", "When you are happy, press Buy. You can remove an app any time; your data stays."], to: "/business/marketplace", cta: "Open the Marketplace" },
  ] },
  { id: "listings", icon: "house-plus", title: "Listings", items: [
    { q: "How do I add a listing?", steps: ["Open Listings and press New listing.", "Fill in the details and add photos.", "Press Send for review. When Sheetal approves it, it shows on the website."], to: "/business/listings/new", cta: "Add a listing" },
    { q: "Why is my listing not on the website?", steps: ["Open Listings and look at its status.", "Pending means Sheetal is still checking it.", "Sent back means it needs changes. Open it, read the note, fix it and send it again."], to: "/business/listings", cta: "Open Listings" },
  ] },
  { id: "team", icon: "users", title: "Team", items: [
    { q: "How do I invite someone?", steps: ["Open Team and press Invite.", "Type their email and choose a role.", "They receive an email. When they accept, they appear in your team."], to: "/business/team", cta: "Open Team" },
    { q: "How do I change what someone can see?", steps: ["Open Team and open the person.", "Change their role or the branches they can use.", "Press Save. It works at once."], to: "/business/team", cta: "Open Team" },
  ] },
  { id: "email", icon: "mail", title: "Email", items: [
    { q: "How do I use my own business email?", steps: ["Open Settings, then Domain and email.", "Add your domain and follow the guide. If your domain is on Cloudflare, paste a token once and Sheetal adds the records.", "Create a mailbox such as info@yourbusiness.com. Open it in Email."], to: "/business/domains", cta: "Open Domain and email" },
  ] },
  { id: "leads", icon: "messages-square", title: "Enquiries", items: [
    { q: "Where do enquiries arrive?", steps: ["Open Inbox. Every enquiry from your listings and forms is there.", "Open one, write a reply and press Send.", "Mark it Won or Lost when it is finished."], to: "/business/inbox", cta: "Open Inbox" },
  ] },
  { id: "money", icon: "receipt", title: "Invoices and expenses", items: [
    { q: "How do I make an invoice?", steps: ["Open Invoices and press New.", "Choose the customer and add the lines.", "Press Send. Mark it paid when the money arrives."], to: "/business/invoices", cta: "Open Invoices" },
    { q: "How do I record an expense?", steps: ["Open Expenses and press New.", "Add the amount, the type and the date.", "Press Save. Your profit updates."], to: "/business/expenses", cta: "Open Expenses" },
  ] },
];

/** Guides that match a search (in the question or a step). */
export function searchGuides(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return HELP_GUIDES;
  return HELP_GUIDES.map((g) => ({ ...g, items: g.items.filter((i) => `${i.q} ${i.steps.join(" ")}`.toLowerCase().includes(q)) })).filter((g) => g.items.length);
}
