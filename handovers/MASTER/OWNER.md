# The owner and their decisions

## How to work with the owner
- Dipendra, owner of Sheetal Property (Kathmandu). Works on Windows, VS Code, PowerShell; project at `C:\Users\USER\Desktop\sheetal`.
- English is a second language: short sentences, plain words, numbered steps, ONE step at a time. Too much at once confuses.
- Wants speed ("we are late, many phases remain") AND a quality product. No separate QA any more: you check everything yourself.
- Always attach files you mention. Give progress as percentages.
- Never ask for or type the owner's real password. Test accounts only, password from `test-accounts.csv`, never written in chat.
- Hand tests: the owner does them in their Chrome and sends screenshots (the built-in browser pane can't reach localhost).

## Product decisions (fixed: build around them, do not reopen)
- Sheetal becomes a SaaS **marketplace of separate apps** (CRM, HR/People, payroll, accounting/invoicing, POS, rentals, hotel, restaurant,
  expenses, reviews, ...), reused across business types. Each business subscribes per app.
- **Starter / Business / Pro plans are removed.** A **free-forever tier** (no card) with free limits per app; upgrades as they grow.
- Website posting is free; unverified posters are reviewed by the super admin, verified ones publish directly; the public site never
  shows "verified".
- Every app is **AI-powered**: Sheetal AI subscription, or the business's own OpenAI / Gemini / Claude / ElevenLabs key.
- **Two separate payment systems:** Sheetal's own (website, subscriptions, and rent for properties Sheetal manages: today collected offline,
  to move online through Sheetal's gateways) and each business's own (a free static QR first; integrated gateways after a document-checked
  onboarding request), used only inside that business's apps. Bank card gateway (Siddhartha Bank / Global IME Bank) is in the legal process;
  eSewa, Khalti, Fonepay exist.
- All integrations (payments, SMS, WhatsApp, AI, social, delivery partners Pathao / Foodmandu / Yango, IRD) are set up by the super admin:
  enter details, test, then go live.
- Sheetal markets the apps and earns a **commission** on each sale (plus a technology partner share: SETTINGS.md section 6).
- Prices, free limits, trials, required business info, legal pages and other content are **editable in the super admin panel** without code.
- Public brand: **Sheetal Property** only. The tech/support company behind it (DhamiPlus) and internal details such as PAN are never shown publicly.

## Phase 3 answers (13 Nov 2026, 20:30): the owner accepted all five recommendations
1. At a free limit: **per limit**. New records hard stop; money-in (POS bills, invoices) soft to +20% then stop; storage and AI warn at 80%, stop at 100%.
2. Today's businesses: **paid period + 12 months** at today's price and access, renewal at the lower of old and new price; free businesses keep today's limits **90 days**.
3. Commission: **split per app** (sale without VAT = Sheetal commission % per app + publisher part); partner share is a % of commission; default 100% until entered.
4. Free AI: **no monthly credits** for new free businesses; **100 one-time credits** in a 14-day trial; existing businesses keep credits during their lock.
5. Prices: **MB section 3.4 table, VAT included, yearly = 10 months** (all editable in Admin -> Pricing).
