// Get the apps (/app): Sheetal Property (everyone) and Sheetal Business (businesses) for Android (APK download), Windows (installer),
// iPhone (Safari → Add to Home Screen) and any computer (install from Chrome or Edge).
// How it works: the files and sizes come from /downloads/apps.json on the server, so a new version is only new files there. The button for
// this device comes first. "Install" uses the browser's own install prompt when it offers one.

import { useEffect, useState } from "react";
import { Smartphone, Monitor, Apple, Download, Building2, Home, Check, Share, PlusSquare, ShieldCheck } from "lucide-react";
import { useSEO } from "../utils/seo";

const device = () => {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  return "other";
};
const mb = (bytes) => (bytes ? `${Math.round(bytes / 1048576)} MB` : "");

const APPS = [
  { id: "customer", name: "Sheetal Property", icon: Home, img: "/brand/icon-192.png", web: "/", who: "For everyone",
    text: "Search homes, land, rentals, stays, projects and investments; save favourites, contact owners and post your property free." },
  { id: "business", name: "Sheetal Business", icon: Building2, img: "/business/brand/icon-192.png", web: "/business/", who: "For businesses",
    text: "Run your business on the go: leads and inbox, bookings, listings, invoices, team, jobs and more. By Sheetal Technologies." },
];

export function GetApp() {
  useSEO("Get the Sheetal apps", "Download Sheetal Property and Sheetal Business for Android and Windows, or add them to your iPhone.");
  const [files, setFiles] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [os] = useState(device);
  useEffect(() => {
    fetch("/downloads/apps.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then(setFiles).catch(() => setFiles(null));
    const h = (e) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  return (
    <div className="getapp">
      <section className="tech-hero">
        <div className="container" style={{ paddingTop: 48, paddingBottom: 48 }}>
          <span className="tier">Sheetal apps</span>
          <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", margin: "10px 0" }}>Sheetal on your phone and computer</h1>
          <p className="tech-lead">Two free apps: Sheetal Property for everyone, and Sheetal Business for the businesses that use Sheetal's software. They always show the newest version and work with your same account.</p>
        </div>
      </section>

      <section className="container section">
        <div className="getapp-grid">
          {APPS.map((a) => {
            const f = files?.[a.id] || {};
            const androidFirst = os === "android";
            const rows = [
              { k: "android", el: (
                <div className="getapp-row" key="android">
                  <Smartphone size={20} /><div className="getapp-t"><b>Android</b><small>{f.android ? `APK · ${mb(f.android.size)} · version ${f.android.version}` : "Coming soon"}</small></div>
                  {f.android ? <a className={`btn ${androidFirst ? "btn-primary" : "btn-outline"} btn-sm`} href={`/downloads/${f.android.file}`} download><Download size={15} /> Download</a> : null}
                </div>) },
              { k: "windows", el: (
                <div className="getapp-row" key="windows">
                  <Monitor size={20} /><div className="getapp-t"><b>Windows</b><small>{f.windows ? `Installer · ${mb(f.windows.size)} · version ${f.windows.version}` : "Coming soon"}</small></div>
                  {f.windows ? <a className={`btn ${os === "windows" ? "btn-primary" : "btn-outline"} btn-sm`} href={`/downloads/${f.windows.file}`} download><Download size={15} /> Download</a> : null}
                </div>) },
              { k: "ios", el: (
                <div className="getapp-row" key="ios">
                  <Apple size={20} /><div className="getapp-t"><b>iPhone and iPad</b><small>Open <a className="link" href={a.web}>{a.web === "/" ? "sheetalproperty.com" : "sheetalproperty.com/business"}</a> in Safari, tap <Share size={12} /> Share, then <PlusSquare size={12} /> Add to Home Screen.</small></div>
                </div>) },
            ];
            const order = os === "ios" ? ["ios", "android", "windows"] : os === "windows" ? ["windows", "android", "ios"] : ["android", "windows", "ios"];
            return (
              <div key={a.id} className="card getapp-card">
                <div className="row" style={{ gap: 14, alignItems: "center" }}>
                  <img src={a.img} alt="" width={64} height={64} style={{ borderRadius: 14, border: "1px solid var(--line)" }} />
                  <div className="stack" style={{ gap: 2 }}><span className="tier">{a.who}</span><h2 style={{ fontSize: 22 }}>{a.name}</h2></div>
                </div>
                <p className="small muted">{a.text}</p>
                <div className="getapp-rows">{order.map((k) => rows.find((r) => r.k === k).el)}</div>
                {/* The browser's own install offer is for the app of this page (Sheetal Property) only. */}
                {prompt && a.id === "customer" && <button type="button" className="btn btn-outline btn-block" onClick={() => { prompt.prompt(); setPrompt(null); }}><Download size={15} /> {os === "android" || os === "ios" ? "Or add it to your home screen (no download)" : "Install on this computer from the browser"}</button>}
              </div>
            );
          })}
        </div>

        <div className="getapp-help">
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <h3 style={{ fontSize: 18 }}><Smartphone size={18} /> Installing on Android</h3>
            <ol className="small" style={{ margin: 0, paddingLeft: "1.2em", lineHeight: 1.8 }}>
              <li>Tap <b>Download</b> and open the file when it finishes.</li>
              <li>If Android asks, allow your browser to <b>install unknown apps</b> (only this once).</li>
              <li>Tap <b>Install</b>, then <b>Open</b>. Sign in with your Sheetal account.</li>
            </ol>
            <p className="small muted" style={{ margin: 0 }}>The apps will also come to Google Play.</p>
          </div>
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <h3 style={{ fontSize: 18 }}><Monitor size={18} /> Installing on Windows</h3>
            <ol className="small" style={{ margin: 0, paddingLeft: "1.2em", lineHeight: 1.8 }}>
              <li>Download the installer and open it.</li>
              <li>If Windows shows "Windows protected your PC", click <b>More info</b>, then <b>Run anyway</b>.</li>
              <li>Follow the steps. The app is on your desktop and in the Start menu.</li>
            </ol>
          </div>
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <h3 style={{ fontSize: 18 }}><ShieldCheck size={18} /> Safe and always up to date</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: "1.2em", lineHeight: 1.8, listStyle: "none" }}>
              <li><Check size={13} /> Made by Sheetal Technologies, from sheetalproperty.com only.</li>
              <li><Check size={13} /> Always the newest version: nothing to update by hand.</li>
              <li><Check size={13} /> The same account, listings and data as the website.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
