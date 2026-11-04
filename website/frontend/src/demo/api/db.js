// Local sample data for the parts of the website not served by the API.
// How it works: starts empty: no invented properties, agencies, people, reviews, blogs or jobs; only reference lists
// (areas, property types, categories) live here. Real listings come from the API.

const STORE_KEY = "sheetal_demo_db_v7";

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

function build() {
  return {
    agents: [], properties: [], blogCategories: [], blogs: [], jobs: [], reviews: [], banners: [],
    demands: [], users: [], favourites: [], notifications: [], inquiries: [], tours: [],
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
