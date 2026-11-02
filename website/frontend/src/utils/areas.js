// Area-level location data for the map. Properties are grouped by province → district → locality,
// and the map never shows an exact address (only an approximate area).
export const PROVINCES = {
  Koshi: { c: [27.0, 87.3], d: "Taplejung Panchthar Ilam Jhapa Morang Sunsari Dhankuta Terhathum Sankhuwasabha Bhojpur Solukhumbu Okhaldhunga Khotang Udayapur" },
  Madhesh: { c: [26.85, 85.8], d: "Saptari Siraha Dhanusha Mahottari Sarlahi Rautahat Bara Parsa" },
  Bagmati: { c: [27.6, 85.4], d: "Dolakha Sindhupalchok Rasuwa Dhading Nuwakot Kathmandu Bhaktapur Lalitpur Kavrepalanchok Ramechhap Sindhuli Makwanpur Chitwan" },
  Gandaki: { c: [28.3, 84.0], d: "Gorkha Manang Mustang Myagdi Kaski Lamjung Tanahun Nawalpur Syangja Parbat Baglung" },
  Lumbini: { c: [27.9, 82.9], d: "Rolpa Pyuthan Gulmi Arghakhanchi Palpa Parasi Rupandehi Kapilvastu Dang Banke Bardiya RukumEast" },
  Karnali: { c: [29.0, 82.0], d: "Dolpa Mugu Humla Jumla Kalikot Dailekh Jajarkot RukumWest Salyan Surkhet" },
  Sudurpashchim: { c: [29.2, 80.8], d: "Bajura Bajhang Achham Doti Kailali Kanchanpur Dadeldhura Baitadi Darchula" },
};
const D2P = {};
Object.entries(PROVINCES).forEach(([p, v]) => v.d.split(" ").forEach((d) => (D2P[d.toLowerCase()] = p)));

// Common city / alternate names → district
const ALIAS = {
  kavre: "kavrepalanchok", kavrepalanchowk: "kavrepalanchok", banepa: "kavrepalanchok", dhulikhel: "kavrepalanchok", panauti: "kavrepalanchok",
  patan: "lalitpur", pokhara: "kaski", butwal: "rupandehi", bhairahawa: "rupandehi", siddharthanagar: "rupandehi", bharatpur: "chitwan", narayangarh: "chitwan",
  biratnagar: "morang", birgunj: "parsa", dharan: "sunsari", itahari: "sunsari", hetauda: "makwanpur", nepalgunj: "banke", dhangadhi: "kailali",
  janakpur: "dhanusha", damak: "jhapa", birtamod: "jhapa", tulsipur: "dang", ghorahi: "dang", mahendranagar: "kanchanpur", gorkha: "gorkha",
  sindhupalchowk: "sindhupalchok", makawanpur: "makwanpur", kapilbastu: "kapilvastu", nawalparasi: "nawalpur", tanahu: "tanahun", dhanusa: "dhanusha",
};

// well-known towns / toles → district (so text-only locations still land in the right outline)
const PLACE = {
  kathmandu: "gangabu samakhusi machhapokhari baneshwor koteshwor kalanki balaju bansbari budhanilkantha budhanilkanta maharajgunj maharajganj lazimpat naxal baluwatar thamel kapan tokha gongabu samakhushi basundhara chabahil boudha bouddha jorpati gokarna sankhu tinkune sinamangal battisputali gaushala kamalpokhari dillibazar putalisadak baneshwar new-baneshwor old-baneshwor anamnagar babarmahal tripureshwor kalimati swayambhu sitapaila thankot kirtipur chandragiri dhapasi golfutar hattigauda chapali bhangal mandikhatar tusal sukedhara narayan-gopal-chowk chakrapath sanepa-chowk nagarjun ramkot dallu bafal kuleshwor teku sundhara chhauni chhetrapati kalopul mitrapark pepsicola tarkeshwor jitpur gothatar mulpani sundarijal nayabazar banasthali dhumbarahi chandol bishalnagar handigaun hadigaun gairidhara tangal maitidevi sorakhutte paknajol kamaladi bagbazar ghattekulo shantinagar thapagaun mid-baneshwor buddhanagar thapathali bijulibazar sinamangal tilganga sallaghari",
  lalitpur: "jawalakhel pulchowk kupondole sanepa jhamsikhel lagankhel satdobato imadol hattiban nakhu bhaisepati khumaltar godawari harisiddhi thecho chapagaun tikathali gwarko balkumari dhobighat ekantakuna kusunti mangalbazar patan bungamati khokana sunakothi dhapakhel thaiba lubhu bhainsepati nakkhu",
  bhaktapur: "suryabinayak thimi madhyapur sallaghari kausaltar lokanthali jagati kamalbinayak changunarayan nagarkot dadhikot gundu sipadol",
  kaski: "lakeside damside chipledhunga mahendrapool prithvichowk bagar newroad-pokhara hemja lekhnath",
};
// tole → municipality (local level). Valley + Pokhara; elsewhere the municipality is read from the text when written.
const MUNI = {
  "Kathmandu Metropolitan City": "gangabu gongabu samakhusi machhapokhari balaju-chowk naya-buspark baneshwor koteshwor kalanki balaju lazimpat naxal baluwatar thamel maharajgunj maharajganj chabahil boudha bouddha battisputali gaushala kamalpokhari dillibazar putalisadak anamnagar babarmahal tripureshwor kalimati swayambhu sinamangal tinkune new baneshwor old baneshwor mid baneshwor buddhanagar thapathali bijulibazar shantinagar kamaladi bagbazar ghattekulo maitidevi paknajol sorakhutte handigaun hadigaun gairidhara tangal dhumbarahi chandol bishalnagar basundhara samakhushi gongabu bansbari mandikhatar narayan gopal chowk chakrapath kuleshwor teku sundhara chhauni chhetrapati kalopul mitrapark pepsicola banasthali nayabazar tilganga thapagaun bafal dallu sitapaila",
  "Budhanilkantha Municipality": "budhanilkantha budhanilkanta golfutar hattigauda chapali bhangal narayanthan tusal",
  "Tokha Municipality": "tokha dhapasi jhor sangla grande",
  "Tarakeshwar Municipality": "tarakeshwor tarakeshwar manamaiju kavresthali",
  "Gokarneshwor Municipality": "gokarna jorpati sundarijal nayapati",
  "Kageshwori-Manohara Municipality": "kapan mulpani gothatar danchhi thali",
  "Nagarjun Municipality": "nagarjun ramkot ichangu",
  "Chandragiri Municipality": "chandragiri thankot naikap satungal balambu",
  "Kirtipur Municipality": "kirtipur panga",
  "Dakshinkali Municipality": "dakshinkali pharping",
  "Shankharapur Municipality": "sankhu shankharapur",
  "Lalitpur Metropolitan City": "jawalakhel pulchowk kupondole sanepa jhamsikhel lagankhel satdobato imadol hattiban nakhu nakkhu khumaltar gwarko balkumari dhobighat ekantakuna kusunti mangalbazar patan bhaisepati bhainsepati",
  "Godawari Municipality": "godawari harisiddhi thecho chapagaun badikhel",
  "Mahalaxmi Municipality": "tikathali lubhu imadol-mahalaxmi siddhipur",
  "Konjyosom Rural Municipality": "konjyosom",
  "Bagmati Rural Municipality": "bagmati-lalitpur",
  "Mahankal Rural Municipality": "mahankal",
  "Bhaktapur Municipality": "bhaktapur durbar",
  "Madhyapur Thimi Municipality": "thimi madhyapur sallaghari kausaltar lokanthali",
  "Suryabinayak Municipality": "suryabinayak jagati gundu sipadol",
  "Changunarayan Municipality": "changunarayan duwakot",
  "Pokhara Metropolitan City": "pokhara lakeside damside chipledhunga mahendrapool prithvichowk bagar lekhnath hemja",
};
const T2M = {};
Object.entries(MUNI).forEach(([mu, s]) => s.split(" ").forEach((x) => (T2M[x.replace(/-/g, " ")] = mu)));
const MUNI_WORD = /([a-z]+(?:[ -][a-z]+)?)\s+(metropolitan city|sub[- ]metropolitan city|rural municipality|municipality|nagarpalika|gaunpalika|mahanagarpalika|upamahanagarpalika)/;

// all 753 local levels (metro / sub-metro / municipality / rural municipality) for all 77 districts.
// Source: nepali-canonical (CC BY 4.0) — loaded once, cached in the browser.
const LL_URL = "https://cdn.jsdelivr.net/gh/ritushishir/nepali-canonical@main/name-of-places/municipalities.json";
const LL_KEY = "np_local_levels_v1";
let LL = null; // name(lowercase) -> [{ name, type, district, province }]
const buildLL = (data) => {
  const idx = {};
  Object.values(data || {}).forEach((pv) => (pv.districts || []).forEach((d) => {
    const dist = String(d.district_name_english || "").trim();
    const dk = dist.toLowerCase().replace(/\s+/g, "");
    if (dk && !D2P[dk]) D2P[dk] = pv.province_name_english; // fills any district spelling we were missing
    (d.municipalities || []).forEach((m) => {
      const nm = String(m.municipality_name_english || "").trim(); if (!nm) return;
      const k = nm.toLowerCase().replace(/-/g, " ");
      (idx[k] = idx[k] || []).push({ name: nm, type: m.type, district: dist, province: pv.province_name_english });
    });
  }));
  return idx;
};
export async function loadLocalLevels() {
  if (LL) return LL;
  try { const c = localStorage.getItem(LL_KEY); if (c) { LL = buildLL(JSON.parse(c)); return LL; } } catch {}
  try { const r = await fetch(LL_URL); const j = await r.json(); try { localStorage.setItem(LL_KEY, JSON.stringify(j)); } catch {} LL = buildLL(j); } catch { LL = {}; }
  return LL;
}
const muniLabel = (m) => `${m.name} ${m.type || "Municipality"}`;

const P2D = {};
Object.entries(PLACE).forEach(([d, s]) => s.split(" ").forEach((x) => (P2D[x.replace(/-/g, " ")] = d)));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z\s,]/g, " ").replace(/\s+/g, " ").trim();

export const cap = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());

export function areaOf(p) {
  const parts = String(p.property_location || p.location || p.address || "").split(",").map((x) => x.trim()).filter(Boolean);
  // tole: many listings only say "Kathmandu" / "Lalitpur" (a city or district) in property_location — then take the
  // real tole from the other fields: tol / town, the map address ("Naxal, Kathmandu 44600"), or the title ("… at Naxal")
  const BIG = /^(kathmandu|lalitpur|bhaktapur|pokhara|kaski|nepal|bagmati|bagmati province|ktm|patan)$/i;
  const clean = (s) => String(s || "").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\b\d{5}\b/g, "").replace(/\s+/g, " ").trim();
  const firstReal = (...xs) => { for (const x of xs) { const v = clean(x); if (v && !BIG.test(v) && !/^[A-Z0-9]{4}\+[A-Z0-9]{2,3}/i.test(String(x)) && !/\b(marga?|road|sadak|path|highway|street|chowk road)\b/i.test(v)) return v; } return ""; };
  const fromTitle = (String(p.name || p.title || "").match(/\b(?:at|in|on)\s+([A-Za-z][A-Za-z ]{2,30}?)(?:\s*(?:,|for|near|\(|-|$))/i) || [])[1];
  const locParts = String(p.location || "").split(",").map((x) => x.trim());
  const locality = cap(firstReal(p.locality, p.tole, p.tol, parts[0], p.town, locParts[0], locParts[1], fromTitle) || parts[0] || "");
  let dist = String(p.district || p.city || parts[parts.length - 1] || "").trim().toLowerCase();
  dist = ALIAS[dist] || dist;
  if (!D2P[dist]) {
    // look through every text field the poster filled in: district names, aliases, then known toles
    const hay = norm([p.district, p.city, p.municipality, p.property_location, p.location, p.address, p.locality, p.tole, p.title, p.property_title].filter(Boolean).join(", "));
    const words = hay.split(/[ ,]+/).filter(Boolean);
    const grams = [...words, ...words.slice(1).map((w, i) => words[i] + " " + w)];
    const hit = grams.map((x) => ALIAS[x] || x).find((x) => D2P[x]) || grams.map((x) => P2D[x]).find(Boolean);
    if (hit) dist = hit;
  }
  const province = D2P[dist] || "";
  // municipality: known tole → municipality, or written in the text ("Tokha Municipality", "… Nagarpalika")
  const all = norm([p.municipality, p.local_level, p.property_location, p.location, p.address, p.locality, p.tole, p.city].filter(Boolean).join(", "));
  let municipality = "";
  const m = all.match(MUNI_WORD);
  if (m) municipality = cap(m[1]) + " " + (/metro/.test(m[2]) ? (/sub/.test(m[2]) ? "Sub-Metropolitan City" : "Metropolitan City") : /rural|gaun/.test(m[2]) ? "Rural Municipality" : "Municipality");
  const ws = all.split(/[ ,]+/).filter(Boolean);
  const gs = [...ws.slice(2).map((w, i) => ws[i] + " " + ws[i + 1] + " " + w), ...ws.slice(1).map((w, i) => ws[i] + " " + w), ...ws];
  if (!municipality) municipality = gs.map((x) => T2M[x]).find(Boolean) || "";
  let district = cap(dist) || "", prov = province;
  // any of the 753 local levels written in the text (skip names identical to the district, e.g. "Kathmandu", unless typed as "… Metropolitan")
  if (!municipality && LL) {
    for (const g of gs) {
      const hits = LL[g]; if (!hits) continue;
      const pick = hits.find((h) => h.district.toLowerCase() === dist) || (hits.length === 1 ? hits[0] : null);
      if (!pick || pick.name.toLowerCase() === pick.district.toLowerCase()) continue;
      municipality = muniLabel(pick);
      if (!prov) { district = pick.district; prov = pick.province; }
      break;
    }
  }
  return { province: prov, district, municipality, locality: locality || district };
}
