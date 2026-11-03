-- CreateTable
CREATE TABLE "rate_days" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "room_type" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "rate" INTEGER,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rate_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "room_type" TEXT NOT NULL,
    "weekend_pct" INTEGER NOT NULL DEFAULT 0,
    "min_nights" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "room_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_days_tenant_id_branch_id_room_type_day_idx" ON "rate_days"("tenant_id", "branch_id", "room_type", "day");

-- CreateIndex
CREATE UNIQUE INDEX "rate_days_branch_id_room_type_day_key" ON "rate_days"("branch_id", "room_type", "day");

-- CreateIndex
CREATE UNIQUE INDEX "room_rules_branch_id_room_type_key" ON "room_rules"("branch_id", "room_type");

-- AddForeignKey
ALTER TABLE "rate_days" ADD CONSTRAINT "rate_days_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_rules" ADD CONSTRAINT "room_rules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

