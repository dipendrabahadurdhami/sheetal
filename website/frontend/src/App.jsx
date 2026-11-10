// The website's pages and routes, inside the shared header, footer and tab bar.
// How it works: one route per page; /business and /admin are separate apps, so links there do a full page load.
// A business's online form (/f/:slug) and the agreement signing page (/sign/:token) open on their own, without the
// site header and footer. The main site sits inside SiteGate (Google tags and the maintenance page).

import PlatformApp from "./market/PlatformApp";
import { config as platformConfig } from "@sheetal/shared/core/config";
platformConfig.embedPublic = true;
// /admin and /business are separate apps: links there do a full page load
platformConfig.owns = (p) => !/^\/(admin|business)(\/|$)/.test(p);
import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { Header, Footer, TabBar, SourceBadge, WhatsAppButton } from "./components/Layout";
import { AuthModal } from "./components/AuthModal";
import { Onboarding } from "./components/Onboarding";
import { SiteGate } from "./components/SiteGate";
import Home from "./pages/Home";
import Listings from "./pages/Listings";
import PropertyDetail from "./pages/PropertyDetail";
import ListingDetail from "./pages/ListingDetail";
import Partners from "./pages/Partners";
import AgencyProfile from "./pages/AgencyProfile";
import Plans from "./pages/Plans";
import Profile from "./pages/Profile";
import PostProperty from "./pages/PostProperty";
import { Blog, BlogPost } from "./pages/Blog";
import { Careers, JobDetail } from "./pages/Careers";
import Services from "./pages/Services";
import { HomeLoan, LegalHelp, LegalService, PropertyManagement, ManagementService, PayRent, Valuation } from "./pages/ServicePages";
import RatesTrends from "./pages/RatesTrends";
import { Project, Gallery } from "./pages/InvestHub";
import MapSearch from "./pages/MapSearch";
import Catalog from "./pages/Catalog";
import { VerifyEmail, ResetPassword } from "./pages/Account";
import Tools from "./pages/Tools";
import About from "./pages/About";
import { Requirement, Demands, DemandDetail } from "./pages/Requirement";
import { Legal, NotFound } from "./pages/Static";
import PublicForm from "./pages/PublicForm";
import SignAgreement from "./pages/SignAgreement";

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}
const To = ({ to }) => <Navigate to={to} replace />;
const InvestDetail = () => <Navigate to="/investment" replace />;

// Old URLs from the current site keep working.
const LEGACY = [
  ["/homeLone", "/services/home-loan"], ["/homeLone/applyOnline", "/services/home-loan/apply"], ["/payRentOnline", "/services/pay-rent"],
  ["/LegalHelp", "/services/legal-help"], ["/rateandtrend", "/rates-and-trends"], ["/investment/export", "/investment/explore"],
  ["/investment/viewallproduct", "/investment"], ["/galery", "/gallery"], ["/propertyDemand", "/property-demand"], ["/requirementForm", "/requirement"],
  ["/productSearch", "/search"], ["/About", "/about"], ["/ShetalLeadExtractor", "/business/inbox?extract=1"], ["/lead-extractor", "/business/inbox?extract=1"], ["/my-profile/messages", "/my-profile?tab=messages"],
  ["/tools/unit-converter", "/tools/units"], ["/tools/emi-calculator", "/tools/emi"], ["/tools/roi-calculator", "/tools/roi"],
  ["/tools/land-estimator", "/tools/land-price"],
];

// agency workspaces open the agency profile (one profile layout for every agency)
const AGENCY_OF_TENANT = { t3: 1, t7: 2, t11: 3 };
function SiteOrAgency() { const { tid } = useParams(); return AGENCY_OF_TENANT[tid] ? <Navigate to={`/agency/${AGENCY_OF_TENANT[tid]}`} replace /> : <PlatformApp />; }

// old /agent/:id links keep working
function OldAgencyLink() { const { id } = useParams(); return <Navigate to={`/agency/${id}`} replace />; }

export default function App() {
  const { pathname } = useLocation();
  const bare = pathname === "/map";
  if (/^\/(admin|business)(\/|$)/.test(pathname)) return <PlatformApp />;
  if (/^\/f\/[^/]+\/?$/.test(pathname)) return <Routes><Route path="/f/:slug" element={<PublicForm />} /></Routes>;
  if (/^\/sign\/[^/]+\/?$/.test(pathname)) return <Routes><Route path="/sign/:token" element={<SignAgreement />} /></Routes>;
  return (
    <SiteGate>
      <ScrollTop />
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sale" element={<Listings purpose="sale" />} />
          <Route path="/rent" element={<Listings purpose="rent" />} />
          <Route path="/investment" element={<Catalog kind="invest" />} />
          <Route path="/investment/explore" element={<Catalog kind="invest" />} />
          <Route path="/investDetail/:id" element={<InvestDetail />} />
          <Route path="/search" element={<Listings purpose="search" />} />
          <Route path="/properties" element={<Listings purpose="search" />} />
          <Route path="/map" element={<MapSearch />} />
          <Route path="/property/:id" element={<PropertyDetail />} />
          <Route path="/listing/:id" element={<ListingDetail />} />
          <Route path="/featured" element={<Project />} />
          <Route path="/project" element={<Catalog kind="project" />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/agencies" element={<Navigate to="/partners?type=agency" replace />} />
          <Route path="/agents" element={<Navigate to="/partners?type=agency" replace />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/become-agency" element={<Plans />} />
          <Route path="/become-agent" element={<Navigate to="/become-agency" replace />} />
          <Route path="/agency/:id" element={<AgencyProfile />} />
          <Route path="/agent/:id" element={<OldAgencyLink />} />
          <Route path="/my-profile" element={<Profile />} />
          <Route path="/post-property" element={<PostProperty />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/category/:slug" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/careers" element={<Careers />} />
          <Route path="/careers/:slug" element={<JobDetail />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/home-loan" element={<HomeLoan />} />
          <Route path="/services/home-loan/apply" element={<HomeLoan apply />} />
          <Route path="/services/legal-help/:slug" element={<LegalService />} />
          <Route path="/services/legal-help" element={<LegalHelp />} />
          <Route path="/services/management/:slug" element={<ManagementService />} />
          <Route path="/services/management" element={<PropertyManagement />} />
          <Route path="/services/pay-rent" element={<PayRent />} />
          <Route path="/services/valuation" element={<Valuation />} />
          <Route path="/rates-and-trends" element={<RatesTrends />} />
          <Route path="/tools/:tool" element={<Tools />} />
          <Route path="/about" element={<About />} />
          <Route path="/requirement" element={<Requirement />} />
          <Route path="/property-demand" element={<Demands />} />
          <Route path="/property-demand/:id" element={<DemandDetail />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/privacy-policy" element={<Legal kind="privacy" />} />
          <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
          <Route path="/terms-and-conditions" element={<Legal kind="terms" />} />
          <Route path="/data-deletion" element={<Legal kind="deletion" />} />
          {LEGACY.map(([from, to]) => <Route key={from} path={from} element={<To to={to} />} />)}
          <Route path="/stays" element={<Catalog kind="stay" />} />
          <Route path="/stays/:id" element={<PlatformApp />} />
          <Route path="/project/:id" element={<PlatformApp />} />
          <Route path="/investment/:id" element={<PlatformApp />} />
          <Route path="/partners" element={<Partners />} />
          <Route path="/partners/:id" element={<PlatformApp />} />
          <Route path="/site/:tid" element={<SiteOrAgency />} />
          <Route path="/site/*" element={<PlatformApp />} />
          <Route path="/book/:id" element={<PlatformApp />} />
          <Route path="/reserve/:id" element={<PlatformApp />} />
          <Route path="/invest/:id" element={<PlatformApp />} />
          <Route path="/account" element={<Navigate to="/my-profile?tab=orders" replace />} />
          <Route path="/saved" element={<Navigate to="/my-profile?tab=saved" replace />} />
          <Route path="/request" element={<PlatformApp />} />
          <Route path="/pay/:code" element={<PlatformApp />} />
          <Route path="/offers" element={<PlatformApp />} />
          <Route path="/offers/:slug" element={<PlatformApp />} />
          <Route path="/explore-map" element={<Navigate to="/map" replace />} />
          <Route path="/help/:topic" element={<PlatformApp />} />
          <Route path="/legal/:page" element={<PlatformApp />} />
          <Route path="*" element={<NotFound />} />
      </Routes>
      </main>
      {!bare && <Footer />}
      <TabBar />
      <SourceBadge />
      {!bare && <WhatsAppButton />}
      <AuthModal />
      <Onboarding />
    </SiteGate>
  );
}