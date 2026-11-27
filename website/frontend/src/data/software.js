// What each Sheetal Technologies software is, the problems it solves and all its features, for /technology/software/<id>.
// Where it fits: Technology.jsx links each software card here; SoftwarePage.jsx shows one; the ids match SOFTWARE in platform/src/billing/packs.ts
// (the live price list says which plans include it). Rules: only features that exist in Sheetal Business; anything not live yet goes in `soon`.

export const SOFTWARE_INFO = {
  cms: {
    what: "A CMS (content management system) is where you put your business on the internet. With Sheetal CMS your properties, rooms, projects, jobs and reviews go live on sheetalproperty.com, the place people in Nepal search for property, without building or paying for your own website.",
    who: "Every agency, hotel, homestay, developer and owner. Free for everyone, with no limit on listings.",
    problems: [
      ["A website is expensive and nobody visits it", "Your listings go on Sheetal Property, where buyers and renters already search, with your own business page."],
      ["Listings go old and wrong", "Listing check-ups remind your team to confirm the price and the status, so people only see what is really available."],
      ["People don't trust a business they don't know", "Real reviews from customers, your replies, and a Verified badge once your papers are checked."],
    ],
    features: [
      ["Post anything", ["Property for sale and rent: houses, flats, land, shops and offices", "Hotels, homestays and holiday homes with rooms and prices", "Housing projects with their units", "Investment offerings for investors", "Jobs with a full online application form"]],
      ["Good listings", ["Photos, map location, area in Nepali units (aana, ropani, kattha) and prices in lakh and crore", "Drafts that save as you type", "A short code on every listing (for calls and WhatsApp)", "Listing check-ups so prices and status stay correct"]],
      ["Your business page", ["Your own page with logo, contact, branches and all your listings", "Reviews and star ratings with your replies", "Verified badge once your papers are checked"]],
      ["Leads come to you", ["Enquiries, site visit requests and calls from every listing", "Online forms you can share anywhere", "Everything arrives in your inbox (Sheetal CRM)"]],
    ],
  },
  crm: {
    what: "A CRM (customer relationship management) keeps every customer and every enquiry in one place, so nobody is forgotten. Sheetal CRM collects leads from the website, forms and chats, shows where each one stands, and reminds your team when to call back.",
    who: "Agencies, developers, hotels and anyone who gets enquiries and needs to turn them into sales or bookings.",
    problems: [
      ["Enquiries get lost in phones, WhatsApp and notebooks", "Every enquiry from your listings, forms and chats lands in one inbox, with the person's name, phone and what they want."],
      ["Nobody knows who is following up whom", "Give each lead to a team member, set the next follow-up date, and see every lead's stage at a glance."],
      ["Good customers are forgotten after the first call", "Each customer keeps their history: messages, visits, notes and the deal value."],
    ],
    features: [
      ["One inbox", ["Enquiries from the website, site visit requests and buyer requirements", "Online forms with your own questions", "Chats join the same lead (one person, one record)", "Unread counts on the phone and computer"]],
      ["Sales pipeline", ["Stages: new, contacted, viewing, negotiating, won and lost", "Assign leads to team members, by branch", "Follow-up dates, tags and deal value in rupees", "Download your leads as a spreadsheet"]],
      ["Team email", ["Mailboxes on your own domain (info@yourbusiness.com)", "Shared mailboxes the whole team can answer", "Read and send from the business panel"]],
      ["For many branches", ["Each lead goes to the branch of its listing", "Staff see only the branches you give them", "Alerts to the right people when a lead comes in"]],
    ],
  },
  accounting: {
    what: "Accounting software keeps track of the money coming in and going out. Sheetal Accounting makes VAT invoices the Nepal way, records what you pay out and spend, follows instalments, and shows your profit, so you always know where your business stands.",
    who: "Every business that bills customers, pays agents or staff, or collects payments in instalments.",
    problems: [
      ["Bills made by hand, in Word or Excel, with mistakes", "VAT invoices in a few clicks, numbered on Nepal's fiscal year, ready to print or send."],
      ["Not knowing who still owes money", "Payments and instalments are tracked against each invoice and each buyer, with what is due and when."],
      ["Spending is not written down, so profit is a guess", "Every expense is recorded, repeat expenses add themselves, and profit is worked out for you."],
    ],
    features: [
      ["Invoices", ["VAT invoices on Nepal's fiscal year (Shrawan to Ashadh)", "Paid by eSewa, Khalti, Fonepay or bank transfer", "Print or download as PDF", "Guest invoices for hotels and homestays"]],
      ["Money out", ["Payouts to agents, partners and owners", "Expenses with categories and receipt photos", "Repeat expenses (rent, salaries, internet) that add themselves every month"]],
      ["Instalments", ["Payment plans for buyers of units and land", "What is due, paid and late, per buyer"]],
      ["Reports", ["Expenses and profit by month", "Download as a spreadsheet for your auditor"]],
    ],
    soon: ["Full double-entry ledger with chart of accounts, trial balance and balance sheet"],
  },
  hrm: {
    what: "HRM (human resource management) is everything about your staff: who works for you, their roles, attendance and leave. Sheetal HRM replaces the attendance register and leave forms with check-in on the phone and approvals in one tap.",
    who: "Any business with staff, from 2 people to many branches.",
    problems: [
      ["Attendance on paper is easy to cheat and hard to count", "Staff check in and out on their phone; late arrivals and absences are worked out for you."],
      ["Leave requests on WhatsApp get lost", "Staff ask for leave in the app, managers approve or decline, and balances update by themselves."],
      ["Everyone can see everything", "Roles and permissions decide what each person can see and do, branch by branch."],
    ],
    features: [
      ["Team", ["Invite staff by email; each gets their own sign-in", "Ready roles for your type of business (manager, agent, accountant, front desk…) or your own", "Choose which branches each person can work in", "Preview the panel as any role before you give it"]],
      ["Attendance", ["Check in and out from the phone or computer", "Who is in, late, on leave or absent today", "Fix a record with a reason (the change is kept)", "Monthly attendance per person, as a spreadsheet"]],
      ["Leave", ["Your own leave types and yearly days", "Leave requests with approve and decline", "Balances that update by themselves"]],
      ["Hiring", ["Post jobs on Sheetal Property's Careers page", "A full application form with CV upload", "Review applications in one list"]],
    ],
    soon: ["Payroll: salary sheets, deductions, SSF and tax"],
  },
  property: {
    what: "Property management software is for looking after properties you rent out, for yourself or for owners. Sheetal Property Management keeps tenants, rent bills and agreements together, and lets tenants pay rent online.",
    who: "Agencies that manage rentals for owners, and owners with several flats, houses or shops.",
    problems: [
      ["Chasing rent every month by phone", "Rent bills are made every month, tenants pay online, and you see who has paid."],
      ["Agreements lost in files and drawers", "Rental and sale agreements made from templates, signed online and kept safe."],
      ["Owners keep asking how their property is doing", "Every property, tenant and payment is recorded, ready to show the owner."],
    ],
    features: [
      ["Rentals", ["Properties, units and tenants", "Monthly rent bills made by themselves", "Rent paid online (eSewa, Khalti, Fonepay) or recorded by hand", "Who paid and who is late"]],
      ["Agreements", ["Templates for rent, sale and service agreements", "Fill in the names and terms in a few clicks", "E-sign online: both sides sign from their phone", "Signed copies kept with the property"]],
    ],
  },
  hospitality: {
    what: "Hospitality software runs a hotel or homestay: rooms, bookings, the front desk and the bar. Sheetal Hospitality shows every reservation on one calendar, takes bookings from your Sheetal page, and bills the guest at checkout.",
    who: "Hotels, resorts, homestays and holiday home hosts.",
    problems: [
      ["Double bookings from different places", "One room calendar for all bookings, including the ones made on Sheetal Property."],
      ["Front desk bills written by hand", "Point of sale at the front desk adds room service and extras to the guest's bill."],
      ["Stock of drinks and supplies runs out without warning", "Stock goes down with every sale and shows what is running low."],
    ],
    features: [
      ["Reservations", ["Bookings from your Sheetal Property page, paid online", "Add walk-in and phone bookings by hand", "Room calendar with availability and prices", "Check-in, check-out and guest invoices"]],
      ["Front desk", ["Point of sale for extras, room service and the bar", "Charges go on the guest's room bill", "Stock of drinks and supplies"]],
      ["More guests", ["Your rooms on Sheetal Property's Stays", "Requests to list on travel channels, handled by Sheetal's team", "Guest reviews and your replies"]],
    ],
    soon: ["Restaurant: tables, kitchen orders and menus"],
  },
  projects: {
    what: "Project software is for developers building houses, apartments or plotted land. Sheetal Projects lists every project and unit, takes reservations, follows buyer instalments and shares building progress, and lets sponsors manage their investors.",
    who: "Housing and apartment developers, land plotters and investment sponsors.",
    problems: [
      ["Which units are free, reserved or sold?", "Every unit's status on one screen, updated the moment it is reserved."],
      ["Buyers keep calling to ask about progress", "Record construction progress for each project, ready to share with buyers."],
      ["Investor records spread over many files", "Offerings and investors in one place, with what each has put in."],
    ],
    features: [
      ["Projects and units", ["Projects with blocks, floors and units", "Unit prices, sizes and status (free, reserved, sold)", "Reservations taken from the website"]],
      ["Buyers", ["Instalment plans per buyer", "What is due, paid and late", "Construction progress updates"]],
      ["Investors", ["Investment offerings shown to investors on the website", "An investor register with their amounts", "Enquiries from investors in your inbox"]],
    ],
  },
  growth: {
    what: "Sheetal Promote helps more people see your listings. Feature a listing at the top of search, or put a banner on Sheetal Property's home page, and pay only for the days you choose.",
    who: "Any business that wants more views and more enquiries, fast.",
    problems: [
      ["Your best property gets lost among hundreds", "Featured listings show first in search and on the home page."],
      ["A new project needs attention now", "Home page banners for the days you pick."],
    ],
    features: [
      ["Promotion", ["Feature a listing at the top of search for the days you choose", "Home page banners with your picture", "Free featured spots included in some plans", "Move a boost to another listing for the days left", "Pay with eSewa, Khalti, Fonepay or bank transfer"]],
    ],
  },
};
