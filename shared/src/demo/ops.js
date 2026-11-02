// Demo data for operations: rooms, bookings, menu, extras, shifts, conversations and leads.
const ROOM_TYPES = [["101", "Standard twin"], ["102", "Standard twin"], ["103", "Standard twin"], ["104", "Standard double"], ["105", "Standard double"], ["106", "Standard double"],
  ["201", "Deluxe lake view"], ["202", "Deluxe lake view"], ["203", "Deluxe lake view"], ["204", "Deluxe lake view"], ["205", "Deluxe lake view"], ["206", "Deluxe garden"], ["207", "Deluxe garden"], ["208", "Deluxe garden"],
  ["301", "Family suite"], ["302", "Family suite"], ["303", "Family suite"], ["304", "Junior suite"], ["305", "Junior suite"], ["306", "Junior suite"],
  ["401", "Lake suite"], ["402", "Lake suite"], ["403", "Penthouse"], ["V1", "Garden villa"], ["V2", "Garden villa"], ["V3", "Garden villa"], ["D1", "Dorm, 6 beds"], ["D2", "Dorm, 6 beds"]];
const STATUS = ["occupied", "occupied", "vacant", "arriving", "occupied", "dirty", "occupied", "arriving", "occupied", "departing", "vacant", "occupied", "occupied", "blocked",
  "occupied", "arriving", "vacant", "occupied", "departing", "occupied", "occupied", "vacant", "occupied", "occupied", "dirty", "vacant", "occupied", "occupied"];
const GUESTS = ["Anil Shrestha", "Mina Rai", "", "Sita Gurung", "Priya Sharma", "", "Lin Chen", "Tenzing Lama", "Kiran Thapa", "Eva Novak", "", "Rajesh Koirala", "Hari Tamang", "",
  "James Miller", "Ngima Sherpa", "", "Sarah Wood", "Deepak Basnet", "Aarav Joshi", "Bina Karki", "", "Marco Rossi", "Ramesh Adhikari", "", "", "Tom Becker", "Yuki Sato"];

export function seedOps() {
  const rooms = ROOM_TYPES.map(([no, type], i) => ({
    no, type, status: STATUS[i], guest: GUESTS[i] || null, rate: type.includes("Standard") ? 4500 : type.includes("Deluxe") ? 6500 : type.includes("Dorm") ? 1200 : type.includes("villa") ? 12000 : 9500,
    from: "2027-03-01", to: STATUS[i] === "departing" ? "2027-03-02" : "2027-03-04", pax: type.includes("Family") ? 4 : 2, idOk: i % 5 !== 3,
    folio: STATUS[i] === "occupied" || STATUS[i] === "departing" ? [
      { id: "f1", what: "Room night", qty: 1, amount: type.includes("Standard") ? 4500 : 6500, at: "2027-03-01T14:10" },
      ...(i % 3 === 0 ? [{ id: "f2", what: "Breakfast", qty: 2, amount: 1600, at: "2027-03-02T08:05" }] : []),
      ...(i % 4 === 0 ? [{ id: "f3", what: "Laundry", qty: 1, amount: 650, at: "2027-03-02T09:30" }] : []),
    ] : [],
    paid: STATUS[i] === "occupied" ? 4500 : 0,
  }));
  const menu = [
    { cat: "breakfast", items: [["Nepali breakfast set", 650], ["Pancake with honey", 420], ["Masala omelette", 380], ["Fresh fruit bowl", 350]] },
    { cat: "nepali", items: [["Chicken thakali set", 950], ["Veg thakali set", 780], ["Buff momo (10)", 380], ["Chicken momo (10)", 420], ["Sekuwa platter", 890], ["Aloo tama", 320]] },
    { cat: "continental", items: [["Grilled trout", 1450], ["Chicken burger", 780], ["Pasta arrabiata", 690], ["Club sandwich", 620]] },
    { cat: "drinks", items: [["Masala tea", 120], ["Americano", 220], ["Fresh lime soda", 240], ["Gorkha beer", 650], ["House wine (glass)", 720], ["Mineral water", 80]] },
  ].map((c) => ({ ...c, items: c.items.map(([name, price], i) => ({ id: `${c.cat}-${i}`, name, price })) }));
  const tables = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "R1", "R2", "R3", "R4"].map((id, i) => ({ id, outlet: id.startsWith("R") ? "Rooftop Bar" : "Lakeside Café", seats: i % 3 === 0 ? 6 : 4, state: [1, 4, 9].includes(i) ? "busy" : i === 6 ? "bill" : "free" }));
  const extras = [
    { id: "x1", name: "Airport pickup", price: 1200, icon: "plane" }, { id: "x2", name: "Laundry (per kg)", price: 250, icon: "shirt" }, { id: "x3", name: "Sarangkot sunrise tour", price: 3500, icon: "mountain" },
    { id: "x4", name: "Boating on Fewa", price: 900, icon: "sailboat" }, { id: "x5", name: "Bike rental (day)", price: 1500, icon: "bike" }, { id: "x6", name: "Spa, 60 min", price: 4200, icon: "sparkles" },
    { id: "x7", name: "Late check-out", price: 2000, icon: "clock" }, { id: "x8", name: "Extra bed", price: 1500, icon: "bed-single" },
  ];
  const bookings = [
    { id: "BK-2027-0418", guest: "Sita Gurung", phone: "984-1010101", room: "201", type: "Deluxe lake view", from: "2027-03-12", to: "2027-03-15", amount: 49720, paid: 14916, status: "confirmed", source: "shetal" },
    { id: "BK-2027-0415", guest: "James Miller", phone: "+44 7700 900123", room: "301", type: "Family suite", from: "2027-03-13", to: "2027-03-20", amount: 126400, paid: 0, status: "requested", source: "shetal" },
    { id: "BK-2027-0411", guest: "Lin Chen", phone: "+86 138 0013 8000", room: "207", type: "Deluxe garden", from: "2027-03-01", to: "2027-03-04", amount: 23400, paid: 23400, status: "checked_in", source: "booking" },
    { id: "BK-2027-0409", guest: "Ramesh Adhikari", phone: "980-4455112", room: "V1", type: "Garden villa", from: "2027-02-28", to: "2027-03-03", amount: 42000, paid: 42000, status: "checked_in", source: "direct" },
    { id: "BK-2027-0402", guest: "Eva Novak", phone: "+420 601 123 456", room: "204", type: "Deluxe lake view", from: "2027-02-27", to: "2027-03-02", amount: 21960, paid: 21960, status: "checked_in", source: "airbnb" },
    { id: "BK-2027-0398", guest: "Anil Shrestha", phone: "984-7766554", room: "101", type: "Standard twin", from: "2027-02-25", to: "2027-02-27", amount: 11860, paid: 11860, status: "completed", source: "walkin" },
    { id: "BK-2027-0391", guest: "Priya Sharma", phone: "+91 98100 12345", room: "205", type: "Deluxe lake view", from: "2027-03-05", to: "2027-03-07", amount: 31200, paid: 31200, status: "cancelled", source: "shetal" },
  ];
  const shift = { open: true, by: "Bikash Thapa", since: "2027-03-02T07:00", float: 5000, sales: { cash: 18450, fonepay: 42300, card: 12600, esewa: 3200, room: 9800 } };
  const conversations = [
    { id: "c1", channel: "whatsapp", name: "Rita Maharjan", phone: "981-5550011", unread: 2, last: "Is the Budhanilkantha house still available? Can I visit Saturday?", at: "2027-03-02T09:52", stage: "viewing", value: 32000000, listing: "L-1042", assignee: "Sita Gurung", tags: ["buyer", "hot"], follow: "2027-03-06",
      msgs: [["in", "Namaste, I saw the 4 BHK house in Budhanilkantha on Sheetal.", "09:40"], ["out", "Namaste Rita ji. Yes, it's available. Would you like to visit?", "09:44"], ["in", "Is the Budhanilkantha house still available? Can I visit Saturday?", "09:52"]] },
    { id: "c2", channel: "messenger", name: "Suraj Bista", unread: 1, last: "What is the final price for the Jhamsikhel flat?", at: "2027-03-02T09:21", stage: "new", value: 45000, listing: "L-1043", assignee: null, tags: ["tenant"],
      msgs: [["in", "Hi, is parking included with the Jhamsikhel flat?", "09:15"], ["in", "What is the final price for the Jhamsikhel flat?", "09:21"]] },
    { id: "c3", channel: "instagram", name: "@travel.with.anna", unread: 0, last: "Thanks! We'll book for 12 March.", at: "2027-03-01T18:02", stage: "won", value: 49720, listing: "S-201", assignee: "Bikash Thapa", tags: ["guest"],
      msgs: [["in", "Do you have lake view rooms 12–15 March?", "17:40"], ["out", "Yes, Deluxe lake view is free. Rs. 6,500 per night with breakfast.", "17:48"], ["in", "Thanks! We'll book for 12 March.", "18:02"]] },
    { id: "c4", channel: "web", name: "Website visitor", unread: 1, last: "Do you allow pets in the villa?", at: "2027-03-02T08:47", stage: "new", value: 0, listing: "S-202", assignee: null, tags: [],
      msgs: [["in", "Do you allow pets in the villa?", "08:47"]] },
    { id: "c5", channel: "sms", name: "980-7712345", unread: 0, last: "Ok, I'll send the deposit today.", at: "2027-03-01T15:10", stage: "negotiating", value: 90000, listing: "L-1043", assignee: "Hari Bhandari", tags: ["tenant"],
      msgs: [["out", "Deposit for the flat is 2 months, Rs. 90,000.", "14:55"], ["in", "Ok, I'll send the deposit today.", "15:10"]] },
    { id: "c6", channel: "email", name: "Marco Rossi", email: "marco.rossi@mail.it", unread: 1, last: "Could you send an invoice for my company?", at: "2027-03-01T11:30", stage: "contacted", value: 38000, listing: "S-201", assignee: "Sunita Karki", tags: ["corporate"],
      msgs: [["in", "Could you send an invoice for my company?", "11:30"]] },
  ];
  return { rooms, menu, tables, extras, bookings, shift, conversations };
}
