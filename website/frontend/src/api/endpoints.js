// Every data call the website makes, by name (api.properties(), api.login(), api.reviews()…).
// Where it fits: pages and components call these instead of building URLs themselves.
// How it works: paths and fields match the website API (website/backend) and the old site's API.

import { request } from "./client";

const get = (p, params) => request("get", p, { params });
const post = (p, data) => request("post", p, { data });

export const api = {
  // site
  banners: () => get("banners"),
  site: () => get("site"), // public platform settings: Google ids, maintenance message
  attributes: () => get("property-attributes"),
  suggestions: (q) => get("search/suggestions", { q }),

  // properties
  featured: () => get("featured-property-list"),
  latest: () => get("all-properties"),
  allProperties: (page = 1, per = 60) => get("all-properties", { page, per_page: per }),
  byPurpose: (purpose, page = 1, per = 12) => get(purpose === "rent" ? "rent" : "sale", { page, per_page: per }),
  search: (params) => get("search", params),
  mapPins: () => get("map-pins"),
  // Stays, projects and investments posted as listings (the website's own pages for these kinds).
  kindList: (path, page = 1, per = 100) => get(path, { page, per_page: per }), // optional fast endpoint for the map (see backend-fix/MapPins.md)
  property: (id) => get(/^\d+$/.test(String(id)) ? `property-detail/${id}` : `property-by-slug/${id}`),
  byCode: (code) => get(`property-by-code/${code}`),

  // agents
  agents: () => get("agent-list"),
  agent: (id) => get(`agent-detail/${id}`),
  agentProperties: (id, page = 1, per = 60) => get(`agent-properties/${id}`, { page, per_page: per }),

  // reviews
  reviews: (type, id) => get("reviews-public", type === "agent" ? { type, agent_id: id } : { type, property_id: id }),
  addReview: (data) => post("reviews", data),

  // contact
  contactAgent: (data) => post("contact-agent", data),
  contactOwner: (data) => post("contact-owner", data),
  demoRequest: (data) => post("demo-request", data), // Sheetal Technologies demo request (super admin is told)

  // rent (Pay rent and Profile → My rentals)
  rentFind: (data) => post("rent/find", data),
  rentMine: () => get("rent/mine"),
  rentPay: (data) => post("rent/pay", data),

  // online forms of businesses (/f/:slug)
  form: (slug) => get(`forms/${encodeURIComponent(slug)}`),
  formSubmit: (slug, data) => post(`forms/${encodeURIComponent(slug)}`, data),

  // how boosted listings do (Business → Promote)
  promoSeen: (data) => post("promote/seen", data),
  promoClick: (data) => post("promote/click", data),
  // home page banners
  bannerSeen: (data) => post("banners/seen", data),
  bannerClick: (data) => post("banners/click", data),

  // signing an agreement a business sent (/sign/:token)
  signDoc: (token) => get(`sign/${encodeURIComponent(token)}`),
  signCode: (token) => post(`sign/${encodeURIComponent(token)}/code`, {}),
  sign: (token, data) => post(`sign/${encodeURIComponent(token)}`, data),
  scheduleTour: (data) => post("schedule-tour", data),
  requirement: (fd, agentId) => post(agentId ? "agent-requirement-form" : "requirement-form", fd),
  requirementFee: () => get("requirement-fee/settings-public"),
  demands: () => get("property-demand-list"),
  demandMatches: (ids) => get("demand-matches-by-requirements", { requirement_form_ids: ids }),
  demandMatch: (data) => post("demand-match", data),
  askAi: (codes, question) => post("ask-ai", { property_codes: codes, question }),
  trackVisit: (data) => post("track-visit", data),
  heartbeat: (session_id) => post("track-heartbeat", { session_id }),

  // auth
  login: (email, password) => post("login", { email: email.toLowerCase().trim(), password }),
  register: (data) => post("register", data),
  forgot: (email) => post("forgot-password", { email }),
  resetPassword: (data) => post("reset-password", data),
  resendVerification: (email) => post("email/resend", { email }),
  verifyEmail: (token) => get(`email/verify/${encodeURIComponent(token)}`),
  logout: () => post("logout"),
  changeEmailResend: (data) => post("email/change-resend", data),
  me: () => get("user-info"),
  updateProfile: (fd) => post("update-profile", fd),
  changePassword: (data) => post("change-password", data),

  // user
  favourites: () => get("user-favourites-list"),
  addFav: (id) => post("add-to-favourite", { property_id: id }),
  removeFav: (id) => post("remove-from-favourite", { property_id: id }),
  myProperties: () => get("user-property"),
  postProperty: (fd) => post("post-property/", fd),
  deleteProperty: (id) => request("delete", `delete-property/${id}`),
  markSold: (id, sold = true) => post("mark-as-sold", { property_id: id, sold }),
  notifications: () => get("agent-notifications"),
  readAllNotifications: () => post("agent-notifications/read-all"),
  plans: (type) => get("subscription-plans", type ? { type } : undefined),
  // Phase 3 (P3-FE-5): the public app catalog (prices VAT included, free limits) and the "Start free" hand-off to the business panel.
  catalog: () => get("public/catalog"),
  packs: () => get("public/packs"),
  startFree: (app, type) => post("start-free", { ...(app ? { app } : {}), ...(type ? { type } : {}) }),
  requestUpgrade: (plan, months = 1) => post("request-upgrade", { requested_plan: plan, months }),

  // blog
  blogs: (page = 1, per = 9) => get("blog", { page, per_page: per }),
  blog: (slug) => get(`blog/${slug}`),
  blogCategory: (slug, page = 1) => get(`blog/category/${slug}`, { page }),
  blogCategories: () => get("blog/categories"),
  blogComment: (id, data) => post(`blog/${id}/comment`, data),

  // careers
  jobs: () => get("jobs"),
  job: (slug) => get(`jobs/${slug}`),
  applyJob: (slug, fd) => post(`jobs/${slug}/apply`, fd),
};
