// Posts Sheetal Property's own open jobs (November 2026 hiring round) on the Careers page.
// Run on the server from /srv/sheetal:  node scripts/ops/post-sheetal-jobs-2026-11.mjs          (dry run: shows what it would do)
//                                       node scripts/ops/post-sheetal-jobs-2026-11.mjs --apply  (writes)
// Safe to run again: each job is found by its slug and updated, never doubled. Applications already received are kept.
// Deadline: 26 Dec 2026 (one month from posting). The first job in the list shows first on the Careers page.

import { PrismaClient } from "@prisma/client";

const DEADLINE = new Date("2026-12-26T00:00:00Z");
const ul = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
const ABOUT = "<p>Sheetal Property is an established real estate company with years of experience in residential projects, land development, exclusive property sales, property management, rentals and real estate consulting.</p><p>We are entering a major phase of restructuring, professionalisation and growth. We are building a capable, commercially driven and independent team that takes ownership, generates revenue, strengthens relationships and makes Sheetal one of Nepal's leading real estate companies.</p>";
const EVERY_ROLE = `<h3>Important in every role</h3>${ul([
  "Ownership mentality and proactive execution",
  "Professional discipline and accountability",
  "Integrity, transparency and confidentiality",
  "Strong communication and problem-solving",
  "Willingness to learn and adapt quickly",
  "Comfort with technology, CRM and digital tools",
  "Willingness to take part in professional company content relevant to your role",
  "Long-term career ambition, not just another monthly salary",
])}<p>Real estate experience is preferred where relevant, but it is not required for exceptional people from other industries.</p>`;
const OFFER = (pay) => ul([
  pay,
  "Clearly defined responsibilities and measurable KPIs",
  "Structured 30, 60 and 90-day performance reviews",
  "We pay fairly for capability and reward generously for results: real earning and career growth for people who deliver",
]);

const JOBS = [
  {
    slug: "head-of-sales-business-development", title: "Head of Sales & Business Development", department: "Sales", vacancies: 1,
    location: "Kathmandu", experience: "5+ years, 2+ leading a sales team", salaryMin: 35000, salaryMax: 50000,
    form: { portfolio: "optional", references: "required", vehicle: false, camera: false },
    intro: "<p><b>Most urgent role.</b> We need a commercially aggressive but professionally mature leader who personally generates business, closes high-value transactions, develops new relationships and builds a high-performing sales team.</p><p>We do not want someone who only manages salespeople. We want someone who brings business personally and leads by example.</p><p>We are especially interested in high performers from automobile sales, banking, insurance, real estate, construction, corporate B2B sales, hospitality and other target-driven industries.</p>",
    responsibilities: [
      "Personally find, negotiate and close high-value property deals",
      "Win new clients, projects and business partnerships",
      "Build, coach and lead a high-performing sales team",
      "Run the sales pipeline in the CRM, with forecasts and performance reviews",
      "Join field sales, client meetings and negotiations yourself",
      "Build strong corporate, business and customer relationships",
    ],
    requirements: [
      "5+ years of proven sales and business development experience",
      "At least 2 years leading a sales team",
      "A proven history of meeting or beating sales targets",
      "Experience with high-value transactions, negotiation and closing",
      "Ability to acquire clients, projects and partnerships independently",
      "Experience with CRM, sales pipelines, forecasting and performance management",
      "Strong communication, presentation and leadership skills",
    ],
    pay: "Fixed salary NPR 35,000–50,000 a month, plus attractive performance commissions and incentives; negotiable for exceptional candidates",
  },
  {
    slug: "head-of-digital-growth-brand", title: "Head of Digital Growth & Brand", department: "Marketing", vacancies: 1,
    location: "Kathmandu", experience: "5+ years in digital marketing and growth", salaryMin: 50000, salaryMax: 70000,
    form: { portfolio: "required", references: "required", vehicle: false, camera: false },
    intro: "<p><b>Most urgent role.</b> Our goal is to make Sheetal one of Nepal's strongest real estate brands in digital visibility, organic website traffic, Google rankings, qualified leads and customer acquisition.</p><p>We are not looking for someone who only manages social media, makes content calendars or boosts posts. We need someone who builds and leads a complete digital growth system, and connects marketing to real business results.</p><p>Preferred backgrounds: fintech, e-commerce, telecom, technology companies, digital agencies, online marketplaces and established consumer brands. Success here can lead to running digital growth across our other group businesses.</p>",
    responsibilities: [
      "Own Sheetal's digital growth: SEO, paid ads, content and brand",
      "Grow organic traffic and Google rankings for sheetalproperty.com",
      "Build lead funnels, landing pages, retargeting and CRM integration",
      "Set up and read conversion tracking, GA4 and Search Console",
      "Improve website performance, conversion and marketing automation",
      "Lead the creative, content and digital marketing team",
      "Report marketing results in terms of leads, deals and revenue",
    ],
    requirements: [
      "5+ years of relevant digital marketing and growth experience",
      "Proven, measurable results in digital growth and customer acquisition",
      "Strong hands-on SEO, Meta Ads, Google Ads, GA4, Google Search Console and conversion tracking",
      "Experience in organic growth, brand positioning, content strategy and distribution",
      "Experience managing creative, content and digital teams",
      "Strong analytical, strategic and commercial thinking",
      "Knowledge of AI tools and marketing automation is an advantage",
    ],
    pay: "Fixed salary NPR 50,000–70,000 a month, plus substantial performance incentives; higher pay possible for exceptional proven talent",
  },
  {
    slug: "senior-sales-consultant", title: "Senior Sales Consultant", department: "Sales", vacancies: 3,
    location: "Kathmandu", experience: "2+ years in direct sales", salaryMin: 18000, salaryMax: 25000,
    form: { portfolio: "off", references: "optional", vehicle: true, camera: true },
    intro: "<p><b>Most urgent role, 2–3 openings.</b> We need confident, ambitious and commercially driven sales professionals who are motivated by results and by growing their earnings through performance.</p><p>People from automobile sales, banking, insurance, premium retail, corporate sales, education consultancies and other performance-driven industries are encouraged to apply. Experienced independent sales associates who prefer a higher commission-based model are also welcome under a separate commercial agreement.</p>",
    responsibilities: [
      "Turn enquiries and prospects into paying customers",
      "Find your own leads and keep customer relationships warm",
      "Visit sites, meet customers and follow up every day",
      "Present properties to customers and in company videos",
      "Keep the CRM and daily reports up to date",
    ],
    requirements: [
      "2+ years of direct sales experience",
      "Proven ability to convert prospects into paying customers",
      "Strong negotiation, persuasion and closing skills",
      "Comfortable with field visits, customer meetings and daily follow-ups",
      "Target-driven and disciplined with CRM and reporting",
      "Own two-wheeler and valid driving licence preferred",
      "Comfortable presenting properties and appearing in company videos",
    ],
    pay: "Fixed salary NPR 18,000–25,000 a month, plus attractive sales commissions (subject to applicable employment requirements)",
  },
  {
    slug: "business-head-general-manager", title: "Business Head / General Manager", department: "Leadership", vacancies: 1,
    location: "Kathmandu", experience: "8+ years, 3+ in senior leadership", salaryMin: 60000, salaryMax: 80000,
    form: { portfolio: "optional", references: "required", vehicle: false, camera: false },
    intro: "<p><b>Strategic leadership hire.</b> This role can take responsibility for the overall commercial performance and future growth of Sheetal Property.</p><p>We want someone who drives the business independently: builds teams, develops strategic relationships, finds opportunities and makes sure things get done without constant founder involvement. We are not looking for a purely administrative manager; we need a genuine business leader.</p><p>Open to exceptional people from established corporate houses, automobile companies, FMCG, financial services, hospitality, construction, real estate and other commercially driven organisations. This position will be filled for the quality of the person, not for speed.</p>",
    responsibilities: [
      "Own revenue, profitability and overall business performance",
      "Lead and coordinate all departments and teams",
      "Set up systems, performance targets and accountability",
      "Lead business development and key negotiations",
      "Manage budgets, cash flow and operational controls",
      "Find and develop new opportunities and strategic relationships",
    ],
    requirements: [
      "8+ years of commercial or business management experience",
      "At least 3 years in senior leadership or business-unit management",
      "Proven responsibility for revenue, profitability and business performance",
      "Experience managing several departments and teams",
      "Understanding of financial management, cash flow, budgeting and controls",
      "Shown ability to improve or scale a business",
      "Strong professional network, independent decision-making, integrity and entrepreneurial thinking",
    ],
    pay: "Fixed salary NPR 60,000–80,000 a month, plus performance incentives and possible profit-linked bonuses; negotiable for exceptional candidates",
  },
  {
    slug: "crm-business-performance-controller", title: "CRM & Business Performance Controller", department: "Operations", vacancies: 1,
    location: "Kathmandu", experience: "2+ years in CRM, MIS or sales operations", salaryMin: 22000, salaryMax: 30000,
    form: { portfolio: "optional", references: "optional", vehicle: false, camera: false },
    intro: "<p>You keep the business honest with numbers: you watch every enquiry, follow-up, site visit and deal, track each person's targets and deadlines, and point out gaps and missed opportunities before they cost us.</p>",
    responsibilities: [
      "Monitor customer enquiries, follow-ups, site visits, sales pipelines and conversions",
      "Track team targets, deadlines and execution",
      "Build reports and dashboards for management",
      "Find operational gaps, reporting mismatches and missed business",
    ],
    requirements: [
      "2+ years in CRM, MIS, sales operations, business analysis or performance monitoring",
      "Strong Excel, Google Sheets, reporting and dashboard skills",
      "Strong analytical skills and attention to detail",
      "High integrity, confidentiality and professional discipline",
    ],
    pay: "Fixed salary NPR 22,000–30,000 a month, plus performance incentives",
  },
  {
    slug: "customer-relationship-executive", title: "Customer Relationship Executive (CSR)", department: "Customer relations", vacancies: 2,
    location: "Kathmandu", experience: "1+ year preferred", salaryMin: 17000, salaryMax: 22000,
    form: { portfolio: "off", references: "optional", vehicle: false, camera: true },
    intro: "<p>You are the first voice our customers hear. You understand what they need, book their visits and meetings, follow up with care, and bring old customers back.</p>",
    responsibilities: [
      "Answer and qualify customer enquiries and understand their needs",
      "Schedule site visits and appointments with the sales team",
      "Follow up with discipline and keep the CRM up to date",
      "Reactivate old customer lists and spot new opportunities",
    ],
    requirements: [
      "1+ year in customer service, telecalling, relationship management or lead handling preferred",
      "Excellent Nepali and good English",
      "Comfortable using CRM, Excel and Google Sheets",
      "Confident communication and willingness to appear in company videos",
    ],
    pay: "Fixed salary NPR 17,000–22,000 a month, plus performance incentives (subject to applicable employment requirements)",
  },
  {
    slug: "content-host-video-coordinator", title: "Content Host & Video Coordinator", department: "Content", vacancies: 2,
    location: "Kathmandu or Chitwan", experience: "Content or presenting experience preferred", salaryMin: 20000, salaryMax: 30000,
    form: { portfolio: "required", references: "optional", vehicle: true, camera: true },
    intro: "<p><b>Two openings: one in Kathmandu and one in Chitwan.</b> You will be one of the public faces of Sheetal: presenting properties, projects and places on camera, and making sure great videos get made and published.</p><p>Please include a video portfolio or presenting samples; applications without them can't be considered.</p>",
    responsibilities: [
      "Host and present property, project and business videos",
      "Write hooks, scripts and story ideas that keep people watching",
      "Visit properties, projects and locations for shoots",
      "Coordinate videographers, editors and the publishing plan",
      "Create short videos for Facebook, Instagram, TikTok and YouTube",
    ],
    requirements: [
      "Experience in content creation, hosting, presenting or social media preferred",
      "Excellent on-camera confidence, energy and communication",
      "Understanding of short-form video",
      "Own two-wheeler and valid driving licence preferred",
      "A video portfolio or presenting samples (required)",
    ],
    pay: "Fixed salary NPR 20,000–30,000 a month, plus performance incentives",
  },
];

const apply = process.argv.includes("--apply");
const db = new PrismaClient();
try {
  const now = Date.now();
  for (const [i, j] of JOBS.entries()) {
    const data = {
      title: j.title, department: j.department, jobType: "full_time", location: j.location, remote: false, experience: j.experience,
      salaryMin: j.salaryMin, salaryMax: j.salaryMax, showSalary: true, vacancies: j.vacancies,
      description: j.intro + ABOUT, responsibilities: ul(j.responsibilities), requirements: ul(j.requirements) + EVERY_ROLE, benefits: OFFER(j.pay),
      deadline: DEADLINE, status: "open", review: "approved", form: j.form,
    };
    const old = await db.jobPost.findUnique({ where: { slug: j.slug }, select: { id: true, tenantId: true } });
    if (old?.tenantId) { console.log(`SKIP ${j.slug}: that address belongs to a business's job`); continue; }
    console.log(`${old ? "UPDATE" : "CREATE"} ${j.title} · ${j.vacancies} · NPR ${j.salaryMin}-${j.salaryMax} · ${JSON.stringify(j.form)}`);
    if (!apply) continue;
    // The first job is the newest, so the list shows the most urgent roles first.
    const createdAt = new Date(now - i * 60_000);
    if (old) await db.jobPost.update({ where: { id: old.id }, data });
    else await db.jobPost.create({ data: { ...data, slug: j.slug, createdAt } });
  }
  console.log(apply ? "Done." : "Dry run only. Add --apply to write.");
} finally {
  await db.$disconnect();
}
