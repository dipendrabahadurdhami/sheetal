-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "manager" TEXT,
    "receipt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_name_key" ON "branches"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every business starts with a head office, plus any branch its rooms or team access already name.
INSERT INTO "branches" ("id", "tenant_id", "name", "sort")
SELECT gen_random_uuid()::text, "id", 'Head office', 0 FROM "tenants";
INSERT INTO "branches" ("id", "tenant_id", "name", "sort")
SELECT gen_random_uuid()::text, x."tenant_id", x."name", 1 FROM (
  SELECT DISTINCT "tenant_id", "branch" AS "name" FROM "rooms" WHERE "branch" IS NOT NULL AND "branch" <> ''
  UNION
  SELECT DISTINCT "tenant_id", jsonb_array_elements_text("scopes") FROM "memberships" WHERE jsonb_typeof("scopes") = 'array'
) x
ON CONFLICT ("tenant_id", "name") DO NOTHING;
