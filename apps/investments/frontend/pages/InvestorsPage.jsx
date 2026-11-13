// Investors page (sponsors): offerings, pledges, paid or refunded, and updates emailed to investors.
// Where it fits: Business → Investors, through LiveOps.jsx which re-exports it as LiveInvestors.
// How it works: moved from business/frontend/src/pages/LiveOps.jsx (P2-W3) onto the kit (@sheetal/ui, @sheetal/sdk); the server keeps every rule.
// Rules: buttons show only for roles that may use them (the server checks again).

import React, { useEffect, useState } from "react";
import { fdatetime, rs } from "@sheetal/shared/core/format";
import { can } from "@sheetal/shared/core/rbac";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Table, Textarea, useToast } from "@sheetal/ui/primitives";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";

/** One GET on the kit: [data, reload]; loads again when the business, the branch picked at the top or reload() change (null while loading or after an error). */
function useApi(path) {
  const toast = useToast();
  const { data, error, refresh } = useApiGet(path);
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  return [error ? null : data, refresh];
}
const run = (toast, p, after) => p.then((r) => { if (r?.message) toast(r.message); after?.(r); return r; }).catch((e) => { toast(e.message); throw e; });

export function InvestorsPage({ tenant, role }) {
  const toast = useToast();
  const [list, reload] = useApi("/investments");
  const [add, setAdd] = useState(null);
  const [post, setPost] = useState(null);
  if (!list) return <p className="muted pf-pad">Loading…</p>;
  return (
    <>
      <PageHead title="Investors" sub="Pledges, payments and updates for each investment." />
      {!list.length ? <Empty icon="hand-coins" title="No investment listings yet">Post an investment from Listings first.</Empty> : list.map((inv) => (
        <Panel key={inv.id} title={inv.title} sub={`${inv.code} · raised ${rs(inv.paid)} paid, ${rs(inv.pledged)} pledged${inv.target ? ` of ${rs(inv.target)}` : ""}`}
          actions={<>{can(role, "investments.update.create") && <Button size="sm" variant="outline" icon="send" onClick={() => setPost({ id: inv.id, title: "", body: "" })}>Post update</Button>}{can(role, "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete") && <Button size="sm" icon="plus" onClick={() => setAdd({ id: inv.id, name: "", email: "", phone: "", amount: "" })}>Add investor</Button>}</>}>
          <Table rows={inv.investors} minWidth={600} empty={<Empty icon="users" title="No investors yet" />} columns={[
            { key: "n", label: "Investor", render: (c) => <span className="pf-two"><b>{c.name}</b><small>{[c.email, c.phone].filter(Boolean).join(" · ")}</small></span> },
            { key: "a", label: "Amount", num: true, align: "right", render: (c) => rs(c.amount) },
            { key: "s", label: "Status", render: (c) => <Badge tone={{ pledged: "action", paid: "done", refunded: "neutral" }[c.status]}>{c.status}</Badge> },
            { key: "x", label: "", align: "right", render: (c) => can(role, "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete") && c.status === "pledged" && <Button size="sm" onClick={() => { const ref = window.prompt("Payment reference (optional)") ?? undefined; run(toast, bizApi("PATCH", `/commitments/${c.id}`, { status: "paid", ref: ref || undefined }), reload).catch(() => {}); }}>Mark paid</Button> },
          ]} />
          {inv.updates.length > 0 && <ul className="pf-list">{inv.updates.slice(0, 3).map((u) => <li key={u.id}><span className="pf-two"><b>{u.title}</b><small className="muted">{fdatetime(u.at)}</small></span></li>)}</ul>}
        </Panel>))}
      <Drawer open={!!add} onClose={() => setAdd(null)} title="Add investor" footer={add && <><Button variant="ghost" onClick={() => setAdd(null)}>Cancel</Button><Button disabled={!add.name || !add.amount} onClick={() => run(toast, bizApi("POST", `/investments/${add.id}/commitments`, { name: add.name, email: add.email || undefined, phone: add.phone || undefined, amount: Number(add.amount) }), () => { setAdd(null); reload(); }).catch(() => {})}>Add</Button></>}>
        {add && <div className="pf-stack"><Field label="Name"><Input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field><Field label="Email"><Input value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></Field><Field label="Amount pledged (Rs.)"><Input className="input tnum" value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value.replace(/\D/g, "") })} /></Field></div>}
      </Drawer>
      <Drawer open={!!post} onClose={() => setPost(null)} title="Update for investors" sub="Emailed to every investor with an email address." footer={post && <><Button variant="ghost" onClick={() => setPost(null)}>Cancel</Button><Button disabled={post.title.length < 3 || post.body.length < 10} onClick={() => run(toast, bizApi("POST", `/investments/${post.id}/updates`, { title: post.title, body: post.body }), () => { setPost(null); reload(); }).catch(() => {})}>Send</Button></>}>
        {post && <div className="pf-stack"><Field label="Title"><Input value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} /></Field><Field label="Update"><Textarea rows={8} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} /></Field></div>}
      </Drawer>
    </>
  );
}
