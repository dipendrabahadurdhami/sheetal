// Each business type's own words (the owner's plan of 27 Nov 2026): a hotel works with rooms, guests and reservations; an agency with
// properties and clients; a developer with units, buyers and instalments; a host with homes and stays; a sponsor with offerings and investors.
// Where it fits: I18nProvider (shared/src/core/i18n.jsx) takes the open business's type; t() looks here first, so the menu, the quick-create
// list and the page titles that share these keys follow the business type by themselves.
// How it works: only the words that differ are listed, per type and language; anything not listed is the normal word. A word missing in
// Nepali uses the normal Nepali word, never the English one.

export const TYPE_WORDS = {
  hotel: {
    en: {
      "group.listings": "Rooms and marketing", "nav.listings": "Rooms and listings", "listings.new": "New room or listing",
      "group.leads": "Guests and enquiries", "group.customers": "Guests", "nav.inbox": "Guest enquiries", "group.operate": "Front office",
      "nav.bookings": "Reservations", "nav.calendar": "Room calendar", "nav.pos": "Restaurant and bar", "nav.invoices": "Guest invoices",
    },
    ne: {
      "group.listings": "कोठा र बजारीकरण", "nav.listings": "कोठा र सूचीहरू", "listings.new": "नयाँ कोठा वा सूची",
      "group.leads": "पाहुना र सोधपुछ", "group.customers": "पाहुना", "nav.inbox": "पाहुनाको सोधपुछ", "group.operate": "फ्रन्ट अफिस",
      "nav.bookings": "आरक्षण", "nav.calendar": "कोठा पात्रो", "nav.pos": "रेस्टुरेन्ट र बार", "nav.invoices": "पाहुनाको बिल",
    },
  },
  host: {
    en: {
      "group.listings": "Homes and marketing", "nav.listings": "Homes", "listings.new": "New home",
      "group.leads": "Guests and enquiries", "group.customers": "Guests", "nav.inbox": "Guest messages",
      "nav.bookings": "Stays", "nav.calendar": "Availability", "nav.invoices": "Guest invoices",
    },
    ne: {
      "group.listings": "घर र बजारीकरण", "nav.listings": "घरहरू", "listings.new": "नयाँ घर",
      "group.leads": "पाहुना र सोधपुछ", "group.customers": "पाहुना", "nav.inbox": "पाहुनाका सन्देश",
      "nav.bookings": "बसाइ", "nav.calendar": "उपलब्धता", "nav.invoices": "पाहुनाको बिल",
    },
  },
  developer: {
    en: {
      "group.listings": "Projects and marketing", "nav.listings": "Units and listings", "listings.new": "New unit or listing",
      "group.leads": "Buyers and leads", "group.customers": "Buyers", "nav.inbox": "Buyer enquiries", "nav.projects": "Projects and units",
      "nav.collections": "Instalments", "nav.invoices": "Buyer invoices", "nav.agreements": "Sale agreements",
    },
    ne: {
      "group.listings": "परियोजना र बजारीकरण", "nav.listings": "युनिट र सूचीहरू", "listings.new": "नयाँ युनिट वा सूची",
      "group.leads": "खरिदकर्ता र लिड", "group.customers": "खरिदकर्ता", "nav.inbox": "खरिदकर्ताको सोधपुछ", "nav.projects": "परियोजना र युनिट",
      "nav.collections": "किस्ता", "nav.invoices": "खरिदकर्ताको बिल", "nav.agreements": "बिक्री सम्झौता",
    },
  },
  agency: {
    en: {
      "group.listings": "Properties and marketing", "nav.listings": "Properties", "listings.new": "New property",
      "group.leads": "Clients and leads", "group.customers": "Clients", "nav.inbox": "Client enquiries",
      "nav.invoices": "Client invoices", "nav.agreements": "Deals and agreements", "nav.collections": "Payments due",
    },
    ne: {
      "group.listings": "सम्पत्ति र बजारीकरण", "nav.listings": "सम्पत्तिहरू", "listings.new": "नयाँ सम्पत्ति",
      "group.leads": "ग्राहक र लिड", "group.customers": "ग्राहक", "nav.inbox": "ग्राहकको सोधपुछ",
      "nav.invoices": "ग्राहकको बिल", "nav.agreements": "कारोबार र सम्झौता", "nav.collections": "बाँकी भुक्तानी",
    },
  },
  sponsor: {
    en: {
      "group.listings": "Offerings and marketing", "nav.listings": "Offerings", "listings.new": "New offering",
      "group.leads": "Investors and enquiries", "group.customers": "Investors", "nav.inbox": "Investor enquiries",
      "nav.invoices": "Investor invoices", "nav.payouts": "Investor payouts",
    },
    ne: {
      "group.listings": "लगानी प्रस्ताव र बजारीकरण", "nav.listings": "लगानी प्रस्ताव", "listings.new": "नयाँ लगानी प्रस्ताव",
      "group.leads": "लगानीकर्ता र सोधपुछ", "group.customers": "लगानीकर्ता", "nav.inbox": "लगानीकर्ताको सोधपुछ",
      "nav.invoices": "लगानीकर्ताको बिल", "nav.payouts": "लगानीकर्ता भुक्तानी",
    },
  },
};
