// Listing options: every choice a listing form can offer (kinds, categories, facilities, areas and units).
// Where it fits: the listing wizard, filters and the website's listing pages.
// How it works: each item is { id, en, ne, icon }; land areas convert between ropani-aana and bigha-kattha and sq ft.
// Rules: these are the built-in options. Admin → Listing setup saves changes on the server, and the panels lay them
// over this list with mergeCatalog() (the server sends only the lists staff changed).

const o = (id, en, ne, icon) => ({ id, en, ne, icon });

export const CATALOG = {
  listingKinds: [
    o("sell", "Sell a property", "सम्पत्ति बेच्ने", "tag"),
    o("rentout", "Rent out", "भाडामा दिने", "key-round"),
    o("stay_hotel", "Hotel or resort rooms", "होटल वा रिसोर्टका कोठा", "hotel"),
    o("stay_unit", "Villa, apartment, homestay or hostel", "भिला, अपार्टमेन्ट, होमस्टे वा होस्टल", "house"),
    o("project", "Building or colony project", "भवन वा कोलोनी परियोजना", "building-2"),
    o("invest", "Investment opportunity", "लगानी अवसर", "hand-coins"),
  ],
  // Which business type may create which listing kinds (Pro plans can create every kind)
  kindsByType: {
    agency: ["sell", "rentout"], owner: ["sell", "rentout"], hotel: ["stay_hotel", "stay_unit"],
    host: ["stay_unit"], developer: ["project", "sell"], sponsor: ["invest"],
  },

  categories: [
    o("house", "House", "घर", "house"),
    o("apartment", "Apartment", "अपार्टमेन्ट", "building"),
    o("land", "Land", "जग्गा", "map"),
    o("commercial", "Commercial", "व्यावसायिक", "store"),
  ],
  propertyTypes: {
    house: [o("bungalow", "Bungalow", "बंगला", "house"), o("residential_house", "Residential house", "आवासीय घर", "house"), o("duplex", "Duplex", "डुप्लेक्स", "house-plus"), o("newari", "Traditional Newari house", "परम्परागत नेवारी घर", "landmark"), o("villa", "Villa", "भिला", "trees")],
    apartment: [o("flat", "Flat", "फ्ल्याट", "building"), o("apartment_unit", "Apartment unit", "अपार्टमेन्ट युनिट", "building-2"), o("penthouse", "Penthouse", "पेन्टहाउस", "crown"), o("studio", "Studio", "स्टुडियो", "door-open")],
    land: [o("residential_plot", "Residential plot", "आवासीय घडेरी", "map-pin"), o("agricultural", "Agricultural land", "कृषि जग्गा", "sprout"), o("commercial_plot", "Commercial plot", "व्यावसायिक जग्गा", "map")],
    commercial: [o("office", "Office space", "कार्यालय", "briefcase"), o("shop", "Shop space", "पसल", "store"), o("shutter", "Shutter", "सटर", "warehouse"), o("warehouse", "Warehouse", "गोदाम", "warehouse"), o("hotel_building", "Hotel building", "होटल भवन", "hotel"), o("whole_building", "Whole building", "पूरै भवन", "building-2")],
  },
  classTypes: [o("residential", "Residential", "आवासीय", "house"), o("commercial_area", "Commercial area", "व्यावसायिक क्षेत्र", "store"), o("mixed", "Mixed", "मिश्रित", "layers")],
  facilities: [
    o("water", "Water supply", "खानेपानी", "droplets"), o("electricity", "Electricity", "बिजुली", "zap"), o("internet", "Internet", "इन्टरनेट", "wifi"),
    o("parking", "Parking", "पार्किङ", "car"), o("garden", "Garden", "बगैंचा", "flower-2"), o("waste", "Waste management", "फोहोर व्यवस्थापन", "trash-2"),
    o("cable_tv", "Cable TV", "केबल टिभी", "tv"), o("landline", "Land line phone", "ल्यान्डलाइन फोन", "phone"), o("solar", "Solar", "सोलार", "sun"),
    o("backup", "Power backup", "पावर ब्याकअप", "battery-charging"), o("lift", "Lift", "लिफ्ट", "arrow-up-down"), o("security", "Security guard", "सुरक्षा गार्ड", "shield"),
    o("cctv", "CCTV", "सिसिटिभी", "cctv"), o("modular_kitchen", "Modular kitchen", "मोड्युलर भान्सा", "cooking-pot"), o("balcony", "Balcony", "बार्दली", "fence"),
    o("ac", "Air conditioning", "एसी", "air-vent"), o("gym", "Gym", "जिम", "dumbbell"), o("pool", "Swimming pool", "स्विमिङ पुल", "waves"),
  ],
  nearby: [
    o("transport", "Public transport", "सार्वजनिक यातायात", "bus"), o("public_parking", "Public parking", "सार्वजनिक पार्किङ", "square-parking"), o("school", "School", "विद्यालय", "school"),
    o("hospital", "Hospital", "अस्पताल", "hospital"), o("temple", "Temple", "मन्दिर", "landmark"), o("shop", "Shop", "पसल", "store"),
    o("department_store", "Department store", "डिपार्टमेन्ट स्टोर", "shopping-bag"), o("bank", "Bank", "बैंक", "landmark"), o("ring_road", "Ring road", "रिङ रोड", "route"),
  ],
  environments: [
    o("open", "Open environment", "खुला वातावरण", "trees"), o("quiet", "Quiet surrounding", "शान्त परिवेश", "volume-x"), o("neighbourhood", "Good neighbourhood", "राम्रो छिमेक", "users"),
    o("secure", "Good security", "राम्रो सुरक्षा", "shield-check"), o("natural", "Natural environment", "प्राकृतिक वातावरण", "leaf"), o("high_commercial", "Highly commercial area", "उच्च व्यावसायिक क्षेत्र", "building-2"),
    o("developing", "Developing commercial area", "विकासशील व्यावसायिक क्षेत्र", "construction"),
  ],
  exteriorLooks: [
    o("traditional", "Traditional Nepali house", "परम्परागत नेपाली घर", "landmark"), o("modern", "Modern house", "आधुनिक घर", "house"), o("semi_modern", "Semi-modern house", "अर्ध-आधुनिक घर", "house"),
    o("european", "European style", "युरोपेली शैली", "castle"), o("pillar", "Pillar system", "पिलर सिस्टम", "columns-3"), o("wall", "Wall system", "वाल सिस्टम", "brick-wall"), o("basement", "Basement", "बेसमेन्ट", "arrow-down-to-line"),
  ],
  furnishing: [
    o("full", "Fully furnished", "पूर्ण फर्निस्ड", "sofa"), o("semi", "Semi furnished", "अर्ध फर्निस्ड", "armchair"), o("none", "Not furnished", "फर्निस्ड नभएको", "square"),
  ],
  interiorLooks: [
    o("ready", "Ready to move", "सिधै बस्न मिल्ने", "circle-check"), o("open_spaces", "Open spaces", "खुला ठाउँ", "maximize"), o("putty", "Wall putty done", "वाल पुटिङ", "paint-roller"), o("colouring", "Internal colouring", "भित्री रंग", "palette"),
  ],
  facing: [
    o("east", "East", "पूर्व", "compass"), o("west", "West", "पश्चिम", "compass"), o("north", "North", "उत्तर", "compass"), o("south", "South", "दक्षिण", "compass"),
    o("east_south", "South-east", "दक्षिण-पूर्व", "compass"), o("east_north", "North-east", "उत्तर-पूर्व", "compass"), o("west_north", "North-west", "उत्तर-पश्चिम", "compass"), o("west_south", "South-west", "दक्षिण-पश्चिम", "compass"),
  ],
  propertyStatus: [
    o("self", "Self using", "आफैं प्रयोग", "house"), o("rented", "Rented", "भाडामा", "key-round"), o("leased", "Leased", "लिजमा", "file-text"), o("self_rented", "Self using and rented", "आफैं र भाडामा", "users"),
    o("locked", "Locked", "बन्द", "lock"), o("open_status", "Open", "खुला", "lock-open"), o("planting", "Planting", "खेती भइरहेको", "sprout"), o("non_planting", "Not planting", "खेती नगरिएको", "square"),
  ],
  roadWidth: [o("lt8", "Under 8 ft", "८ फिटभन्दा कम", "route"), o("8_12", "8–12 ft", "८–१२ फिट", "route"), o("13_20", "13–20 ft", "१३–२० फिट", "route"), o("gt20", "Over 20 ft", "२० फिटभन्दा बढी", "route")],
  roadType: [o("blacktop", "Blacktopped", "कालोपत्रे", "route"), o("concrete", "Concrete", "ढलान", "route"), o("gravel", "Gravel", "ग्राभेल", "route"), o("earthen", "Earthen", "कच्ची", "route")],
  ownershipDocs: [o("lalpurja", "Lalpurja (ownership)", "लालपुर्जा", "file-badge"), o("guthi", "Guthi", "गुठी", "landmark"), o("mohi", "Tenancy (mohi)", "मोही", "users"), o("company", "Company owned", "कम्पनीको नाममा", "building-2")],
  ownerTypes: [o("owner", "Owner", "घरधनी", "user"), o("agent", "Agent", "एजेन्ट", "briefcase"), o("developer", "Developer", "डेभलपर", "building-2"), o("bank", "Bank auction", "बैंक लिलाम", "landmark")],
  urgency: [o("normal", "Normal", "सामान्य", "clock"), o("urgent", "Urgent", "अत्यावश्यक", "circle-alert"), o("very_urgent", "Very urgent", "धेरै अत्यावश्यक", "zap")],
  boosts: [
    o("self", "Self promotion", "आफैं प्रचार", "megaphone"), o("featured", "Featured", "फिचर्ड", "star"), o("home1", "Home page, first row", "गृहपृष्ठ पहिलो पङ्क्ति", "layout-grid"),
    o("home2", "Home page, second row", "गृहपृष्ठ दोस्रो पङ्क्ति", "layout-grid"), o("online", "Online marketing", "अनलाइन मार्केटिङ", "megaphone"),
  ],
  leaseTerms: [o("m6", "6 months", "६ महिना", "calendar-days"), o("y1", "1 year", "१ वर्ष", "calendar-days"), o("y2", "2 years", "२ वर्ष", "calendar-days"), o("y3plus", "3 years or more", "३ वर्ष वा बढी", "calendar-days")],
  deposits: [o("d1", "1 month", "१ महिना", "wallet"), o("d2", "2 months", "२ महिना", "wallet"), o("d3", "3 months", "३ महिना", "wallet"), o("d0", "No deposit", "धरौटी छैन", "wallet")],
  tenants: [o("family", "Family", "परिवार", "users"), o("bachelor", "Bachelors", "अविवाहित", "user"), o("students", "Students", "विद्यार्थी", "graduation-cap"), o("office", "Office use", "कार्यालय प्रयोग", "briefcase"), o("foreigners", "Foreigners", "विदेशी", "globe")],
  utilities: [o("water", "Water", "पानी", "droplets"), o("electricity", "Electricity", "बिजुली", "zap"), o("internet", "Internet", "इन्टरनेट", "wifi"), o("maintenance", "Maintenance", "मर्मत", "wrench"), o("parking", "Parking", "पार्किङ", "car")],

  // Stays
  stayTypesHotel: [o("hotel", "Hotel", "होटल", "hotel"), o("resort", "Resort", "रिसोर्ट", "trees"), o("boutique", "Boutique hotel", "बुटिक होटल", "gem"), o("lodge", "Lodge", "लज", "tent-tree"), o("guest_house", "Guest house", "गेस्ट हाउस", "house")],
  stayTypesUnit: [o("villa", "Villa", "भिला", "trees"), o("apartment", "Apartment", "अपार्टमेन्ट", "building"), o("homestay", "Homestay", "होमस्टे", "heart-handshake"), o("cottage", "Cottage", "कटेज", "tent-tree"), o("hostel", "Hostel", "होस्टल", "bed-double")],
  stars: [o("s0", "Not rated", "मूल्याङ्कन छैन", "star-off"), o("s1", "1 star", "१ तारा", "star"), o("s2", "2 star", "२ तारा", "star"), o("s3", "3 star", "३ तारा", "star"), o("s4", "4 star", "४ तारा", "star"), o("s5", "5 star", "५ तारा", "star")],
  roomTypes: [o("standard", "Standard", "स्ट्यान्डर्ड", "bed-single"), o("deluxe", "Deluxe", "डिलक्स", "bed-double"), o("suite", "Suite", "सुइट", "crown"), o("family", "Family room", "पारिवारिक कोठा", "users"), o("dorm", "Dorm bed", "डर्म बेड", "bed-single")],
  bedTypes: [o("king", "King", "किङ", "bed-double"), o("queen", "Queen", "क्विन", "bed-double"), o("twin", "Twin", "ट्विन", "bed-single"), o("single", "Single", "सिंगल", "bed-single"), o("bunk", "Bunk", "बङ्क", "bed-single")],
  stayAmenities: [
    o("breakfast", "Free breakfast", "निःशुल्क बिहानको खाना", "coffee"), o("wifi", "Wi-Fi", "वाइफाइ", "wifi"), o("parking", "Parking", "पार्किङ", "car"), o("pool", "Pool", "पुल", "waves"),
    o("hot_water", "Hot water", "तातो पानी", "flame"), o("heater", "Heater", "हिटर", "heater"), o("ac", "Air conditioning", "एसी", "air-vent"), o("backup", "Power backup", "पावर ब्याकअप", "battery-charging"),
    o("restaurant", "Restaurant", "रेस्टुरेन्ट", "utensils"), o("bar", "Bar", "बार", "wine"), o("room_service", "Room service", "रुम सर्भिस", "bell-ring"), o("laundry", "Laundry", "लन्ड्री", "shirt"),
    o("pickup", "Airport pickup", "एयरपोर्ट पिकअप", "plane"), o("spa", "Spa", "स्पा", "sparkles"), o("gym", "Gym", "जिम", "dumbbell"), o("kitchen", "Kitchen", "भान्सा", "cooking-pot"),
    o("lake_view", "Lake view", "ताल दृश्य", "waves"), o("mountain_view", "Mountain view", "हिमाल दृश्य", "mountain"), o("garden", "Garden", "बगैंचा", "flower-2"), o("workspace", "Workspace", "काम गर्ने ठाउँ", "laptop"),
  ],
  houseRules: [o("no_smoking", "No smoking", "धुम्रपान निषेध", "cigarette-off"), o("pets", "Pets allowed", "घरपालुवा जनावर अनुमति", "paw-print"), o("parties", "Parties allowed", "पार्टी अनुमति", "party-popper"), o("quiet", "Quiet hours after 22:00", "२२:०० पछि शान्त", "moon"), o("couples", "Unmarried couples welcome", "अविवाहित जोडी स्वागत", "heart"), o("id_required", "ID required at check-in", "चेक-इनमा परिचयपत्र आवश्यक", "id-card")],
  cancellation: [o("flexible", "Flexible", "लचिलो", "rotate-ccw"), o("moderate", "Moderate", "मध्यम", "rotate-ccw"), o("strict", "Strict", "कडा", "lock"), o("non_refundable", "Non-refundable", "फिर्ता नहुने", "ban"), o("long_stay", "Long stay", "लामो बसाइ", "calendar-days")],
  checkTimes: [o("10", "10:00", "१०:००", "clock"), o("11", "11:00", "११:००", "clock"), o("12", "12:00", "१२:००", "clock"), o("13", "13:00", "१३:००", "clock"), o("14", "14:00", "१४:००", "clock"), o("15", "15:00", "१५:००", "clock")],

  // Projects
  projectTypes: [o("apartment_building", "Apartment building", "अपार्टमेन्ट भवन", "building"), o("colony", "Colony or housing", "कोलोनी वा हाउजिङ", "house"), o("villa_project", "Villa project", "भिला परियोजना", "trees"), o("commercial_complex", "Commercial complex", "व्यावसायिक कम्प्लेक्स", "building-2")],
  projectStatus: [o("upcoming", "Upcoming", "आउँदै", "calendar-days"), o("under_construction", "Under construction", "निर्माणाधीन", "construction"), o("ready", "Ready to move", "तयार", "circle-check")],
  unitTypes: [o("1bhk", "1 BHK", "१ बीएचके", "bed-single"), o("2bhk", "2 BHK", "२ बीएचके", "bed-double"), o("3bhk", "3 BHK", "३ बीएचके", "bed-double"), o("4bhk", "4 BHK", "४ बीएचके", "bed-double"), o("villa", "Villa", "भिला", "trees"), o("shop", "Shop", "पसल", "store"), o("office", "Office", "कार्यालय", "briefcase")],
  projectAmenities: [
    o("clubhouse", "Club house", "क्लब हाउस", "house"), o("pool", "Swimming pool", "स्विमिङ पुल", "waves"), o("gym", "Gym", "जिम", "dumbbell"), o("play", "Children's play area", "बालउद्यान", "baby"),
    o("security", "24-hour security", "२४ घण्टा सुरक्षा", "shield-check"), o("cctv", "CCTV", "सिसिटिभी", "cctv"), o("fire", "Fire safety", "आगलागी सुरक्षा", "flame"), o("earthquake", "Earthquake resistant", "भूकम्प प्रतिरोधी", "activity"),
    o("solar", "Solar", "सोलार", "sun"), o("rainwater", "Rainwater harvesting", "वर्षाको पानी संकलन", "droplets"), o("green", "Green space", "हरियाली", "trees"), o("lift", "Lift", "लिफ्ट", "arrow-up-down"),
  ],
  banks: [o("nabil", "Nabil Bank", "नबिल बैंक", "landmark"), o("nic", "NIC Asia", "एनआइसी एसिया", "landmark"), o("global", "Global IME", "ग्लोबल आइएमई", "landmark"), o("laxmi", "Laxmi Sunrise", "लक्ष्मी सनराइज", "landmark"), o("nibl", "NIMB", "एनआइएमबी", "landmark")],

  // Investments
  investTypes: [o("hotel", "Hotel", "होटल", "hotel"), o("villa_project", "Villa project", "भिला परियोजना", "trees"), o("colony", "Colony", "कोलोनी", "house"), o("commercial", "Commercial", "व्यावसायिक", "building-2")],
  returnTypes: [o("profit_share", "Profit share", "नाफा बाँडफाँड", "chart-pie"), o("rental_yield", "Rental yield", "भाडा आम्दानी", "key-round"), o("capital_gain", "Capital gain", "पूँजीगत लाभ", "trending-up")],
  payoutFrequency: [o("quarterly", "Every 3 months", "हरेक ३ महिना", "calendar-days"), o("half_yearly", "Every 6 months", "हरेक ६ महिना", "calendar-days"), o("yearly", "Every year", "हरेक वर्ष", "calendar-days"), o("exit", "At exit", "अन्त्यमा", "flag")],
  minInvest: [o("10000", "Rs. 10,000", "रु. १०,०००", "wallet"), o("25000", "Rs. 25,000", "रु. २५,०००", "wallet"), o("50000", "Rs. 50,000", "रु. ५०,०००", "wallet"), o("100000", "Rs. 1,00,000", "रु. १,००,०००", "wallet")],

  // Locations (major districts)
  districts: [
    o("kathmandu", "Kathmandu", "काठमाडौं", "map-pin"), o("lalitpur", "Lalitpur", "ललितपुर", "map-pin"), o("bhaktapur", "Bhaktapur", "भक्तपुर", "map-pin"), o("kaski", "Kaski (Pokhara)", "कास्की (पोखरा)", "map-pin"),
    o("chitwan", "Chitwan", "चितवन", "map-pin"), o("rupandehi", "Rupandehi (Lumbini)", "रुपन्देही (लुम्बिनी)", "map-pin"), o("morang", "Morang", "मोरङ", "map-pin"), o("tanahun", "Tanahun", "तनहुँ", "map-pin"),
  ],
  areas: {
    kathmandu: ["Budhanilkantha", "Baneshwor", "Koteshwor", "Maharajgunj", "Thamel", "Kalanki", "Tokha", "Chabahil"],
    lalitpur: ["Jhamsikhel", "Sanepa", "Bhaisepati", "Imadol", "Satdobato", "Godawari"],
    bhaktapur: ["Suryabinayak", "Nagarkot", "Kausaltar", "Thimi"],
    kaski: ["Lakeside", "Sedi", "Sarangkot", "Chipledhunga", "Bijayapur"],
    chitwan: ["Sauraha", "Bharatpur", "Narayangadh", "Ratnanagar"],
    rupandehi: ["Lumbini", "Butwal", "Bhairahawa"],
    morang: ["Biratnagar", "Urlabari"],
    tanahun: ["Bandipur", "Damauli"],
  },
};

// Location privacy: guests travel to stays, so the public sees their exact pin and directions.
// Every other kind shows only an approximate area; the exact pin stays with the business.
export const EXACT_LOCATION_KINDS = ["stay_hotel", "stay_unit"];
export const showsExactLocation = (kind) => EXACT_LOCATION_KINDS.includes(kind);

// Land area: hill (Ropani–Aana–Paisa–Daam) and terai (Bigha–Kattha–Dhur) systems.
export const AREA = {
  ropani: 5476, aana: 342.25, paisa: 85.5625, daam: 21.390625,
  bigha: 72900, kattha: 3645, dhur: 182.25, sqm: 10.7639,
};
export function areaToSqft(sys, v) {
  if (sys === "hill") return (v.ropani || 0) * AREA.ropani + (v.aana || 0) * AREA.aana + (v.paisa || 0) * AREA.paisa + (v.daam || 0) * AREA.daam;
  if (sys === "terai") return (v.bigha || 0) * AREA.bigha + (v.kattha || 0) * AREA.kattha + (v.dhur || 0) * AREA.dhur;
  return Number(v.sqft || 0);
}
export function sqftToHill(sq) {
  let r = Math.floor(sq / AREA.ropani); sq -= r * AREA.ropani;
  let a = Math.floor(sq / AREA.aana); sq -= a * AREA.aana;
  let p = Math.floor(sq / AREA.paisa); sq -= p * AREA.paisa;
  return { ropani: r, aana: a, paisa: p, daam: Math.round(sq / AREA.daam) };
}

/** The options staff changed in Admin → Listing setup (GET /catalog) laid over the built-in list. */
export function mergeCatalog(base, stored) {
  if (!stored) return base;
  const out = { ...base };
  for (const [k, items] of Object.entries(stored.lists || {})) {
    if (Array.isArray(items)) out[k] = items;
    // Grouped lists (property types per category, areas per district) change group by group.
    else if (items && typeof items === "object") out[k] = { ...(base[k] || {}), ...items };
  }
  if (stored.kindsByType) out.kindsByType = { ...base.kindsByType, ...stored.kindsByType };
  if (stored.forms) out.forms = stored.forms;
  return out;
}

// ── Fuller built-in lists (catalogMore.js): every district and its areas, more property types, room, bed, bathroom
// and amenity choices. They are added here once, so everything works with no setup. ──
import { MORE_AREAS, MORE_OPTIONS, MORE_TYPES } from "./catalogMore";
// Icons the platform's icon set has (core/icons.jsx); others become the closest one it has.
const ICON_FIX = { "door-closed": "door-open", package: "archive", "plug-zap": "zap", "shopping-basket": "shopping-bag", pill: "hospital", factory: "warehouse", tent: "tent-tree", tractor: "sprout", fan: "air-vent", refrigerator: "cooking-pot", footprints: "users", "washing-machine": "shirt", toilet: "droplets", "shower-head": "droplets", bath: "droplets", wind: "air-vent", "glass-water": "droplet", microwave: "cooking-pot", luggage: "briefcase", presentation: "users", siren: "bell-ring", "fire-extinguisher": "flame", cross: "hospital", accessibility: "users", "wine-off": "ban", salad: "leaf", fuel: "car", home: "house" };
const addTo = (list, rows) => { for (const [id, en, ne, icon] of rows) if (!list.some((x) => x.id === id)) list.push(o(id, en, ne, ICON_FIX[icon] || icon || "circle-check")); return list; };
for (const [key, rows] of Object.entries(MORE_OPTIONS)) CATALOG[key] = addTo(CATALOG[key] || [], rows);
for (const [cat, rows] of Object.entries(MORE_TYPES)) CATALOG.propertyTypes[cat] = addTo(CATALOG.propertyTypes[cat] || [], rows);
for (const [d, names] of Object.entries(MORE_AREAS)) CATALOG.areas[d] = [...new Set([...(CATALOG.areas[d] || []), ...names])];
