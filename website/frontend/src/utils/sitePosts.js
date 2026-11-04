// Website posts for stays, projects and investments (kept in the browser for now).
// How it works: statuses are review, live, changes (sent back), rejected and paused (by the owner).

const KEY = "shetal_site_posts";

export const POST_TYPES = {
  sell: { label: "Sell", sub: "House, land, flat or commercial" },
  rent: { label: "Rent out", sub: "Monthly rent and deposit" },
  stay: { label: "Offer a stay", sub: "Homestay, room, villa or hotel" },
  project: { label: "List a project", sub: "Apartments, colony, villas" },
  invest: { label: "Open an investment", sub: "Raise funds from Rs. 10,000" },
};

// review → live (approved) · changes (sent back) · rejected · paused (by the owner)
export const STATUS = {
  review: ["In review", "Our team checks every post, usually within one working day."],
  live: ["Live", "Visible on Sheetal."],
  changes: ["Changes needed", "Our team asked for a change. Edit and send it again."],
  rejected: ["Rejected", "This post can't go live. Contact us if you think this is wrong."],
  paused: ["Paused", "Hidden from Sheetal until you turn it back on."],
};

// Free accounts: 1 post of each type. A plan raises the limit.
export const FREE_PER_TYPE = 1;

export const sitePosts = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
export const saveSitePosts = (list) => { localStorage.setItem(KEY, JSON.stringify(list)); window.dispatchEvent(new Event("shetal-site-posts")); };
export const myPosts = (user) => sitePosts().filter((p) => p.owner === (user?.email || user?.id || "me"));
export const ownerOf = (user) => user?.email || user?.id || "me";
export const hasPlan = (user) => !!(user?.plan || user?.subscription || localStorage.getItem("shetal_plan:" + ownerOf(user)));

export const isEmailVerified = (user) => !!(user?.email_verified_at || localStorage.getItem("shetal_email_ok:" + (user?.email || "")));
export const markEmailVerified = (email) => localStorage.setItem("shetal_email_ok:" + (email || ""), "1");

// small cover preview that survives a reload
export const toPreview = (file, max = 640) => new Promise((res) => {
  const img = new Image(); const url = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.8)); };
  img.onerror = () => res(null); img.src = url;
});
