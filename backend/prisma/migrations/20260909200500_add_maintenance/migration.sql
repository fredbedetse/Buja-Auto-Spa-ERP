-- CreateTable
CREATE TABLE "MaintenanceOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "vehicleId" TEXT,
    "vehiclePlate" TEXT NOT NULL,
    "vehicleLabel" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "serviceType" TEXT NOT NULL DEFAULT 'OIL',
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "mechanicName" TEXT,
    "scheduledFor" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "laborHours" REAL NOT NULL DEFAULT 0,
    "laborTotal" REAL NOT NULL DEFAULT 0,
    "partsTotal" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "findings" TEXT,
    "partsJson" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSyncedAt" DATETIME,
    "deviceId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOrder_orderNo_key" ON "MaintenanceOrder"("orderNo");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_status_idx" ON "MaintenanceOrder"("status");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_orderNo_idx" ON "MaintenanceOrder"("orderNo");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_vehiclePlate_idx" ON "MaintenanceOrder"("vehiclePlate");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_scheduledFor_idx" ON "MaintenanceOrder"("scheduledFor");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_completedAt_idx" ON "MaintenanceOrder"("completedAt");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_updatedAt_idx" ON "MaintenanceOrder"("updatedAt");
