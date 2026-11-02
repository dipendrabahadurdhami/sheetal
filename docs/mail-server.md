# Sheetal mail server: setup on the VPS

The mail server (`mail-server/`) receives mail for every business domain on port 25 and sends the mail people
write in /business → Email. It shares the database with the APIs and hands incoming mail to the business API.

```
Internet ──25──▶ mail-server (receive) ──POST /v1/mail/inbound──▶ business API ──▶ database
database ──queued deliveries──▶ mail-server (send, DKIM-signed) ──25──▶ Gmail, Outlook, …
```

## 1. Before you start: things only your hosting provider can do

1. **Port 25 open, both ways.** Many providers (DigitalOcean, AWS, Hetzner for new accounts, many VPS sellers)
   block outgoing port 25 by default. Open a support ticket: "Please unblock outbound SMTP port 25 for a
   transactional mail server." Without it nothing can be sent.
2. **Reverse DNS (PTR) for the server's IP** set to the mail host name, e.g. `203.0.113.10 → mail.sheetalproperty.com`.
   Gmail and Outlook distrust mail from IPs without it. Set it in the provider's panel or ask support.
3. **A clean IP.** Check it at https://mxtoolbox.com/blacklists.aspx. If it is listed, ask for another IP.

## 2. DNS for Sheetal's own domain (once)

| Record | Name | Value |
|---|---|---|
| A | `mail.sheetalproperty.com` | the server's IP |
| MX | `sheetalproperty.com` | `10 mail.sheetalproperty.com` (only if Sheetal's own mail should arrive here too) |
| TXT | `sheetalproperty.com` | `v=spf1 a:mail.sheetalproperty.com ~all` |
| TXT | `_dmarc.sheetalproperty.com` | `v=DMARC1; p=quarantine; rua=mailto:postmaster@sheetalproperty.com` |

Each business adds its own records from /business → Settings → Domain and email; the page checks them.

## 3. TLS certificate (encryption between mail servers)

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d mail.sheetalproperty.com
```
Set `TLS_KEY_PATH=/etc/letsencrypt/live/mail.sheetalproperty.com/privkey.pem` and
`TLS_CERT_PATH=/etc/letsencrypt/live/mail.sheetalproperty.com/fullchain.pem`, give the mail user read access,
and restart the mail server after each renewal (`certbot` deploy hook: `systemctl restart sheetal-mail`).

## 4. Settings (`/etc/sheetal/mail.env`)

| Setting | Example | What it is |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | `postgresql://…` | Same database as the APIs |
| `SECRETS_KEY` | 32+ random characters | **Same value as the APIs**, so the server can read each domain's signing key |
| `MAIL_HOST` | `mail.sheetalproperty.com` | Must match the PTR record and the certificate; **same value as the business API** |
| `MAIL_INBOUND_SECRET` | 24+ random characters | **Same value as the business API** |
| `BUSINESS_API_URL` | `http://127.0.0.1:4001/v1` | Where incoming mail is handed over |
| `TLS_KEY_PATH`, `TLS_CERT_PATH` | see step 3 | |
| `SMTP_PORT` | `25` | |
| `MAX_MESSAGE_MB` | `40` | Biggest email accepted |
| `OUTBOUND_EVERY`, `OUTBOUND_BATCH` | `10`, `20` | How often (seconds) and how many to send per pass |

Make random values with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## 5. Run it

```bash
npm ci && npm run build -w @sheetal/mail-server
```
`/etc/systemd/system/sheetal-mail.service`:
```ini
[Unit]
Description=Sheetal mail server
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/sheetal/mail-server
EnvironmentFile=/etc/sheetal/mail.env
ExecStart=/usr/bin/node dist/server.js
# Lets a normal user listen on port 25
AmbientCapabilities=CAP_NET_BIND_SERVICE
User=sheetal
Restart=always

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now sheetal-mail
sudo ufw allow 25/tcp
```
Several copies can run at once (on more servers): each delivery is locked while it is being sent.

## 6. Test it

1. https://www.mail-tester.com: send an email to the address it shows from a business mailbox; aim for 9/10 or more.
2. Send to a Gmail address, open it → ⋮ → *Show original*: SPF, DKIM and DMARC should all say **PASS**.
3. Send from Gmail to a business mailbox; it should appear in /business → Email within seconds.

## 7. Build a good reputation (first 4 weeks)

A new server's mail often goes to spam until big providers trust its IP. To get there:
- Start small: a few dozen emails a day in week 1, then roughly double each week. Real conversations, not bulk mail.
- Register the domain and IP at **Google Postmaster Tools** and **Microsoft SNDS** to see how they rate you.
- Watch failures in the database (`mail_deliveries` with status `failed` or many `deferred`) and the server log.
- Never use this server for newsletters or marketing blasts; they would hurt every business's delivery.

## How it behaves

- **Receiving:** only addresses of active Sheetal mailboxes are accepted; anything else is refused straight away
  (it is never an open relay). Each message is checked with SPF, DKIM and DMARC: forged mail from a domain that
  asks for rejection is refused, other failures go to Spam. A business with no storage left gets "mailbox full,
  try later", so the sender's server keeps it and tries again.
- **Sending:** signed with the business domain's DKIM key, encrypted (STARTTLS) whenever the other server offers it.
  "Try later" answers are retried after 5, 15, 30 minutes, 1, 2, 4, 8, 12, 24 and 24 hours (about 3 days);
  a permanent "no", or a domain that doesn't exist, fails at once. The sender gets a "Not delivered" email in
  their inbox with the reason.

## Library versions

The mail libraries are pinned to exact versions that include the security fixes of October 2026
(`nodemailer` 10.1.7, `mailparser` 3.9.46, `smtp-server` 3.20.2, `mailauth` 8.0.0). `mailauth` still uses
`joi` 18.3.0, which has a slow-down bug only in a function used to check its own settings, not on incoming mail.
Review `npm audit` before each upgrade.
