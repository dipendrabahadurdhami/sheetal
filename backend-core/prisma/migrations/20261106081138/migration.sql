-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "min" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_moves" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "after" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "ref" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_recipes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "menu_item_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "stock_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_items_tenant_id_branch_id_active_idx" ON "stock_items"("tenant_id", "branch_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_tenant_id_branch_id_name_place_key" ON "stock_items"("tenant_id", "branch_id", "name", "place");

-- CreateIndex
CREATE INDEX "stock_moves_tenant_id_branch_id_created_at_idx" ON "stock_moves"("tenant_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_moves_item_id_created_at_idx" ON "stock_moves"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_moves_ref_idx" ON "stock_moves"("ref");

-- CreateIndex
CREATE INDEX "stock_recipes_tenant_id_idx" ON "stock_recipes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_recipes_menu_item_id_item_id_key" ON "stock_recipes"("menu_item_id", "item_id");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_recipes" ADD CONSTRAINT "stock_recipes_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_recipes" ADD CONSTRAINT "stock_recipes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
