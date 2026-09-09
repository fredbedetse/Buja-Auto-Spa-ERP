-- CreateTable
CREATE TABLE "CarWashOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "vehiclePlate" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL DEFAULT 'SEDAN',
    "serviceType" TEXT NOT NULL DEFAULT 'CLASSIC',
    "basePrice" REAL NOT NULL DEFAULT 0,
    "surcharge" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "bay" INTEGER NOT NULL DEFAULT 1,
    "washerName" TEXT,
    "notes" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSyncedAt" DATETIME,
    "deviceId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "CarWashOrder_orderNo_key" ON "CarWashOrder"("orderNo");

-- CreateIndex
CREATE INDEX "CarWashOrder_status_idx" ON "CarWashOrder"("status");

-- CreateIndex
CREATE INDEX "CarWashOrder_orderNo_idx" ON "CarWashOrder"("orderNo");

-- CreateIndex
CREATE INDEX "CarWashOrder_vehiclePlate_idx" ON "CarWashOrder"("vehiclePlate");

-- CreateIndex
CREATE INDEX "CarWashOrder_completedAt_idx" ON "CarWashOrder"("completedAt");

-- CreateIndex
CREATE INDEX "CarWashOrder_updatedAt_idx" ON "CarWashOrder"("updatedAt");
