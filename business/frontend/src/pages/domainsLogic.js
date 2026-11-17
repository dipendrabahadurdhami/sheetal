// Small helpers for Settings → Domain and email (business/frontend/src/pages/Domains.jsx).
// How it works: most domain providers want only the front part of a record's name in their "Name" box, so we show that part next to the full name.
// Rules: "@" stands for the domain itself; a host that is not under the domain is returned unchanged.

/** The part to type in the "Name" box of most domain providers. */
export const shortName = (host, domain) => (host === domain ? "@" : host.endsWith(`.${domain}`) ? host.slice(0, -(domain.length + 1)) : host);
