# Payments: what Sheetal needs to switch them on

The code for eSewa, Khalti, Fonepay and bank transfer is in place (`backend-core/src/lib/payments.ts`,
`business/backend/src/modules/billing`, `admin/backend/src/modules/billing.ts`). Keys are entered in
**Admin → Billing → Settings** by the super admin. They are stored encrypted and never shown again.

| Method | What to get | Where it goes |
|---|---|---|
| eSewa | A merchant account from eSewa: the **merchant (product) code** and **secret key**. | eSewa: mode Live, code, secret. Until then, eSewa's public test merchant (EPAYTEST) works on your computer only, never in production. |
| Khalti | A Khalti merchant account: the **test secret key** first, then the **live secret key**. | Khalti: mode Test, secret. Try a payment, then switch to Live. |
| Fonepay | A Fonepay merchant: the **merchant code (PID)** and **secret key**, and their web-payment integration guide. | Fonepay: mode Test, code, secret. Built from Fonepay's merchant request spec (HMAC-SHA512 over the request and response fields); confirm a test payment with Fonepay before going live. |
| Bank transfer | Sheetal's bank name, account name and account number. | Admin → Billing → Settings → Billing. Businesses upload a receipt; confirm it under Payments. |

How a payment is accepted: the payer pays on the gateway's own page; when they come back, the result's signature
is checked, then the gateway's status API is asked directly, and the amount and payment id must match the invoice.
Only then is the invoice paid and the plan applied. Coming back twice changes nothing.

Refunds are made in the gateway's or bank's own portal; record them in Admin → Billing → Payments.
