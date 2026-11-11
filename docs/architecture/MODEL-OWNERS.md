# Which app owns each database model (Lead decision, 10 Nov 2026; kept up to date with every new model)

Used by P1-OPS-2 (writes the `/// @app <id>` tag above every model in `schema.prisma` and the real
`scripts/check-schema-ownership.mjs`) and P1-BE-2 (lists the same models in each manifest's `models`, and the ones with a
`branchId` in `branchOwned`). Both tasks use THIS table, so the tags and the manifests agree when both are merged.
App ids are the 15 manifests of APP-MANIFEST.md section 8. Tags are comments: changing an owner later costs nothing.
Already tagged by P1-DB-1: Tenant, Review, Expense, RecurringExpense, EventOutbox, EventDelivery (unchanged below).
If the code clearly says a model belongs elsewhere (e.g. only one module ever uses it), do NOT change it: list it under
"Disagreements" in your CHANGES and the Lead decides.

| App id | Models | With `branchId` (go in `branchOwned`) |
|---|---|---|
| platform | AppSetting, User, Session, EmailToken, Plan, OutboundEmail, AuditLog, UpgradeRequest, VerificationDoc, SupportTicket, SupportMessage, BlogCategory, BlogPost, BlogComment, JobPost, JobApplication, Invoice, Payment, AiUsage, PageView, BotDay, TenantAddon, Boost, Banner, ReminderLog, EventOutbox, EventDelivery, ImpersonationSession | EventOutbox (`branchId` is only a label there: **leave it out of `branchOwned`**, events never block a branch delete) |
| workspace | Tenant, Branch, Role, Membership, MembershipBranch, Invite, InviteBranch, ApprovalRule, ApprovalRequest, Notification, ApiKey, DocCounter, MailDomain, Mailbox, MailboxAccess, MailMessage, MailAttachment, MailDelivery, ChannelAccount, MessageTemplate, Form, FormResponse | Form (MembershipBranch / InviteBranch have `branchId` but are links: left out, like EventOutbox; ApprovalRequest (`branchId` is only a label: leave it out of `branchOwned`)) |
| expenses | Expense, RecurringExpense | Expense, RecurringExpense |
| reviews | Review | – |
| listings | Listing, ListingPhoto, ListingReview, Favourite, DemandMatch | Listing, ListingReview |
| crm | Lead, LeadMessage | Lead |
| hotel | Room, RoomRule, RateDay, Booking, FolioLine, GuestPayment, OtaFeed, OtaRequest, OtaAccount | Room, RoomRule, RateDay, Booking, OtaRequest |
| pos | MenuItem, Shift, PosBill, StockItem, StockMove, StockRecipe | MenuItem, Shift, PosBill, StockItem, StockMove |
| projects | Unit, Reservation | – |
| collections | Collection | – |
| investments | Commitment, InvestmentUpdate | – |
| invoicing | BizInvoice, BizReceipt, Payout, PayoutItem | BizInvoice, Payout, PayoutItem |
| rentals | RentOwner, RentUnit, RentLease, RentBill, RentPayment, RentRepair, OwnerStatement | all seven |
| agreements | Agreement, AgreementSigner | Agreement |
| people | Attendance, LeaveType, LeaveRequest | Attendance, LeaveRequest |

Total: 96 models, each in exactly one row (MembershipBranch and InviteBranch added by P1-DB-2; ApprovalRule, ApprovalRequest, ImpersonationSession added by P1-DB-3).
