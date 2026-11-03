-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "listing_id" INTEGER,
    "branch" TEXT,
    "no" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rate" INTEGER NOT NULL,
    "max_guests" INTEGER NOT NULL DEFAULT 2,
    "floor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'vacant',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "room_id" TEXT,
    "room_type" TEXT NOT NULL,
    "guest_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "adults" INTEGER NOT NULL DEFAULT 2,
    "children" INTEGER NOT NULL DEFAULT 0,
    "check_in" TIMESTAMP(3) NOT NULL,
    "check_out" TIMESTAMP(3) NOT NULL,
    "rate" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "source" TEXT NOT NULL DEFAULT 'direct',
    "id_checked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_lines" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "amount" INTEGER NOT NULL,
    "by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folio_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "ref" TEXT,
    "by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "outlet" TEXT NOT NULL DEFAULT 'Restaurant',
    "category" TEXT NOT NULL DEFAULT 'Food',
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "opened_by" TEXT NOT NULL,
    "float" INTEGER NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "counted" INTEGER,
    "diff" INTEGER,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_bills" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shift_id" TEXT,
    "outlet" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "service" INTEGER NOT NULL,
    "vat" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "booking_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "void_note" TEXT,
    "by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "listing_id" INTEGER NOT NULL,
    "block" TEXT NOT NULL DEFAULT '',
    "no" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size_sqft" INTEGER,
    "price" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "hold_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "price" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "plan" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "ref" TEXT,
    "note" TEXT,
    "by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "listing_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pledged',
    "paid_at" TIMESTAMP(3),
    "ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_updates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "listing_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_tenant_id_type_idx" ON "rooms"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenant_id_no_key" ON "rooms"("tenant_id", "no");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_seq_key" ON "bookings"("seq");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_status_check_in_idx" ON "bookings"("tenant_id", "status", "check_in");

-- CreateIndex
CREATE INDEX "bookings_room_id_check_in_idx" ON "bookings"("room_id", "check_in");

-- CreateIndex
CREATE INDEX "folio_lines_booking_id_idx" ON "folio_lines"("booking_id");

-- CreateIndex
CREATE INDEX "guest_payments_booking_id_idx" ON "guest_payments"("booking_id");

-- CreateIndex
CREATE INDEX "menu_items_tenant_id_outlet_idx" ON "menu_items"("tenant_id", "outlet");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_closed_at_idx" ON "shifts"("tenant_id", "closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "pos_bills_seq_key" ON "pos_bills"("seq");

-- CreateIndex
CREATE INDEX "pos_bills_tenant_id_created_at_idx" ON "pos_bills"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "units_tenant_id_status_idx" ON "units"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "units_listing_id_block_no_key" ON "units"("listing_id", "block", "no");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_seq_key" ON "reservations"("seq");

-- CreateIndex
CREATE INDEX "reservations_tenant_id_status_idx" ON "reservations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "collections_tenant_id_created_at_idx" ON "collections"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "commitments_tenant_id_listing_id_idx" ON "commitments"("tenant_id", "listing_id");

-- CreateIndex
CREATE INDEX "investment_updates_listing_id_created_at_idx" ON "investment_updates"("listing_id", "created_at");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_lines" ADD CONSTRAINT "folio_lines_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_payments" ADD CONSTRAINT "guest_payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_bills" ADD CONSTRAINT "pos_bills_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

