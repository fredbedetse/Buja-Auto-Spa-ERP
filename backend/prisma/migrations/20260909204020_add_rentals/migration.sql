-- CreateTable
CREATE TABLE "RentalUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fleetClass" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "plate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSyncedAt" DATETIME,
    "deviceId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "RentalBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingNo" TEXT NOT NULL,
    "fleetClass" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "unitName" TEXT NOT NULL,
    "unitPlate" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "insurance" BOOLEAN NOT NULL DEFAULT false,
    "dailyRate" REAL NOT NULL DEFAULT 0,
    "days" INTEGER NOT NULL DEFAULT 1,
    "rentAmount" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "insuranceTotal" REAL NOT NULL DEFAULT 0,
    "overtimeFee" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "depositAmount" REAL NOT NULL DEFAULT 0,
    "depositRefunded" BOOLEAN NOT NULL DEFAULT false,
    "mileageOut" INTEGER,
    "mileageReturn" INTEGER,
    "returnLevel" INTEGER,
    "damageNotes" TEXT,
    "notes" TEXT,
    "startedAt" DATETIME,
    "returnedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSyncedAt" DATETIME,
    "deviceId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "RentalUnit_fleetClass_idx" ON "RentalUnit"("fleetClass");

-- CreateIndex
CREATE INDEX "RentalUnit_status_idx" ON "RentalUnit"("status");

-- CreateIndex
CREATE INDEX "RentalUnit_updatedAt_idx" ON "RentalUnit"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RentalBooking_bookingNo_key" ON "RentalBooking"("bookingNo");

-- CreateIndex
CREATE INDEX "RentalBooking_status_idx" ON "RentalBooking"("status");

-- CreateIndex
CREATE INDEX "RentalBooking_fleetClass_idx" ON "RentalBooking"("fleetClass");

-- CreateIndex
CREATE INDEX "RentalBooking_unitId_idx" ON "RentalBooking"("unitId");

-- CreateIndex
CREATE INDEX "RentalBooking_startDate_idx" ON "RentalBooking"("startDate");

-- CreateIndex
CREATE INDEX "RentalBooking_returnedAt_idx" ON "RentalBooking"("returnedAt");

-- CreateIndex
CREATE INDEX "RentalBooking_updatedAt_idx" ON "RentalBooking"("updatedAt");
