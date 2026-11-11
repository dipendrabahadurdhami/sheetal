# CHANGES P2-W1-S1: Rentals on the kernel (apps/rentals/backend)

## What changed
Rentals' server code (owners, units, leases, bills, payments, repairs, owner statements, the monthly bill job) now lives in `apps/rentals/backend` and runs on the kernel
(repositories, services with permission → one transaction { change, audit line, event }, `refuseReadOnly` first, optional `version` → 409). The answers, paths, messages and
audit action strings are the old ones. The old `rentals.test.ts` is not edited and should pass as it is.

## Files (all FULL files, at repo paths)
New, `apps/rentals/backend/`: `rentals.ts` (pure rules), `types.ts`, `schemas.ts`, `events.ts`, `scope.ts`, `host.ts`, `rental.repository.ts`, `owner|unit|lease|bill|payment|repair|statement.repository.ts`,
`bills.ts` (the generator), `jobs.ts` (job `rentals.bills`), `rental.service.ts`, `owner|unit|lease|bill|repair|statement.service.ts`, `presenter.ts`, `rental.controller.ts`, `routes.ts`, `rentpay.ts` (moved), `index.ts`,
`test/pure.test.ts`.
New/changed in the app folder: `apps/rentals/package.json`, `tsconfig.json`, `vitest.config.js`, `app.manifest.ts` (my own app's manifest, edited as allowed: header comment, 22 `events.publishes`, `dependencies.reads: ["Listing"]`, `jobs: [rentals.bills, every 6h]`).
Shims (each only re-exports): `backend-core/src/domain/rentals.ts`, `backend-core/src/domain/rentpay.ts`, `business/backend/src/modules/rentals/routes.ts`.
`business/backend/src/app.ts`: only the rentals import line and its register line.
New test: `business/backend/test/rentals-kernel.test.ts`.

**Registration:** a new route does nothing until it is registered. `app.ts` now has `await app.register(rentalRoutes, { prefix: "/v1", contextOf: businessContextOf });` with `rentalRoutes` imported from `@sheetal/app-rentals/backend`. `business/backend/src/jobs.ts` is not touched (it still imports `rentJob` through the shim).

## Lines for the Lead (I did not touch these)
1. **Schema** (`backend-core/prisma/schema.prisma`), kernel columns on the 7 tables. Needed before the kernel code works (it reads `version` and `deleted_at`). Copy of my working edit: `schema-lines-P2-W1-S1.diff` in this zip.
   - `rent_owners`, `rent_units`, `rent_bills`: add `createdBy String? @map("created_by")`.
   - all 7 (`rent_owners`, `rent_units`, `rent_leases`, `rent_bills`, `rent_payments`, `rent_repairs`, `owner_statements`): `updatedBy String? @map("updated_by")`, `version Int @default(1)`, `deletedAt DateTime? @map("deleted_at")`, `deletedBy String? @map("deleted_by")`.
   - `rent_payments`: also `updatedAt DateTime @default(now()) @updatedAt @map("updated_at")`.
2. **Migration SQL** (additive, no row changed; run `prisma migrate diff` afterwards, it must be empty):
```sql
ALTER TABLE "rent_owners" ADD COLUMN "created_by" TEXT, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_units"  ADD COLUMN "created_by" TEXT, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_bills"  ADD COLUMN "created_by" TEXT, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_leases" ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_repairs" ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "owner_statements" ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_payments" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
```
   Suggested folder name: `<next timestamp>_rentals_kernel_columns`. Check the SQL against what `prisma migrate dev --create-only` writes; use Prisma's if they differ.
3. **Paisa (proposal for a later step, nothing in this stage needs it):** add `<field>Paisa BigInt? @map("<field>_paisa")` for rent, deposit, deposit_returned (leases/units rent), amount, late_fee, paid (bills), amount (payments), cost (repairs), collected, fee, repairs, payable (statements), with a backfill like `expenses_paisa_resync`. Events already carry paisa.
4. **`business/backend/package.json`:** add dependency `"@sheetal/app-rentals": "*"` (the Expenses app has the same line). **Root `package.json`:** add `apps/rentals` to the test and typecheck workspace lists, like `apps/expenses`.
5. **`npm run gen:permissions`:** the manifest now lists events/jobs/reads, so `apps.generated.ts` is out of date (`check-manifests` rule 7 and `gen-permissions --check` say so; this is expected). The generator also shows some ApprovalRule/ApprovalRequest lines that come from Phase 1, not from me.

## Deviations (please look at these)
- **Real deletes** (not soft delete) for owner, unit, payment and statement. Other code reads these tables directly (branch closing, profit, website and admin rent pages) and would show deleted rows. The tables get `deleted_at` anyway, and the kernel hides any row that has it. Each is a named method (`remove`/`discard`) with a header comment. To switch to soft delete later, change the repository and those readers together.
- `rentpay.ts` (moved) still has its own confirm/reject path for the website/admin APIs; it now bumps `version`/`updatedBy` on its raw writes. The business routes use `PaymentService.confirm/reject`; both count a payment once (compare-and-set on `pending`).
- `canManage` on the page = the person may update; `can` and `version` are new, harmless extra fields on rows (old screens ignore them).
- Phase 1 scope cap (`scope.ts`): scope is never wider than "branch", as the old code was. Old words "Your role can't see rentals." / "Your role can't change rentals." are kept.

## Commands (PowerShell, in the repo root)
```powershell
Expand-Archive -Force .\OUT-P2-W1-S1.zip -DestinationPath .
# apply the schema lines + migration (Lead step 1-2), then:
npm install
npm run gen:permissions
npx prisma generate --schema backend-core/prisma/schema.prisma
npm run check
npm run test -w @sheetal/app-rentals
npm run test -w @sheetal/business-api
```

## What I ran, and what I could not
- Ran: `tsc --noEmit` for apps/rentals, business/backend, admin/backend, website/backend and the root; ESLint on the app and the new test (clean); `check-boundaries` and schema-ownership (ok); `apps/rentals` pure tests: 19 passed.
- Could NOT run: any PostgreSQL test (no database engine here). `business/backend/test/rentals-kernel.test.ts` and the old `rentals.test.ts` / `expenses.test.ts` / profit tests are unrun; CI is their first run. The `schema.prisma` edit was only used to generate types here and is NOT in the zip.
- `gen-permissions --check` fails only with the expected "apps.generated.ts out of date".
