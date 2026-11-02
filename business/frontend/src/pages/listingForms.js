// Listing form definitions, one per listing kind.
// Field types: choice, multi, counter, seg, text, number, price, land, location, map,
// photos, docs, toggle, repeat, story. Labels are [English, Nepali].
// `src` = catalog key, or (values, catalog) => items. `when` = (values) => show?

const choice = (name, label, src, o = {}) => ({ type: "choice", name, label, src, ...o });
const multi = (name, label, src, o = {}) => ({ type: "multi", name, label, src, ...o });
const counter = (name, label, min = 0, max = 20, o = {}) => ({ type: "counter", name, label, min, max, ...o });
const seg = (name, label, options, o = {}) => ({ type: "seg", name, label, options, ...o });
const text = (name, label, o = {}) => ({ type: "text", name, label, ...o });
const number = (name, label, unit, o = {}) => ({ type: "number", name, label, unit, ...o });
const price = (name, label, quick, o = {}) => ({ type: "price", name, label, quick, ...o });
const toggle = (name, label, sub, o = {}) => ({ type: "toggle", name, label, sub, ...o });

const isLand = (v) => v.category === "land";
const isBuilt = (v) => v.category === "house" || v.category === "apartment";
const isHouse = (v) => v.category === "house";
const isCommercial = (v) => v.category === "commercial";

const WHERE = {
  id: "where", label: ["Where is it?", "कहाँ छ?"], icon: "map-pin",
  fields: [
    { type: "location", name: "location", label: ["District and area", "जिल्ला र क्षेत्र"], req: true },
    counter("ward", ["Ward no.", "वडा नं."], 1, 35, { def: 1 }),
    text("tole", ["Tole or street", "टोल वा सडक"], { optional: true, placeholder: "e.g. Chandol marg" }),
    { type: "map", name: "pin", label: ["Exact location", "सही स्थान"] },
    multi("nearby", ["What is nearby?", "नजिकै के छ?"], "nearby"),
  ],
};

const PHOTOS = (docs) => ({
  id: "photos", label: ["Photos and papers", "फोटो र कागजात"], icon: "image",
  fields: [
    { type: "photos", name: "photos", label: ["Photos", "फोटो"], min: 5, req: true },
    text("video", ["Video tour link", "भिडियो लिंक"], { optional: true, placeholder: "YouTube or Facebook link" }),
    { type: "docs", name: "docs", label: ["Papers (private)", "कागजात (गोप्य)"], items: docs },
  ],
});

const PUBLISH = {
  id: "publish", label: ["Review and publish", "जाँच र प्रकाशन"], icon: "send",
  fields: [
    { type: "story", name: "title", label: ["Title", "शीर्षक"] },
    seg("visibility", ["Who can see it", "कसले देख्न सक्छ"], [["public", "Public on Sheetal", "Sheetal मा सार्वजनिक"], ["unlisted", "Only people with the link", "लिंक भएकाले मात्र"], ["private", "Private, my workspace only", "निजी, मेरो कार्यक्षेत्र मात्र"]], { def: "public", note: ["Private listings still work with bookings, POS, agreements and your own website link.", "निजी सूचीमा पनि बुकिङ, POS, सम्झौता र आफ्नै वेबसाइट लिंक चल्छ।"] }),
    choice("boost", ["Promote this listing", "यो सूचीको प्रचार"], "boosts", { optional: true }),
  ],
};

const SALE_RENT_WHAT = (kind) => ({
  id: "what", label: ["What are you listing?", "के सूचीकृत गर्दै हुनुहुन्छ?"], icon: "house",
  fields: [
    choice("category", ["Category", "वर्ग"], "categories", { req: true, big: true }),
    choice("propertyType", ["Type", "प्रकार"], (v, c) => c.propertyTypes[v.category] || [], { req: true, when: (v) => !!v.category }),
    seg("classType", ["Area type", "क्षेत्रको प्रकार"], "classTypes"),
    ...(kind === "sell" ? [seg("ownerType", ["You are the", "तपाईं"], "ownerTypes", { def: "owner" })] : []),
    seg("urgency", ["How soon?", "कति छिटो?"], "urgency", { def: "normal" }),
  ],
});

const SIZE = {
  id: "size", label: ["Size and layout", "आकार र बनावट"], icon: "ruler",
  fields: [
    { type: "land", name: "landArea", label: ["Land area", "जग्गाको क्षेत्रफल"], req: true, when: (v) => isLand(v) || isHouse(v) },
    counter("bedrooms", ["Bedrooms", "शयनकक्ष"], 0, 12, { when: isBuilt, def: 2 }),
    counter("bathrooms", ["Bathrooms", "बाथरुम"], 0, 10, { when: isBuilt, def: 1 }),
    counter("kitchens", ["Kitchens", "भान्सा"], 0, 6, { when: isBuilt, def: 1 }),
    counter("living", ["Living rooms", "बैठक कोठा"], 0, 6, { when: isBuilt, def: 1 }),
    counter("floors", ["Floors", "तला"], 1, 20, { when: (v) => isHouse(v) || isCommercial(v), def: 2 }),
    counter("floorNo", ["On floor", "कुन तलामा"], 0, 30, { when: (v) => v.category === "apartment", def: 3 }),
    counter("shutters", ["Shutters", "सटर"], 0, 20, { when: isCommercial }),
    counter("parking", ["Parking (cars)", "पार्किङ (गाडी)"], 0, 10, { when: (v) => !isLand(v) }),
    number("builtUp", ["Built-up area", "निर्मित क्षेत्रफल"], "sq ft", { when: (v) => !isLand(v) }),
    choice("facing", ["Facing", "मोहडा"], "facing"),
    choice("roadWidth", ["Road width", "सडकको चौडाइ"], "roadWidth"),
    choice("roadType", ["Road type", "सडकको प्रकार"], "roadType"),
    seg("age", ["Building age", "भवनको उमेर"], [["new", "New", "नयाँ"], ["1_5", "1–5 years", "१–५ वर्ष"], ["5_10", "5–10 years", "५–१० वर्ष"], ["10p", "10+ years", "१०+ वर्ष"]], { when: (v) => !isLand(v) }),
  ],
};

const FEATURES = (kind) => ({
  id: "features", label: ["Features", "सुविधाहरू"], icon: "sparkles",
  fields: [
    choice("furnishing", ["Furnishing", "फर्निसिङ"], "furnishing", { when: (v) => !isLand(v) }),
    multi("facilities", ["Facilities", "सुविधा"], "facilities"),
    multi("environments", ["Surroundings", "वरपरको वातावरण"], "environments"),
    choice("exterior", ["Building style", "भवनको शैली"], "exteriorLooks", { when: isHouse }),
    multi("interior", ["Inside", "भित्री अवस्था"], "interiorLooks", { when: (v) => !isLand(v) }),
    ...(kind === "sell" ? [choice("propertyStatus", ["Current use", "हालको प्रयोग"], "propertyStatus")] : []),
  ],
});

const SALE_PRICE = {
  id: "price", label: ["Price", "मूल्य"], icon: "wallet",
  fields: [
    price("price", ["Asking price", "माग मूल्य"], [5e6, 1e7, 2e7, 3e7, 5e7, 1e8], { req: true }),
    toggle("negotiable", ["Price is negotiable", "मूल्य मोलमोलाइ हुन्छ"], ["Buyers can send offers", "खरिदकर्ताले प्रस्ताव पठाउन सक्छन्"], { def: true }),
    multi("banks", ["Bank loan available from", "बैंक कर्जा उपलब्ध"], "banks", { optional: true }),
  ],
};

const RENT_PRICE = {
  id: "price", label: ["Rent and terms", "भाडा र सर्त"], icon: "wallet",
  fields: [
    price("rent", ["Monthly rent", "मासिक भाडा"], [15000, 25000, 35000, 50000, 80000, 150000], { req: true, per: ["/ month", "/ महिना"] }),
    choice("deposit", ["Deposit", "धरौटी"], "deposits", { def: "d2" }),
    choice("lease", ["Minimum lease", "न्यूनतम सम्झौता अवधि"], "leaseTerms", { def: "y1" }),
    multi("tenants", ["Who can live here", "को बस्न सक्छ"], "tenants"),
    multi("utilities", ["Included in rent", "भाडामा समावेश"], "utilities", { optional: true }),
    seg("available", ["Available from", "कहिलेदेखि उपलब्ध"], [["now", "Now", "अहिले"], ["15d", "In 15 days", "१५ दिनमा"], ["1m", "In 1 month", "१ महिनामा"]], { def: "now" }),
  ],
};

const STAY_RULES = {
  id: "rules", label: ["Amenities and rules", "सुविधा र नियम"], icon: "list-checks",
  fields: [
    multi("amenities", ["Amenities", "सुविधा"], "stayAmenities", { req: true }),
    multi("rules", ["House rules", "घरका नियम"], "houseRules"),
    choice("checkIn", ["Check-in from", "चेक-इन"], "checkTimes", { def: "14" }),
    choice("checkOut", ["Check-out by", "चेक-आउट"], "checkTimes", { def: "11" }),
    choice("cancellation", ["Cancellation policy", "रद्द नीति"], "cancellation", { def: "moderate", req: true }),
  ],
};

export const FORMS = {
  sell: [SALE_RENT_WHAT("sell"), WHERE, SIZE, FEATURES("sell"), SALE_PRICE,
    PHOTOS([["lalpurja", "Lalpurja copy", "लालपुर्जा प्रतिलिपि"], ["citizenship", "Owner citizenship", "धनीको नागरिकता"], ["charkilla", "Char killa (ward)", "चार किल्ला (वडा)"], ["trace", "Trace naksa (blueprint)", "ट्रेस नक्सा"], ["tiro", "Land tax receipt (tiro)", "मालपोत तिरो रसिद"], ["naksa", "Building permit (naksa pass)", "नक्सा पास"]]), PUBLISH],
  rentout: [SALE_RENT_WHAT("rentout"), WHERE, SIZE, FEATURES("rentout"), RENT_PRICE,
    PHOTOS([["citizenship", "Owner citizenship", "धनीको नागरिकता"], ["lalpurja", "Lalpurja copy", "लालपुर्जा प्रतिलिपि"], ["rent_tax", "Rental tax registration (ward)", "घर भाडा कर दर्ता (वडा)"]]), PUBLISH],
  stay_hotel: [
    { id: "what", label: ["About the property", "सम्पत्तिबारे"], icon: "hotel", fields: [
      choice("stayType", ["Type", "प्रकार"], "stayTypesHotel", { req: true, big: true }),
      seg("stars", ["Star rating", "तारा मूल्याङ्कन"], "stars", { def: "s0" }),
      text("name", ["Property name", "सम्पत्तिको नाम"], { req: true, placeholder: "e.g. Lakeside Retreat Hotel" }),
    ] },
    WHERE,
    { id: "rooms", label: ["Rooms", "कोठाहरू"], icon: "bed-double", fields: [
      { type: "repeat", name: "rooms", label: ["Room types", "कोठाका प्रकार"], add: ["Add a room type", "कोठाको प्रकार थप्नुहोस्"], req: true, def: [{ type: "deluxe", bed: "queen", count: 4, guests: 2, price: 6500 }], fields: [
        choice("type", ["Room type", "कोठाको प्रकार"], "roomTypes"), choice("bed", ["Bed", "बेड"], "bedTypes"),
        counter("count", ["Rooms of this type", "यस प्रकारका कोठा"], 1, 200, { def: 1 }), counter("guests", ["Guests per room", "प्रति कोठा पाहुना"], 1, 12, { def: 2 }),
        price("price", ["Price per night", "प्रति रात मूल्य"], [2500, 4500, 6500, 9000, 15000], { per: ["/ night", "/ रात"] }),
      ] },
    ] },
    STAY_RULES,
    { id: "price", label: ["Pricing and payment", "मूल्य र भुक्तानी"], icon: "wallet", fields: [
      seg("weekend", ["Weekend price (Fri, Sat)", "सप्ताहन्त मूल्य"], [["0", "Same", "उस्तै"], ["10", "+10%", "+१०%"], ["20", "+20%", "+२०%"], ["30", "+30%", "+३०%"]], { def: "10" }),
      toggle("breakfast", ["Breakfast included", "बिहानको खाना समावेश"], ["Shown on every room", "हरेक कोठामा देखिन्छ"], { def: true }),
      seg("payment", ["Guests pay", "पाहुनाले तिर्ने"], [["full", "Full online", "पूरै अनलाइन"], ["advance30", "30% advance", "३०% अग्रिम"], ["at_hotel", "At the hotel", "होटलमा"]], { def: "advance30" }),
      seg("children", ["Children", "बालबालिका"], [["free5", "Free under 5", "५ वर्षमुनि निःशुल्क"], ["free12", "Free under 12", "१२ वर्षमुनि निःशुल्क"], ["charged", "Charged", "शुल्क लाग्छ"]], { def: "free5" }),
    ] },
    PHOTOS([["license", "Tourism license", "पर्यटन अनुमतिपत्र"], ["pan", "PAN or VAT certificate", "प्यान वा भ्याट प्रमाणपत्र"], ["fire", "Fire safety certificate", "अग्नि सुरक्षा प्रमाणपत्र"]]),
    PUBLISH,
  ],
  stay_unit: [
    { id: "what", label: ["About the place", "ठाउँबारे"], icon: "house", fields: [
      choice("stayType", ["Type", "प्रकार"], "stayTypesUnit", { req: true, big: true }),
      seg("space", ["Guests get", "पाहुनाले पाउने"], [["entire", "Entire place", "पूरै ठाउँ"], ["private", "Private room", "निजी कोठा"], ["shared", "Shared room or dorm", "साझा कोठा वा डर्म"]], { def: "entire" }),
      text("name", ["Name", "नाम"], { req: true, placeholder: "e.g. Fewa View Villa" }),
    ] },
    WHERE,
    { id: "size", label: ["Home facts", "घरको विवरण"], icon: "ruler", fields: [
      counter("bedrooms", ["Bedrooms", "शयनकक्ष"], 0, 12, { def: 2, when: (v) => v.stayType !== "hostel" }),
      counter("beds", ["Beds", "बेड"], 1, 60, { def: 3 }),
      counter("bathrooms", ["Bathrooms", "बाथरुम"], 1, 12, { def: 1 }),
      counter("maxGuests", ["Maximum guests", "अधिकतम पाहुना"], 1, 60, { def: 4 }),
      number("size", ["Size", "आकार"], "sq ft", { optional: true }),
    ] },
    STAY_RULES,
    { id: "price", label: ["Pricing", "मूल्य"], icon: "wallet", fields: [
      price("nightly", ["Price per night", "प्रति रात मूल्य"], [1500, 3500, 6000, 9000, 12000, 20000], { req: true, per: ["/ night", "/ रात"] }),
      seg("weeklyOff", ["Weekly discount (7+ nights)", "साप्ताहिक छुट (७+ रात)"], [["0", "None", "छैन"], ["10", "10%", "१०%"], ["15", "15%", "१५%"], ["20", "20%", "२०%"]], { def: "10" }),
      seg("monthlyOff", ["Monthly discount (28+ nights)", "मासिक छुट (२८+ रात)"], [["0", "None", "छैन"], ["20", "20%", "२०%"], ["30", "30%", "३०%"], ["40", "40%", "४०%"]], { def: "20" }),
      counter("minNights", ["Minimum nights", "न्यूनतम रात"], 1, 30, { def: 2 }),
      price("cleaning", ["Cleaning fee", "सरसफाइ शुल्क"], [0, 500, 1000, 1500, 2500], { per: ["/ stay", "/ बसाइ"] }),
      price("depositAmt", ["Refundable deposit", "फिर्ता हुने धरौटी"], [0, 5000, 10000, 20000], { optional: true }),
    ] },
    PHOTOS([["ownership", "Ownership or lease paper", "स्वामित्व वा लिज कागज"], ["citizenship", "Host citizenship", "होस्टको नागरिकता"], ["homestay_reg", "Homestay registration (if any)", "होमस्टे दर्ता (भए)"]]),
    PUBLISH,
  ],
  project: [
    { id: "what", label: ["About the project", "परियोजनाबारे"], icon: "building-2", fields: [
      choice("projectType", ["Project type", "परियोजनाको प्रकार"], "projectTypes", { req: true, big: true }),
      seg("projectStatus", ["Status", "अवस्था"], "projectStatus", { def: "under_construction" }),
      text("name", ["Project name", "परियोजनाको नाम"], { req: true, placeholder: "e.g. Shetal Heights" }),
      toggle("approved", ["Approved by the municipality", "नगरपालिकाबाट स्वीकृत"], ["Building permit number goes in papers", "अनुमति नम्बर कागजातमा राख्नुहोस्"], { def: true }),
    ] },
    WHERE,
    { id: "size", label: ["Project facts", "परियोजनाको विवरण"], icon: "ruler", fields: [
      counter("towers", ["Towers or blocks", "टावर वा ब्लक"], 1, 20, { def: 2 }),
      counter("floors", ["Floors", "तला"], 1, 40, { def: 12 }),
      { type: "land", name: "landArea", label: ["Land area", "जग्गाको क्षेत्रफल"] },
      seg("possession", ["Handover", "हस्तान्तरण"], [["2027", "2027", "२०२७"], ["2028", "2028", "२०२८"], ["2029", "2029", "२०२९"], ["2030", "2030+", "२०३०+"]], { def: "2028" }),
    ] },
    { id: "units", label: ["Units and prices", "युनिट र मूल्य"], icon: "layout-grid", fields: [
      { type: "repeat", name: "units", label: ["Unit types", "युनिटका प्रकार"], add: ["Add a unit type", "युनिट प्रकार थप्नुहोस्"], req: true, def: [{ type: "2bhk", count: 40, size: 1100, price: 8500000 }, { type: "3bhk", count: 32, size: 1450, price: 14200000 }], fields: [
        choice("type", ["Unit type", "युनिटको प्रकार"], "unitTypes"), counter("count", ["How many", "कति वटा"], 1, 500, { def: 10 }),
        number("size", ["Size", "आकार"], "sq ft"), price("price", ["Price", "मूल्य"], [5e6, 8.5e6, 1.2e7, 2e7]),
      ] },
      seg("paymentPlan", ["Payment plan", "भुक्तानी योजना"], [["clp", "Construction-linked", "निर्माणसँग जोडिएको"], ["204040", "20 / 40 / 40", "२० / ४० / ४०"], ["emi", "Down payment + bank loan", "डाउन पेमेन्ट + बैंक कर्जा"]], { def: "clp" }),
      multi("banks", ["Loan partner banks", "कर्जा साझेदार बैंक"], "banks"),
    ] },
    { id: "features", label: ["Amenities", "सुविधा"], icon: "sparkles", fields: [multi("amenities", ["Amenities", "सुविधा"], "projectAmenities", { req: true })] },
    PHOTOS([["brochure", "Brochure (PDF)", "ब्रोसर (PDF)"], ["permit", "Building permit", "निर्माण अनुमति"], ["layout", "Site layout plan", "साइट लेआउट"], ["agreement", "Sale agreement sample", "बिक्री सम्झौता नमुना"]]),
    PUBLISH,
  ],
  invest: [
    { id: "what", label: ["About the opportunity", "अवसरबारे"], icon: "hand-coins", fields: [
      choice("investType", ["What is being built", "के बनिँदैछ"], "investTypes", { req: true, big: true }),
      choice("returnType", ["How investors earn", "लगानीकर्ताले कसरी कमाउँछन्"], "returnTypes", { req: true }),
      text("name", ["Name", "नाम"], { req: true, placeholder: "e.g. Chitwan Jungle Lodge" }),
    ] },
    WHERE,
    { id: "price", label: ["Funding", "रकम संकलन"], icon: "wallet", fields: [
      price("target", ["Funding target", "लक्षित रकम"], [1e7, 2.5e7, 5e7, 1e8], { req: true }),
      choice("minInvest", ["Minimum investment", "न्यूनतम लगानी"], "minInvest", { def: "10000" }),
      seg("duration", ["Duration", "अवधि"], [["12", "1 year", "१ वर्ष"], ["24", "2 years", "२ वर्ष"], ["36", "3 years", "३ वर्ष"], ["60", "5 years", "५ वर्ष"]], { def: "36" }),
      seg("expected", ["Expected return per year", "वार्षिक अपेक्षित प्रतिफल"], [["8_10", "8–10%", "८–१०%"], ["10_12", "10–12%", "१०–१२%"], ["12_14", "12–14%", "१२–१४%"], ["14_16", "14–16%", "१४–१६%"]], { def: "12_14", note: ["Always shown with “Not guaranteed”.", "सधैं “ग्यारेन्टी छैन” सँगै देखिन्छ।"] }),
      choice("payout", ["Returns paid", "प्रतिफल भुक्तानी"], "payoutFrequency", { def: "yearly" }),
    ] },
    PHOTOS([["approvals", "Approvals", "स्वीकृति"], ["financial", "Financial plan", "वित्तीय योजना"], ["agreement", "Investment agreement", "लगानी सम्झौता"], ["company", "Company registration", "कम्पनी दर्ता"]]),
    PUBLISH,
  ],
};

// Suggested title from what the user picked, so they rarely type.
export function suggestTitle(kind, v, label) {
  const area = v.location?.area || label(v.location?.district, "districts") || "";
  if (kind === "sell" || kind === "rentout") {
    const beds = v.bedrooms && (v.category === "house" || v.category === "apartment") ? `${v.bedrooms} BHK ` : "";
    const type = label(v.propertyType, "propertyTypes", v.category) || label(v.category, "categories") || "Property";
    return `${beds}${type.toLowerCase()} for ${kind === "sell" ? "sale" : "rent"}${area ? ` in ${area}` : ""}`.replace(/^./, (c) => c.toUpperCase());
  }
  return v.name || "";
}

export const HIGHLIGHTS = {
  sell: ["Clear lalpurja", "Bank loan ready", "Corner plot", "Near ring road", "Mountain view", "Peaceful neighbourhood", "Car to the door"],
  rentout: ["Ready to move", "Separate entry", "24-hour water", "Family friendly", "Near school", "Office friendly"],
  stay_hotel: ["Lake view rooms", "Free airport pickup", "Rooftop restaurant", "Walk to the lake", "Family suites", "Trek desk"],
  stay_unit: ["Whole place to yourself", "Mountain view", "Fast Wi-Fi", "Kitchen", "Garden", "Self check-in"],
  project: ["Earthquake resistant", "Bank finance", "Handover on time", "Gated community", "Club house"],
  invest: ["Experienced operator", "Land already owned", "Approved plans", "Quarterly updates"],
};
