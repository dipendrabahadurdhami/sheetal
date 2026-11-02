import { request } from "./client";

const get = (p, params) => request("get", p, { params });
const post = (p, data) => request("post", p, { data });

// Every data call the website makes (answered by api/mock until the new backend is ready).
export const api = {
  // site
  banners: () => get("banners"),
  attributes: () => get("property-attributes"),
  suggestions: (q) => get("search/suggestions", { q }),

  // properties
  featured: () => get("featured-property-list"),
  latest: () => get("all-properties"),
  allProperties: (page = 1, per = 60) => get("all-properties", { page, per_page: per }),
  byPurpose: (purpose, page = 1, per = 12) => get(purpose === "rent" ? "rent" : "sale", { page, per_page: per }),
  search: (params) => get("search", params),
  mapPins: () => get("map-pins"), // optional fast endpoint for the map (see backend-fix/MapPins.md)
  property: (id) => get(/^\d+$/.test(String(id)) ? `property-detail/${id}` : `property-by-slug/${id}`),
  byCode: (code) => get(`property-by-code/${code}`),

  // agents
  agents: () => get("agent-list"),
  agent: (id) => get(`agent-detail/${id}`),
  agentProperties: (id) => get(`agent-properties/${id}`),

  // reviews
  reviews: (type, id) => get("reviews-public", type === "agent" ? { type, agent_id: id } : { type, property_id: id }),
  addReview: (data) => post("reviews", data),

  // contact
  contactAgent: (data) => post("contact-agent", data),
  contactOwner: (data) => post("contact-owner", data),
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
