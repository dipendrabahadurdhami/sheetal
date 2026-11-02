// Demo database: the site runs on this until the new backend is ready.
// Fake database for local development. Seeded, so data is the same on every machine.
// User changes (favourites, posted properties, reviews, profile) persist in localStorage.

// v6: plans now come from the shared platform plans (Starter, Business, Pro), not this file.
const STORE_KEY = "sheetal_demo_db_v6";

let seed = 20261012;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

const IMAGES = ["1.jpg","2.jpg","3.jpg","4.jpg","5.jpg","6.jpg","10.jpg","11.jpg","12.jpg","13.jpg","14.jpg","15.jpg","16.jpg","17.jpg","18.jpg","19.jpg"].map((f) => "/demo/" + f);
export { IMAGES };

export const LOCATIONS = [
  { locality: "Baneshwor", city: "Kathmandu", district: "Kathmandu", province: "Bagmati", lat: 27.6915, lng: 85.342 },
  { locality: "Budhanilkantha", city: "Kathmandu", district: "Kathmandu", province: "Bagmati", lat: 27.7725, lng: 85.362 },
  { locality: "Baluwatar", city: "Kathmandu", district: "Kathmandu", province: "Bagmati", lat: 27.7265, lng: 85.3304 },
  { locality: "Tokha", city: "Kathmandu", district: "Kathmandu", province: "Bagmati", lat: 27.7533, lng: 85.3245 },
  { locality: "Dhapasi", city: "Kathmandu", district: "Kathmandu", province: "Bagmati", lat: 27.7457, lng: 85.3297 },
  { locality: "Kapan", city: "Kathmandu", district: "Kathmandu", province: "Bagmati", lat: 27.7342, lng: 85.3614 },
  { locality: "Sanepa", city: "Lalitpur", district: "Lalitpur", province: "Bagmati", lat: 27.6841, lng: 85.3063 },
  { locality: "Jhamsikhel", city: "Lalitpur", district: "Lalitpur", province: "Bagmati", lat: 27.6795, lng: 85.3077 },
  { locality: "Bhaisepati", city: "Lalitpur", district: "Lalitpur", province: "Bagmati", lat: 27.6533, lng: 85.3002 },
  { locality: "Imadol", city: "Lalitpur", district: "Lalitpur", province: "Bagmati", lat: 27.6623, lng: 85.3448 },
  { locality: "Suryabinayak", city: "Bhaktapur", district: "Bhaktapur", province: "Bagmati", lat: 27.6614, lng: 85.4339 },
  { locality: "Lakeside", city: "Pokhara", district: "Kaski", province: "Gandaki", lat: 28.2096, lng: 83.9585 },
  { locality: "Bharatpur Height", city: "Bharatpur", district: "Chitwan", province: "Bagmati", lat: 27.6833, lng: 84.4333 },
  { locality: "Traffic Chowk", city: "Butwal", district: "Rupandehi", province: "Lumbini", lat: 27.7006, lng: 83.4483 },
];

export const PROPERTY_TYPES = ["House", "Land", "Apartment", "Flat", "Commercial Space", "Office Space", "Bungalow"];
export const CATEGORIES = ["Residential", "Commercial", "Semi-Commercial", "Agricultural"];
const AMENITIES = ["parking", "water_supply", "security", "cctv", "power_backup", "garden", "balcony", "lift", "wifi", "gym", "swimming_pool", "intercom"];
const FIRST = ["Aarav", "Sita", "Bikash", "Pooja", "Rajesh", "Anisha", "Sujan", "Kritika", "Prakash", "Manisha", "Nabin", "Sarita"];
const LAST = ["Shrestha", "Thapa", "Gurung", "Sharma", "Karki", "Maharjan", "Rai", "Adhikari", "Tamang", "Joshi", "KC", "Pradhan"];
// The API calls agency plans "Agent: Pro" etc.; the site shows them as agency tiers. Rows below use 0 = Pro, 1–2 = Business, 3 = Starter.
const TIERS = ["Agent: Pro", "Agent: Business", "Agent: Business", "Agent: Starter"];

// Agencies: each one is a real business with a contact person and the cities it works in.
// The first three are the same agencies that have a business workspace (t3, t7, t11).
const AGENCIES = [
  ["Himalayan Homes Realty", "Ramesh Karki", "Kathmandu", "Baneshwor", ["Kathmandu", "Lalitpur"], "Houses and land in the Kathmandu valley", 0, "himalayanhomes.com.np", "t3"],
  ["Kathmandu Property Point", "Bishal Thapa", "Kathmandu", "Baluwatar", ["Kathmandu"], "Flats, offices and rentals in Kathmandu", 0, "ktmpropertypoint.com", "t7"],
  ["Everest Realty Group", "Pasang Sherpa", "Lalitpur", "Jhamsikhel", ["Lalitpur", "Kathmandu"], "Apartments and family homes in Lalitpur", 1, "everestrealty.com.np", "t11"],
  ["Sheetal Property", "Aarav Shrestha", "Kathmandu", "Baneshwor", ["Kathmandu", "Lalitpur", "Bhaktapur"], "Buying, selling and renting across the valley", 0, "sheetalproperty.com", null],
  ["Valley Realty", "Sita Maharjan", "Lalitpur", "Imadol", ["Lalitpur", "Bhaktapur"], "Land plots and new houses south of the ring road", 1, "valleyrealty.com.np", null],
  ["Bhaktapur Ghar Jagga", "Rabin Prajapati", "Bhaktapur", "Suryabinayak", ["Bhaktapur"], "Land and houses in Bhaktapur and Suryabinayak", 2, "bhaktapurgharjagga.com", null],
  ["Pokhara Property House", "Bikash Gurung", "Pokhara", "Lakeside", ["Pokhara"], "Lakeside homes, land and rentals in Pokhara", 1, "pokharaproperty.com.np", null],
  ["Annapurna Realty", "Kritika Poudel", "Pokhara", "Lakeside", ["Pokhara"], "Hotels for sale, land and commercial space in Pokhara", 2, "annapurnarealty.com.np", null],
  ["Chitwan Land & Homes", "Prakash Adhikari", "Bharatpur", "Bharatpur Height", ["Bharatpur"], "Land, houses and farm plots in Chitwan", 2, "chitwanland.com.np", null],
  ["Butwal Real Estate Centre", "Manisha KC", "Butwal", "Traffic Chowk", ["Butwal"], "Houses, shutters and land in Butwal", 3, "butwalrealestate.com.np", null],
  ["Capital Rentals", "Nabin Joshi", "Kathmandu", "Dhapasi", ["Kathmandu"], "Furnished flats and houses for rent", 3, "capitalrentals.com.np", null],
  ["Lalitpur Homes & Land", "Anisha Rai", "Lalitpur", "Bhaisepati", ["Lalitpur"], "Bhaisepati and Sanepa homes for families", 3, "lalitpurhomes.com.np", null],
];

function makeAgents() {
  return AGENCIES.map(([name, person, city, area, cities, what, tier, domain, tid], i) => ({
    id: i + 1,
    first_name: name,
    last_name: "",
    name,
    user_name: slug(name),
    contact_person: person,
    tenant_id: tid,
    email: `info@${domain}`,
    phone: `98${int(41000000, 69999999)}`,
    whatsapp: `+97798${int(41000000, 69999999)}`,
    photo: null,
    designation: what,
    company_name: `${name} Pvt. Ltd.`,
    address: `${area}, ${city}`,
    cities,
    website_url: `https://${domain}`,
    facebook_url: "https://facebook.com",
    instagram_url: "https://instagram.com",
    tier: TIERS[tier],
    is_premium: tier < 2,
    email_verified: true,
    avg_rating: Number((4 + rnd() * 0.9).toFixed(1)),
    review_count: int(6, 60),
    listings_count: 0,
    about: `${name} is a real estate agency in ${area}, ${city}. ${what}. Contact ${person} for visits, papers and price advice.`,
    created_at: daysAgo(int(300, 2500)),
  }));
}

// Prices follow the city: per aana for land, total for houses, per month for rent.
const LAND_LAKH = { Kathmandu: [28, 65], Lalitpur: [22, 55], Bhaktapur: [14, 32], Pokhara: [15, 45], Bharatpur: [8, 22], Butwal: [6, 16] };
const CITY_X = { Kathmandu: 1, Lalitpur: 0.95, Bhaktapur: 0.7, Pokhara: 0.8, Bharatpur: 0.55, Butwal: 0.5 };
const r5 = (n, step) => Math.round(n / step) * step;
function makeProperty(i, agents) {
  const loc = pick(LOCATIONS);
  const purpose = i % 3 === 0 ? "Rent" : "Sale";
  const isRent = purpose === "Rent";
  const type = isRent ? pick(["House", "Flat", "Flat", "Apartment", "Commercial Space", "Office Space"]) : pick(["House", "House", "Land", "Land", "Apartment", "Bungalow", "Commercial Space"]);
  const commercial = type === "Commercial Space" || type === "Office Space";
  const category = commercial ? "Commercial" : type === "Land" ? (loc.city === "Bharatpur" || loc.city === "Butwal" ? pick(["Residential", "Agricultural"]) : "Residential") : "Residential";
  const x = CITY_X[loc.city] || 0.7;
  const aana = type === "Land" ? int(4, 16) : type === "Apartment" || type === "Flat" || commercial ? 0 : int(3, 8);
  const beds = type === "Land" || commercial ? 0 : type === "Flat" ? int(1, 3) : type === "Apartment" ? int(2, 4) : int(3, 6);
  const sqft = commercial ? r5(int(600, 3500), 50) : type === "Flat" || type === "Apartment" ? r5(beds * int(380, 520), 10) : type === "Land" ? null : r5(int(1600, 4200), 50);
  let price;
  if (isRent) price = r5((type === "Flat" ? int(14, 40) : type === "Apartment" ? int(30, 90) : type === "House" ? int(40, 160) : sqft * int(60, 120) / 1000) * 1000 * x, 1000);
  else if (type === "Land") { const [lo, hi] = LAND_LAKH[loc.city] || [10, 30]; price = r5(aana * int(lo, hi) * 1e5, 1e5); }
  else if (type === "Apartment") price = r5(int(85, 260) * 1e5 * x, 1e5);
  else if (commercial) price = r5(sqft * int(18, 35) * 1000 * x, 1e5);
  else price = r5((aana * int(30, 60) * 1e5 + int(60, 160) * 1e5) * x, 1e5);
  const sold = rnd() < 0.12;
  const fmtSq = (n) => n.toLocaleString("en-IN");
  const name = type === "Land" ? `${aana} Aana ${category} Land for Sale in ${loc.locality}`
    : commercial ? `${fmtSq(sqft)} sq ft ${type} ${isRent ? "for Rent" : "for Sale"} in ${loc.locality}`
    : `${beds} BHK ${type} ${isRent ? "for Rent" : "for Sale"} in ${loc.locality}`;
  const local = agents.filter((a) => a.cities.includes(loc.city));
  const agent = pick(local.length ? local : agents);
  agent.listings_count++;
  const feature = IMAGES[i % IMAGES.length];
  const posted = int(0, 120);
  return {
    id: i + 1,
    property_code: `SP${String(1000 + i)}`,
    url: `${slug(name)}-${i + 1}`,
    name,
    title: name,
    purpose,
    advertisement_purpose: purpose.toLowerCase(),
    property_type: type,
    property_category: category,
    propertycategory: category,
    property_status: sold ? (isRent ? "RENTED OUT" : "SOLD OUT") : "AVAILABLE",
    sold: sold ? 1 : 0,
    total_price: price,
    price,
    rent_per_month: isRent ? price : null,
    price_negotiable: rnd() < 0.6,
    property_location: `${loc.locality}, ${loc.city}`,
    locality: loc.locality,
    city: loc.city,
    district: loc.district,
    province: loc.province,
    latitude: loc.lat + (rnd() - 0.5) * 0.02,
    longitude: loc.lng + (rnd() - 0.5) * 0.02,
    property_area: aana ? `${aana} Aana` : `${fmtSq(sqft)} sq ft`,
    built_up_area: sqft ? `${fmtSq(sqft)} sq.ft` : null,
    road_access: `${pick([10, 13, 16, 20, 24])} ft`,
    facing: pick(["East", "West", "North", "South", "North-East"]),
    bedroom: beds,
    bathroom: beds ? Math.max(1, beds - 1) : commercial ? int(1, 2) : 0,
    kitchen: beds ? 1 : 0,
    living_room: beds ? 1 : 0,
    floors: type === "Land" ? 0 : type === "Flat" || type === "Apartment" ? int(2, 12) : commercial ? int(1, 5) : int(2, 4),
    built_year: type === "Land" ? null : int(2008, 2025),
    furnishing: type === "Land" ? null : pick(["Furnished", "Semi-Furnished", "Unfurnished"]),
    parking: type === "Land" ? null : `${int(1, 3)} car, ${int(1, 4)} bike`,
    amenities: type === "Land" ? [] : AMENITIES.filter((m) => (type === "House" || type === "Bungalow") && m === "lift" ? false : rnd() < 0.45),
    feature_image: feature,
    gallery_images: [1, 2, 3, 4].map((k) => ({ image: IMAGES[(i + k * 5) % IMAGES.length] })),
    youtube_url: i % 5 === 0 ? "https://www.youtube.com/watch?v=ysz5S6PUM-U" : null,
    property_description: `<p>${type === "Land" ? `${aana} aana of ${category.toLowerCase()} land` : commercial ? `${fmtSq(sqft)} sq ft of ${type.toLowerCase()}` : `A ${beds} bedroom ${type.toLowerCase()}`} in ${loc.locality}, ${loc.city}, with ${pick(["easy access to the ring road", "a quiet residential neighbourhood", "schools and hospitals nearby", "mountain views on clear days"])}. ${type === "Land" ? "Lal purja and trace map are ready" : "Lal purja and approved naksa are ready"}, and documents can be seen at the office.</p>`,
    other_description: `<p>${commercial ? "Three-phase power and separate meter." : "Water from both municipal line and boring."} ${pick(["Morning sun on the front side.", "Corner plot with two-side road access.", "Close to the main market."])}</p>`,
    property_highlights: `<ul><li>${pick(["Peaceful neighbourhood", "Prime location", "Ready to move"])}</li><li>${pick(["Black-topped road", "Near public transport", "Clear ownership documents"])}</li><li>${isRent ? pick(["Two months deposit", "Available from next month", "Owner lives nearby"]) : pick(["Bank loan available", "Price slightly negotiable", "Owner direct"])}</li></ul>`,
    is_featured: i % 4 === 0,
    views: int(40, 2400),
    posted_by: agent.name,
    posted_date: daysAgo(posted).slice(0, 10),
    created_at: daysAgo(posted),
    agent_id: agent.id,
    user_id: agent.id,
  };
}

function makeBlogs() {
  const cats = [
    { id: 1, name: "Buying Guide", slug: "buying-guide" },
    { id: 2, name: "Market Trends", slug: "market-trends" },
    { id: 3, name: "Legal", slug: "legal" },
    { id: 4, name: "Home Loans", slug: "home-loans" },
  ];
  const titles = [
    "How to verify a lal purja before you buy land",
    "Kathmandu land prices in 2026: what changed",
    "Home loan interest rates across Nepali banks",
    "Renting in Lalitpur: a checklist for tenants",
    "What is blue print approval and why it matters",
    "Five neighbourhoods to watch in the valley",
    "Joint ownership and tax rebates for women buyers",
    "Pokhara Lakeside: is it still a good investment?",
  ];
  const posts = titles.map((t, i) => ({
    id: i + 1,
    title: t,
    slug: slug(t),
    excerpt: "A short guide for buyers, sellers and renters in Nepal, written by the Sheetal Property team.",
    content: `<p>${t}. This is sample article content for local testing. It explains the process step by step and links to the relevant government offices.</p><h2>Key points</h2><ul><li>Check documents at the Malpot office</li><li>Confirm road access on the map</li><li>Ask for the latest tax receipt</li></ul>`,
    thumbnail: IMAGES[(i * 3) % IMAGES.length],
    featured_image: IMAGES[(i * 3) % IMAGES.length],
    image: IMAGES[(i * 3) % IMAGES.length],
    category: cats[i % cats.length],
    tags: [{ id: 1, name: "Nepal", slug: "nepal" }, { id: 2, name: cats[i % 4].name, slug: cats[i % 4].slug }],
    author: { name: "Sheetal Property", photo: "/shetallogo.png" },
    is_featured: i < 3,
    views: int(120, 4000),
    read_time: int(3, 9),
    published_at: daysAgo(i * 9 + 2),
    created_at: daysAgo(i * 9 + 2),
    comments: [],
  }));
  return { cats, posts };
}

function makeJobs() {
  return [
    ["Sales Executive", "Kathmandu", "Full-time", "Sales"],
    ["Property Photographer", "Lalitpur", "Part-time", "Marketing"],
    ["Frontend Developer (React)", "Kathmandu", "Full-time", "Technology"],
    ["Field Surveyor", "Bhaktapur", "Contract", "Operations"],
  ].map(([title, location, type, department], i) => ({
    id: i + 1, title, slug: slug(title), location, type, job_type: type, department,
    salary: `Rs. ${int(30, 90)}K - ${int(95, 150)}K`, experience: `${int(1, 4)}+ years`,
    deadline: daysAgo(-int(10, 40)).slice(0, 10),
    description: `<p>We are hiring a ${title} to join the Sheetal Property team in ${location}.</p>`,
    requirements: "<ul><li>Good communication in Nepali and English</li><li>Relevant experience</li></ul>",
    created_at: daysAgo(int(1, 20)),
  }));
}

function makeReviews(properties, agents) {
  const lines = ["Very helpful and honest.", "Documents were clear, smooth process.", "Quick response on WhatsApp.", "Good location, price was fair.", "Visited twice, the agency team was patient."];
  const out = [];
  let id = 1;
  properties.slice(0, 30).forEach((p) => {
    for (let k = 0; k < int(0, 3); k++) out.push({ id: id++, type: "property", property_id: p.id, rating: int(3, 5), comment: pick(lines), user: { name: `${pick(FIRST)} ${pick(LAST)}`, photo: null }, created_at: daysAgo(int(1, 90)) });
  });
  agents.forEach((a) => {
    for (let k = 0; k < int(2, 5); k++) out.push({ id: id++, type: "agent", agent_id: a.id, rating: int(4, 5), comment: pick(lines), user: { name: `${pick(FIRST)} ${pick(LAST)}`, photo: null }, created_at: daysAgo(int(1, 120)) });
  });
  return out;
}

function build() {
  const agents = makeAgents();
  const properties = Array.from({ length: 72 }, (_, i) => makeProperty(i, agents));
  const { cats, posts } = makeBlogs();
  return {
    agents,
    properties,
    blogCategories: cats,
    blogs: posts,
    jobs: makeJobs(),
    reviews: makeReviews(properties, agents),
    banners: [
      { id: 1, media_type: "image", url: "/demo/12.jpg", title: "Find your next home in Nepal", object_position: 50 },
      { id: 2, media_type: "image", url: "/demo/15.jpg", title: "Land and houses across Nepal", object_position: 50 },
      { id: 3, media_type: "image", url: "/demo/17.jpg", title: "Rent, buy or invest", object_position: 50 },
    ],
    demands: Array.from({ length: 14 }, (_, i) => {
      const loc = pick(LOCATIONS);
      const purpose = pick(["Buy", "Rent", "Buy"]);
      const budget = purpose === "Rent" ? int(15, 120) * 1000 : int(20, 400) * 1e5;
      return { id: i + 1, name: `${pick(FIRST)} ${pick(LAST)}`, purpose, tenant_option: purpose, property_type: pick(PROPERTY_TYPES), location: `${loc.locality}, ${loc.city}`, prefered_location: `${loc.locality}, ${loc.city}`, budget, maximum_budget: budget, vehicles: pick(["Car", "Bike", "Car & Bike", "None"]), facilities: AMENITIES.filter(() => rnd() < 0.3).map((a) => a.replace(/_/g, " ")), requirement: pick(["Near school", "Road access 13 ft+", "Parking needed", "Ready to move"]), description: pick(["Family of four, moving next month.", "Need quiet area with water supply.", "Looking for long-term lease.", "Cash buyer, quick decision."]), created_at: daysAgo(int(1, 60)) };
    }),
    // demo login: demo@sheetal.test / password
    users: [{ id: 1, first_name: "Aarav", last_name: "Shrestha", user_name: "Aarav Shrestha", email: "demo@sheetal.test", password: "password", phone: "9841000000", photo: null, role: "agent", plan: "Pro", email_verified: true, address: "Baneshwor, Kathmandu", company_name: "Sheetal Property", agency_id: 4 }],
    favourites: [{ user_id: 1, property_id: 3 }, { user_id: 1, property_id: 8 }],
    notifications: [
      { id: 1, title: "New inquiry", message: "Someone asked about your house in Baneshwor.", read: false, created_at: daysAgo(0) },
      { id: 2, title: "Tour scheduled", message: "A visit is booked for Saturday 11:00 AM.", read: false, created_at: daysAgo(1) },
      { id: 3, title: "Listing approved", message: "Your land in Tokha is now live.", read: true, created_at: daysAgo(4) },
    ],
    inquiries: [],
    tours: [],
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && saved.properties) return saved;
  } catch {}
  return build();
}

export const db = load();
export const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(db));
export const resetDb = () => { localStorage.removeItem(STORE_KEY); window.location.reload(); };
if (typeof window !== "undefined") window.resetDemoData = resetDb;
