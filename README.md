# Buja Auto Spa ERP

**Offline-First Enterprise Resource Planning for Gitega, Burundi**

Professional ERP for:
- Truck/Machine parts sales
- Vehicle/Machine maintenance
- Electric vehicle rentals
- Truck/Machine rentals
- Car wash
- Miscellaneous inventory sales

## 🏗️ Architecture - OFFLINE-FIRST

This ERP is designed to **continue operating when internet is unavailable** and synchronize when connectivity returns.

### Core Principles

1. **Local Database (IndexedDB via Dexie)** - Primary offline storage, NOT localStorage
2. **Cloud Database (Prisma + SQLite → PostgreSQL)** - Central source of truth
3. **Synchronization Engine** - Push/Pull with conflict handling
4. **Unique IDs (UUID v4)** - No auto-increment conflicts
5. **Versioning** - Optimistic locking for conflict detection
6. **Sync States** - PENDING / SYNCED / FAILED / CONFLICT
7. **PWA** - Works on Desktop, Tablet, Android, iPhone

### Tech Stack

**Backend:**
- Node.js + Express + TypeScript
- Prisma ORM (SQLite dev, PostgreSQL ready)
- JWT Auth (access + refresh tokens)
- RBAC (9 roles, 40+ permissions)
- Sync API (push/pull/status/resolve)

**Frontend:**
- Vite + React + TypeScript
- Tailwind CSS (responsive)
- Dexie.js (IndexedDB wrapper)
- Zustand (state)
- vite-plugin-pwa (offline support)
- Workbox (caching)

## ✅ Foundation Implemented (Phase 1)

- [x] Project architecture (monorepo)
- [x] Authentication (secure JWT + bcrypt)
- [x] Database foundation (relational)
- [x] Local offline DB (IndexedDB, not localStorage)
- [x] Cloud DB connection (Prisma)
- [x] Sync foundation (engine + queue)
- [x] PWA foundation (manifest + SW)
- [x] Online/offline detection
- [x] User roles & permissions (RBAC)
- [x] ERP shell/dashboard (sidebar, search, notifications, profile, indicators)

## ✅ Phase 2 Implemented - Customers Module

- [x] `Customer` model in Prisma (sync-safe: version, soft delete, deviceId) + migration
- [x] CRUD API `/api/customers` with search, pagination, stats, RBAC guards
- [x] Optimistic locking (409 `VERSION_CONFLICT` with `serverData`)
- [x] Offline-first sync: `/api/sync/push` now applies Customer CREATE/UPDATE/DELETE, `/api/sync/pull` streams Customer changes
- [x] Client-generated UUIDs supported end-to-end (offline creates reconcile without id drift)
- [x] Frontend `Customers` page: table, search, create/edit modal, delete, per-row sync badges, local-first cache with cloud refresh
- [x] Sync engine applies Customer changes on pull and on conflict resolution (SERVER_WINS)
- [x] Dashboard shows live customer counts (cloud when online, IndexedDB when offline)
- [x] Seed data: 6 demo customers (idempotent)

## ✅ Phase 3 Implemented - Inventory / Truck Parts

- [x] `Product` model in Prisma (SKU unique, stock & reorder levels, BIF prices, sync metadata) + migration
- [x] CRUD API `/api/inventory` with search, category & low-stock filters, `/stats`, `/categories`, RBAC guards
- [x] Optimistic locking + audit logs (same contract as Customers)
- [x] Sync engine handles `Product` CREATE/UPDATE/DELETE push (real DB application) and pull
- [x] Frontend `Inventory` page: summary chips (SKUs, low/out stock, stock value), category filter, search,
      create/edit modal, stock highlighting, sync chips, offline-first writes
- [x] Dashboard: Truck Parts card live count + low-stock alert; module cards now navigate

## ✅ Phase 4 Implemented - Sales / Point of Sale

- [x] `Sale` + `SaleItem` models in Prisma (invoice no, customer link, status DRAFT/COMPLETED/CANCELLED,
      payment method, BIF totals & balance, sync metadata) + migration
- [x] `/api/sales`: list w/ search + status + date filters + pagination, `/stats` (today/month revenue,
      outstanding balance), GET/:id, POST (server recomputes line prices & totals from the product catalog —
      client-submitted prices are never trusted), DELETE = cancel (soft-delete + stock restored + SyncLog)
- [x] Stock integration: COMPLETED sales decrement product stock (and bump `Product.version` so concurrent
      offline product edits surface as `VERSION_CONFLICT`); over-sell rejected with `409 INSUFFICIENT_STOCK`
      incl. per-product details; DRAFT sales never touch stock
- [x] Server-assigned invoice numbers `INV-YYYY-NNNNN` — offline clients submit provisional `TMP-*` ids
      that are renamed on sync, and the Dexie record is updated in place
- [x] Sales are immutable: sync push rejects UPDATE; UI cancels + re-creates instead
- [x] Sync engine handles `Sale` CREATE/DELETE push + pull (items embedded), conflict SERVER_WINS
- [x] Frontend `Sales` page: revenue/balance summary chips, invoice+customer search, status filter,
      sync chips, POS modal (customer picker, product search with live stock guards, qty steppers,
      discount/payment/paid with live totals), sale detail viewer, cancel with stock restore,
      full offline create → queue → resync flow
- [x] Dashboard: Sales/POS module card (count + outstanding balance), "3 modules live" status chip;
      Sales nav entry no longer "Soon"
- [x] QA: 15/15 Playwright steps (online create → Synced, offline create → Pending → resync → canonical
      invoice, cancel → stock restored server-side, detail view, zero console errors) + curl suite for
      409 oversell, immutability & stats endpoints

## ✅ Phase 4.5 Implemented - Internationalization & Dual Currency

- [x] **Language: English / Français** - full app UI localized via a lightweight i18n layer
      (`lib/i18n.ts` dictionary + `useT()` hook; module-level chips use `tNow()`), covering nav,
      dashboard, customers, inventory, sales/POS, sync status and login. No i18n library dependency.
- [x] **Currency: BIF / USD at fixed peg 1 USD = 6,000 BIF** - canonical storage unit stays BIF
      (prices, totals and stats are stored & computed in BIF server-side); the UI layer converts
      both ways: all amounts format per the active currency, and money input fields (part prices,
      credit limit, sale discount/paid) are entered in the active currency and converted on save.
- [x] Header segmented toggles (`EN|FR`, `BIF|USD`) available in-app and on the login screen;
      preferences persist via zustand + localStorage (`buja-ui-prefs`) - fully offline-capable,
      survive reloads and restarts
- [x] Dates localize with the language (en-GB ↔ fr-FR month names); numbers group per locale
- [x] QA: dedicated lang/currency suite 21/21 (FR login→nav→headings, USD row formatting, prefs
      persistence, FR+USD sale of $12.50 stored as exactly 75,000 BIF on the server, revert,
      cleanup) + full EN regression suites green (20/20, 15/15)
- Note: server-side validation/error message strings are still English-only; UI toasts render
      them verbatim

## ✅ Phase 5 Implemented - Suppliers & Purchases

- [x] **Suppliers directory** (`/suppliers`) - full CRUD with search, lead-time chips (color-coded
      by days), contact/alt-phone/email/city/tax-ID/notes fields, soft delete, and stats cards
      (active count, total purchase spend, amount owed). Duplicate phone rejected server-side (409).
- [x] **Purchases / stock receiving** (`/purchases`) - goods receipts against suppliers with a
      Received-now vs Ordered-draft toggle: RECEIVED purchases increment product stock and update
      the product's last purchase price atomically server-side (`buildPurchaseTxn`, same guard
      machinery as sales); DRAFT orders book nothing until they sync as received. Editable per-line
      buy-side unit cost (authoritative - catalog price is only a "last buy" hint), supplier
      invoice ref, discount, payment method incl. `CREDIT_30` (30-day terms -> balance owed).
      Canonical PO numbers `PO-YYYY-NNNNN` assigned by the server. Purchases are immutable -
      cancel (DELETE) reverses stock, and cancelling a purchase whose goods were already
      sold/consumed is blocked with a precise 409 (`CANCEL_WOULD_NEGATE_STOCK`).
- [x] Offline-first end to end: supplier edits and purchases persist to Dexie immediately and
      queue (`Supplier`/`Purchase` branches in push/pull + conflict resolution; markClean keeps the
      server-assigned PO number); reconnect replays them and stock math lands server-side.
- [x] Localized EN/FR from day one (~70 new `sup.*` / `po.*` dictionary keys) and currency-aware
      (all amounts & inputs go through `useMoney()`; BIF canonical, USD display at the 6,000 peg).
      Suppliers & Purchases nav entries no longer "Soon"; dashboard gained a Purchases module card
      (order count + amount owed).
- [x] QA: dedicated Playwright suite 25/25 - supplier CRUD + 409 dup-phone + UI delete,
      received purchase bumps stock 20->22, draft leaves stock untouched, cancel restores 22->20,
      fully-offline purchase queues -> syncs to canonical PO -> coolant 12->13, FR spot-checks,
      zero console errors. Curl-verified API contract (totals server-computed, immutability 404,
      cancel-guard 409 details). Full regression green: 20/20, 15/15, 21/21.

## ✅ Phase 6 Implemented - Vehicles / Fleet Register

- [x] **Fleet module** (`/vehicles`) - full CRUD for trucks, buses, minibuses, pickups & cars:
      plate (auto-uppercase, unique), type, manufacturer/model/year/VIN/color, status board
      (Available / In use / In maintenance / Rented / Retired, color-coded chips + filter row),
      odometer, driver name & phone, purchase date/price and notes; soft delete with history kept.
- [x] **Server guards**: duplicate plate -> 409 `DUPLICATE_PLATE`; odometer never rolls back -
      stale offline edits below the recorded value are rejected with 409 `ODOMETER_REGRESSION`
      (and clamped, not rejected, when replayed through the sync queue); optimistic version locking
      on PUT (409 `VERSION_CONFLICT` returns server data).
- [x] Offline-first: `Vehicle` branch in sync push/pull + SERVER_WINS conflict handling; Dexie v5
      `vehicles` store; rows created offline keep their `Pending` chip until queued push lands.
- [x] EN/FR localized from day one (~67 `veh.*` keys) & currency-aware fleet value (BIF canonical,
      USD display at the 6,000 peg); dashboard gained the Vehicles module card (fleet count +
      in-use badge) and nav "Soon" badge removed.
- [x] QA: Playwright suite 24/24 (seeded fleet & stats, create with plate normalization, dup-plate
      rejection, status edit, odometer guard surfaced in UI, delete, fully-offline create ->
      "Sync now" -> appears server-side, USD value formatting, FR spot checks, cross-module smoke,
      zero console errors) + curl suite for all 409 guards & stats. Offline sale/purchase loops
      re-verified 9/9 after the Dexie v5 bump.

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- npm

### Installation

```bash
# Clone and setup
cd buja-auto-spa-erp

# Install all dependencies
npm install
cd backend && npm install && cd ../frontend && npm install && cd ..

# Setup backend DB
cd backend
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
cd ..

# Run development (both frontend + backend)
npm run dev

# Or separately:
# Backend: http://localhost:4000
cd backend && npm run dev

# Frontend: http://localhost:5173
cd frontend && npm run dev
```

### Default Accounts

- **Super Admin:** admin@bujaautospa.bi / Admin@123456
- **Manager:** manager@bujaautospa.bi / Manager@123

## 📱 PWA Installation

The app is installable on:
- Desktop (Chrome, Edge)
- Android (Chrome)
- iPhone (Safari - Add to Home Screen)
- Tablet

## 🔄 Sync Flow

1. User makes change offline → saved to IndexedDB + added to syncQueue (PENDING)
2. When online, sync engine pushes PENDING items to `/api/sync/push`
3. Server validates version, detects conflicts, stores SyncLog
4. Pull new changes from `/api/sync/pull` since lastSyncAt
5. Update local DB, mark queue items SYNCED
6. Conflicts show in UI for manual resolution (CLIENT_WINS / SERVER_WINS / MERGE)

## 🛡️ Security

- bcrypt password hashing (12 rounds)
- JWT access (15m) + refresh (7d) tokens
- Session revocation
- RBAC middleware
- Audit logs
- Optimistic locking

## 📦 Project Structure

```
buja-auto-spa-erp/
├── backend/
│   ├── prisma/schema.prisma (relational DB)
│   ├── src/
│   │   ├── lib/ (prisma, jwt)
│   │   ├── middleware/auth.ts (RBAC)
│   │   ├── routes/ (auth, users, sync, health)
│   │   └── index.ts
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── lib/db.ts (Dexie IndexedDB)
│   │   ├── lib/api.ts (offline-aware client)
│   │   ├── lib/syncEngine.ts (push/pull)
│   │   ├── stores/authStore.ts
│   │   ├── hooks/useOnlineStatus, useSyncStatus
│   │   ├── components/Layout.tsx (ERP shell)
│   │   └── pages/ (Dashboard, Users, SyncStatus)
│   ├── public/ (PWA icons, manifest)
│   └── vite.config.ts (PWA plugin)
└── README.md
```

## 🔜 Next Phases

After foundation verification:
- ~~Customers module~~ (completed in Phase 2)
- ~~Inventory / Truck Parts~~ (completed in Phase 3)
- ~~Sales / POS~~ (completed in Phase 4)
- ~~Suppliers / Purchases~~ (completed in Phase 5)
- ~~Vehicles / Fleet~~ (completed in Phase 6)
- Invoices / Payments
- Car Wash
- Maintenance
- EV Rentals / Truck Rentals
- Reports

All modules will use same offline-first pattern: local IndexedDB + sync queue + cloud sync.

## 🌍 Deployment

- Backend: Can deploy to any Node.js host, switch DATABASE_URL to PostgreSQL
- Frontend: Static build (dist) deploy to Vercel/Netlify, PWA works offline

## 📄 License

Private - Buja Auto Spa

---
Built with offline-first principles for reliable operation in Gitega, Burundi.
