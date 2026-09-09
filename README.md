# Buja Auto Spa ERP

**Offline-First Enterprise Resource Planning for Bujumbura, Burundi**

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
- [x] QA: Playwright suite 25/25 (incl. delete-then-re-register tombstone revive; seeded fleet & stats, create with plate normalization, dup-plate
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

## ✅ Phase 7 Implemented - Employees / Payroll Register

- [x] **Employees module** (`/employees`) - staff register: name, position (Driver, Mechanic,
      Cashier, Car washer, Salesperson, Accountant, Manager, Admin, Other), phone/email/national ID/
      city, hire date, monthly salary, employment status (Active / On leave / Terminated, color-coded
      chips + filter row), notes; soft delete keeps payroll history; search spans names, phone,
      email & national ID client-side.
- [x] **Payroll stats**: staff size, active, on-leave and **monthly payroll** (sum of salaries for
      everyone not terminated - on-leave staff still count), currency-aware (BIF canonical, USD at
      the 6,000 peg). Server-side PUT applies optimistic version locking (409 `VERSION_CONFLICT`),
      and setting a record to `TERMINATED` automatically clears the on-the-payroll flag.
- [x] **RBAC**: new `employees:read` / `employees:manage` permissions (42 total); Manager manages
      the register, Accountant is read-only (payroll), other roles see nothing - nav entry hidden,
      API returns 403.
- [x] Offline-first: `Employee` branch in sync push/pull + SERVER_WINS conflict handling; Dexie v6
      `employees` store; hires created offline keep their `Pending` chip until the queued push lands.
- [x] EN/FR localized (~48 `emp.*` keys); dashboard gained the Employees module card (headcount +
      monthly payroll badge); the module counter moved to "6 modules live".
- [x] QA: Playwright suite 27/27 (seeded register & payroll math, search/status filters, create,
      validation, edit to On leave with payroll still counting them, delete restores payroll, fully
      offline hire -> "Sync now" -> appears server-side, USD payroll formatting, FR spot checks,
      manager-role access, cross-module smoke, zero console errors) + curl contract suite (stats,
      400 zod details, manager 201, 401 no-token). The vehicles fleet suite was hardened to 25/25
      (delete-then-re-register revive check added) and the shared-file changes were re-verified with
      a 10/10 cross-module smoke (RBAC, offline toggles, FR, auth error handling).

## ✅ Phase 8 Implemented - Invoices & Payments

- [x] **Payments module** (`/payments`) - money-in register: receipts (`RCPT-YYYY-NNNNN`) posted
      against completed sales; CASH / Mobile money / Bank transfer / Cheque with reference + teller
      notes; stat cards (received today / this month / all-time / outstanding) all currency-aware;
      search spans receipt, invoice, customer & reference; VOID rows visible via the include-void
      toggle with strikethrough + badge, hidden from every stat.
- [x] **Invoices module** (`/invoices`) - billing view derived from Sales (single source of truth,
      no second document table): billing status chips computed server-side over the ledger
      (Draft / Unpaid / Partially paid / Paid / Overdue >30d / Cancelled), open & overdue counts,
      outstanding total; document detail modal renders line items, totals block and the receipts
      posted against it, and can capture a payment right from the invoice.
- [x] **Ledger coupling**: every receipt mutates the parent sale (`paidAmount`, `balance`,
      version bump) inside a transaction and logs both rows to the sync stream; overpayment is
      rejected client- and server-side (`400 EXCEEDS_BALANCE` with the live balance in `details`);
      payments on draft or cancelled sales are blocked (`409 SALE_NOT_COMPLETED` /
      `SALE_CANCELLED`). Receipts are immutable - `DELETE` *voids* (reverses the ledger, records a
      reason) and re-voiding is idempotent; an offline-recorded receipt replays through the sync
      queue with the same balance guard.
- [x] **Offline-first**: `Payment` push branch (CREATE replays with ledger + canonical `paymentNo`
      handed back to the client so a `TMP-` id becomes `RCPT-` after sync; UPDATE refuses edits;
      DELETE replays as a reversing void), pull block + Dexie v7 `payments` store and a v8
      read-only `invoices` mirror cache so the picker and registry work with zero connectivity.
- [x] **RBAC**: `payments:read|manage`, `invoices:read|manage` (42 permissions) - Cashier collects
      money, Manager/Admin manage everything, Viewer gets 403 on the API and no nav entry.
- [x] Demo data: two seeded receipts on the partially-paid invoice (mobile-money LUMO ref + cash)
      and a demo Cashier login (`cashier@bujaautospa.bi` / `Cashier@123`) to exercise the role split.
- [x] QA: Playwright suite 38/38 (registry chips & stats, search + billing filters, detail modal,
      overpay guard, cloud receipt capture with modal refresh, void restores the ledger exactly,
      fully-offline receipt -> "Pending sync" -> "Sync now" -> canonical number + cloud stats
      update, USD $50.00 formatting, FR labels, cashier access, zero console errors) + curl
      contract suite (404 / 409 draft / 400 exceeds-balance, idempotent replay, double-void,
      sync push/pull replay round-trip, viewer 403s). Regression: employees suite 27/27 and the
      cross-module smoke 10/10 re-run clean (module chip expectation bumped to "8 modules live").

## ✅ Phase 9 Implemented - Car Wash Board

- [x] **Car Wash module** (`/carwash`) - live bay board: every wash is an order (`WSH-YYYY-NNNNN`)
      with customer + phone, vehicle plate & type (Sedan / SUV / Van / Pickup / Truck / Bus), service
      (Express rinse, Classic, Premium, Interior, Engine bay, Full detail, Polish & wax), bay #1-6,
      assigned washer, notes and a color-coded status (Waiting → Washing → Done, plus Cancelled).
- [x] **Server-side price catalog** (`/api/carwash/catalog`): base price per service × vehicle-size
      multiplier (Truck = 1.6×, Bus = 2.0× …), rounded to the nearest 100 BIF; discounts clamp
      at gross so totals can never go negative - offline clients can't forge prices because the API
      always recomputes the money columns.
- [x] **Lifecycle guards**: starting stamps `startedAt`; completing defaults to paid-in-full with a
      payment-method choice (cash / mobile money / transfer / cheque); completed orders are final
      (409 `WASH_COMPLETED` on reopen or delete) while waiting jobs can be pulled off the board.
      Updates are version-locked (409 `VERSION_CONFLICT` + the server row comes back).
- [x] **Offline-first**: Dexie v9 `washOrders`, `CarWashOrder` push branch (CREATE mints the
      canonical `WSH-` number and hands it back so the local `TMP-WSH-` row self-heals on sync;
      UPDATE replays with version-conflict → SERVER_WINS adoption; DELETE tombstones), pull stream,
      full create/start/complete/remove while the network is off.
- [x] **RBAC**: `carwash:read` / `carwash:manage` - Cashier & Washer run the board, Manager/Admin
      everything, Viewer gets 403s and no nav entry. Stats feed the dashboard card (orders +
      today's wash revenue) and the module chip now reads "9 modules live".
- [x] QA: Playwright suite 31/31 (seeded board & stat math, plate search, status filter, discount
      preview, create/start/complete lifecycle with revenue re-count, board removal, fully-offline
      order → "Pending sync" → canonical number, USD $8.67 formatting, FR labels, cashier access,
      zero console errors) + curl contract suite (catalog math, forged-discount clamp, idempotent
      replay, 400/404/409 guards, sync conflict semantics, viewer 403s). Regression: payments 38/38
      (modal check made rerun-robust), employees 27/27, cross-module smoke 10/10.

## ✅ Phase 10 Implemented - Maintenance Workshop

- [x] **Maintenance module** (`/maintenance`) - workshop board with work orders (`WO-YYYY-NNNNN`):
      vehicle (plate + optional fleet-vehicle picker that pre-fills from the Vehicles module),
      customer, service (Oil & filter, Full service, Brakes, Tyres, Diagnostics, A/C, Coolant,
      Timing belt), mechanic, priority (Normal/Urgent), planned date and lifecycle
      (Waiting → In workshop → Done, plus Cancelled tombstones when pulled off the board).
- [x] **Parts from real inventory**: each job can carry part lines picked from the Products module.
      Unit prices are snapshotted server-side at write time (clients can only send productId + qty,
      so money can never be forged), and the parts editor doubles as an in-job growth editor:
      adding qty mid-job consumes only the difference, removing returns stock.
- [x] **Reservation semantics**: parts stay "planned" while a job waits and are consumed from
      stock the moment the job starts (`INSUFFICIENT_STOCK` 409 stops a start/quantity bump the
      shop can't cover). Deleting an open job puts its reserved parts back on the shelf; completed
      jobs are final (`MAINT_COMPLETED` 409 blocks reopens, part edits and deletes) because their
      consumption is already revenue history.
- [x] **Labor catalog** (`/api/maintenance/catalog`): service hours × 20,000 BIF/shop-hour,
      rounded to the nearest 100; discounts clamp at labor+parts gross.
- [x] **Scheduling pressure at a glance**: stats expose due-soon (3-day window) and overdue counts;
      the board flags overdue planned dates in red and urgent jobs with a badge.
- [x] **Offline-first**: Dexie v10 `maintenanceOrders`; sync push CREATE mints the canonical
      WO number and replays server-side parts pricing + stock reservation (missing parts degrade
      to warnings instead of dead-lettering the queue), UPDATE honors version conflicts
      (SERVER_WINS adoption on the client), DELETE tombstones and releases; pull streams rows back.
      Creating, editing, starting and completing all work with the network off - `TMP-WO-` rows
      self-heal on sync.
- [x] **RBAC**: `maintenance:read` / `maintenance:manage` (already granted to Manager/Mechanic
      roles - no schema changes); Viewer and cashier-side 403s verified. Dashboard gains the 10th
      live card (open count + overdue alert) and the module chip reads "10 modules live".
- [x] QA: Playwright suite 32/32 (seed math incl. the 283,000 → 280,000 discount line, due/overdue
      card, search & status filters, parts picker with server money truth, reservation-on-start
      stock deltas, mid-job edit + discount clamp, complete-with-cheque-and-findings, board
      removal, full offline create → canonical swap, USD $75.83, FR labels, zero console errors)
      + curl contract suite (catalog, idempotent replay, 400/404/409 guards, sync conflict +
      completed-dropped + delete-FAILED semantics, pull stream, viewer 403s).
      Regression: payments 38/38, employees 27/27, wash 31/31, brand 8/8, smoke 10/10.

## ✅ Phase 11 Implemented - EV & Truck Rentals

- [x] **One rental engine, two boards** (`/ev-rentals`, `/truck-rentals`) on a unified backend
      `/api/rentals?class=EV|TRUCK`. Permission-gated per board (`evrentals:*` / `truckrentals:*`,
      manage implies read, SUPER_ADMIN bypass), so a rental agent can run one fleet only.
- [x] **Rate catalogue is server-owned** (`src/lib/rentalCatalog.ts`): 7 unit types from city EVs
      (90,000 BIF/day) to charter buses (420,000 BIF/day), per-type refundable deposits,
      damage insurance at 15,000 BIF/day and an automatic **weekly discount** (every full 7-day
      block bills at 85% of list). Windows are inclusive-day and every amount is recomputed
      server-side on create and on any date/unit/insurance edit - clients never send money.
- [x] **Lifecycle with money attached**: Reserved → (keys handed over, full amount collected)
      On rent → (odometer, fuel/charge level, damage notes, deposit refund decision) Returned.
      Late returns bill 5% of the daily rate per hour, capped at one day's rate, added at return
      by the server. Returned bookings are immutable (`RENTAL_RETURNED` 409) and only unstarted
      reservations can be cancelled/deleted (`RENTAL_NOT_CANCELLABLE`).
- [x] **Availability guards**: double-booking the same unit over an overlapping window is refused
      with `UNIT_BOOKED` (and the conflicting booking number), units in the workshop refuse new
      bookings (`UNIT_UNAVAILABLE`), and a unit with an open booking cannot be flipped to
      maintenance or deleted (`UNIT_BUSY`). The board shows a 14-day fleet timeline so the
      desk can see the holes before typing a booking.
- [x] **Offline bookings**: `RentalBooking` joins the sync queue - a booking taken with no
      network keeps a `TMP-RNT-…` number locally and self-heals to the canonical
      `EVR-/TRR-YYYY-NNNNN` when the queue replays (CREATE replays revalidate overlap and
      re-price on the server; stale versions surface as CONFLICT; offline returns re-bill
      overtime; DELETE of an ACTIVE/RETURNED booking is refused at sync time and the local
      row is restored). Units themselves are a server-managed catalogue cached read-only in
      Dexie (v11) - fleet setup stays an office action.
- [x] **Idempotent creates** (client uuid wins on replay) + `syncLog`/`AuditLog` on every write,
      same guarantees the other modules have.
- [x] **Dashboard cards** for both rentals are live (active count, fleet-on-street, today's
      returned revenue) and the module chip reads "12 modules live".
- [x] Demo data: 7 units (3 EV, 3 bookable trucks + 1 charter bus in the workshop) and 5
      bookings covering on-rent, reserved (incl. insurance), a 14-day charter with the weekly
      discount applied (−735,000 BIF) and a late return that paid the capped overtime bill.
- [x] Verification: curl contract battery (pricing, discount, overlap, transitions, guards,
      replay/CONFLICT, RBAC 403s) + **new Playwright suite `rental.js` 29/29** (preview math,
      conflict copy, start/return flow, workshop block, offline TMP→TRR self-heal, USD/FR,
      cashier fallback). Full regression after purge: tour 24/24, wash 31/31, maint 32/32,
      payments 38/38, employees 27/27, brand 8/8, smoke 10/10 - **199/199**.

## ✅ Phase 12 Implemented - Reports (final module)

- [x] **Cross-module analytics board** (`/reports`): one read-only aggregation endpoint
      `GET /api/reports/summary?from&to` (inclusive window, default last 30 days, capped 366)
      composes the canonical BIF rows from every module - car wash (completed), maintenance
      (completed), rentals (returned, split EV/TRUCK) and POS sales (completed) - into billed
      revenue, per-day buckets for the chart, cash received with method split (payments, VOID
      excluded), top products (POS lines + maintenance parts consumed), receivables/payables
      aligned with the sales/purchases modules' own definitions, payroll, stock value and
      fleet + rental utilization (occupied fleet-days over capacity in the window).
- [x] **Strict server semantics**: every number recomputed from source rows on read (no cached
      report tables); `status: COMPLETED/RECEIVED` filters match what the source modules call
      revenue, sums reconcile exactly (`sum(daily.total) == revenue.total` is a test assertion);
      bad/inverted/oversized windows are 400s, and `reports:read|manage` gates the endpoint
      (manager + accountant yes, cashier no - verified 403/401).
- [x] **Offline-capable by recomputation**: nothing here is writable, so instead of a sync
      surface the page runs the identical aggregation in the browser over its Dexie cache
      whenever the API is unreachable (or access is denied) - with a visible
      "local figures" marker so finance knows which source they are looking at.
- [x] **Board UI**: window presets (7/30/90/YTD + custom dates), 6 KPI cards, inline-SVG
      stacked bar chart (per-module colors, day tooltips, peak-day caption), module share
      table, cash-by-method bars, top-8 products, utilization meters - all in EN/FR and
      BIF/USD at the fixed 6,000 peg; one-click CSV export (Excel-safe UTF-8 BOM) of the whole
      report including the daily series.
- [x] Verification: curl contract battery (baselines reconcile with every module's own stats
      endpoint, validations, RBAC) + **new Playwright suite `reports.js` 19/19** (KPI parity
      against the 30-day demo baseline, chart render, presets, USD `$591.58`, FR labels,
      CSV download event, offline local-parity fallback, cashier graceful view, zero JS errors).
- [x] Full regression matrix with purge between suites: tour 24, wash 31, maint 32, payments 38,
      employees 27, brand 8, rentals 29, reports 19 + smoke 10 - **218/218 green**; all demo
      baselines unchanged (Reports is read-only) and the module chip reads "13 modules live".

## ✅ Phase 13 Implemented - Expenses (ledger complete)

- [x] `Expense` model (server-assigned `EXP-YYYY-NNNNN` numbering, category, amount in canonical
      BIF, vendor / paid-by / method / notes) with a `20260909213314_add_expenses` migration.
- [x] `expenses:read` / `expenses:manage` permissions seeded and granted (MANAGER+VIEWER-style read;
      ACCOUNTANT+ADMIN full); routes enforce them, and the sidebar item appears for read roles only.
- [x] REST CRUD at `/api/expenses` (idempotent create on client uuid, optimistic-lock edit -> 409,
      tombstone delete, list with category/date/search filters, `/stats` for today/month/by-category)
      plus audit (`EXPENSE_*`) and sync-log entries on every write.
- [x] Full sync coverage: push branches (CREATE with server re-numbering + validation, versioned
      UPDATE with conflict capture, DELETE tombstone) and Expense rows in `/sync/pull`.
- [x] Expenses board (sidebar: after Payments): spend stat cards, category chips with color dots,
      search, ledger table with per-row sync chips, and an add/edit modal whose amount is entered in
      the display currency and previews the exact BIF figure it will post as.
- [x] Offline: rows land as `TMP-EXP-xxx` with a queued chip and self-heal to the canonical
      `EXP-2026-xxxxx` when the queue drains; read-only roles see the board without write buttons.
- [x] Reports integration: the 30-day summary now carries `expenses {count, amount, byCategory, net}`
      (net = billed - spend), shown on the cash card and in the CSV export; Dashboard gets a live
      "Operating Spend" card (month total + today) and the module chip reads "14 modules live".
- [x] Seeded ledger: 6 dated demo expenses (rent, insurance, utilities, marketing, supplies, fuel)
      totalling 690,000 BIF this month.
- [x] Backend curl battery (CRUD/numbering/idempotency/version-conflict/stats/sync replay/CONFLICT/
      RBAC 403s/401s) plus a 24-check Playwright suite `expenses.js` (offline queue + sync self-heal,
      reports parity, read-only gating, EN/FR, USD peg); brand guard caught and forced removal of an
      orange gradient (rose->red instead). Full matrix 242/242 green: tour 24, wash 31, maint 32,
      payments 38, employees 27, brand 8, rentals 29, reports 19, expenses 24, smoke 10 - all demo
      baselines verified intact afterwards.

## ✅ Phase 14 Implemented - Settings (all modules live)

- [x] `AppSetting` store: JSON values under fixed keys, `GLOBAL` sentinel rows vs per-user rows,
      unique `(key, userId)` with versioning; public `GET /api/settings/brand` (no auth) feeds the
      login screen's company line, everything else sits behind the auth middleware.
- [x] New `settings:read` / `settings:manage` permissions - read is granted to **every role**
      (everyone may theme their own app), manage flows to ADMIN + SUPER_ADMIN only.
- [x] Personal scope: theme (light / dark / system), reduce-motion, currency and language saved to
      the server per user, mirrored to localStorage, and re-adopted on any new device at login.
      A pre-paint bootstrap in `index.html` kills the white flash on reload.
- [x] App-wide dark mode via one scoped CSS layer (`html.dark` + `color-mix` tints) - no page was
      touched and both palettes pass the brand guard (still zero orange, BAS logo untouched).
- [x] Company scope (manage): editable company name with audit; the location field is a locked
      chip - the API actively refuses relocation with `LOCATION_LOCKED` ("The workshop stays in
      Bujumbura. Location is part of the brand."); default currency/language for new accounts.
- [x] **Who can be admin**: access panel lists every account with an admin toggle
      (`PATCH /api/settings/admins/:id`) with guard rails - no self-demotion (`SELF_DEMOTE`),
      the last admin cannot be removed (`LAST_ADMIN`), the founder's SUPER_ADMIN seat can neither
      be granted nor revoked here (`OWNER_LOCKED`), every change audited.
- [x] Data tools: sync health tiles (queued/failed/conflicts/engine), Sync now, full
      workspace JSON export (local rows + preferences), and a confirm-gated local cache wipe.
- [x] Settings is off the placeholder list - the "Soon" badge count across the nav is now **0**,
      the dashboard chip reads "15 modules live", and every module route in the tour is live.
- [x] 21-item backend curl battery (scopes, enums, guards, replays, 401/403/404s) + 28-check
      Playwright suite `settings.js`; expenses suite's Soon-badge expectation retired in the same
      commit. **Full matrix 270/270**: tour 24, wash 31, maint 32, payments 38, employees 27,
      brand 8, rentals 29, reports 19, expenses 24, settings 28, smoke 10 - demo baselines
      verified intact after the run (promoted admin demoted back, company name restored).

## ✅ Phase 15 Implemented - Deployment hardening

- **Boot guard**: with `NODE_ENV=production` the API refuses to start (exit 1) unless
  `JWT_SECRET`/`JWT_REFRESH_SECRET` are set, distinct, ≥32 chars and not placeholder-ish,
  plus `DATABASE_URL` and an explicit `CORS_ORIGIN`/`FRONTEND_URL`. Development is untouched.
- **Middleware**: helmet (CSP + nosniff + frame-ancestors + HSTS in production), per-IP
  login-rate limiting (`AUTH_RATE_MAX`, default 20/15min, 429 with `RATE_LIMITED` code) and
  a global 600 req/min guard; CORS origins now come from `CORS_ORIGIN` (comma-separated).
- **Ops**: JSON request logs (`JSON_LOGS=1`), Docker Compose stack (Postgres 16 + API with
  `PRISMA_SCHEMA=postgres` schema swap + nginx SPA serving with `/api` proxy and correct
  `sw.js` no-cache), `deploy/backup.sh`/`restore.sh` (sha256-verified), `rotate-secrets.sh`,
  `backend/src/scripts/import-sqlite.ts` (SQLite→Postgres migrator), PM2 + systemd units for
  non-Docker hosts - full runbook in **`DEPLOYMENT.md`**.
- Verified: production-mode smoke (guard refuses weak config, helmet headers present,
  5-then-429 login limiter, CORS allow-list enforced) and the full 270-check QA matrix
  re-run with zero regressions.

## ✅ Phase 16 Implemented - Payroll (manager/admin only)

- **`PayrollRun` + `PayrollItem`**: one run per year+month (unique), items snapshot each
  active employee's name/position/salary at creation so later HR edits never rewrite a
  closed month; `net = base + bonus - deduction` recomputed server-side.
- **Status machine**: `OPEN → APPROVED → PAID`; settle requires approval first, paid runs
  are locked (`RUN_LOCKED`), only open runs can be deleted, and any item edit pulls an
  approved run back to `OPEN` for re-review.
- **Access control**: new `payroll:read` + `payroll:manage` permissions granted **only** to
  MANAGER and ADMIN/SUPER_ADMIN - every other role (including ACCOUNTANT) gets 403, a
  hidden nav item, and a lock card if the URL is typed directly.
- **Online-only by design**: no Dexie store, no sync queue - a banner explains it and writes
  are blocked while offline. Payslips display in EN/FR with BIF/USD per the user's money prefs.
- Dashboard gained a payroll card (paid-this-year total, hidden for unauthorized roles) and
  the module chip now reads "16 modules live"; `GET /api/payroll/stats` feeds both.
- Seeded demo: `PR-2026-08` PAID run (4 active staff, 2,180,000 BIF, bank transfer).
- QA: dedicated 29-check payroll suite (per-role gating end-to-end, approve/settle/unsettle
  dance, bonus recompute, FR labels) + 12-suite matrix 299/299 re-run after restart.

## 🔜 Next Phases


After foundation verification:
- ~~Customers module~~ (completed in Phase 2)
- ~~Inventory / Truck Parts~~ (completed in Phase 3)
- ~~Sales / POS~~ (completed in Phase 4)
- ~~Suppliers / Purchases~~ (completed in Phase 5)
- ~~Vehicles / Fleet~~ (completed in Phase 6)
- ~~Employees / Payroll~~ (completed in Phase 7)
- ~~Invoices / Payments~~ (completed in Phase 8)
- ~~Car Wash~~ (completed in Phase 9)
- ~~Maintenance~~ (completed in Phase 10)
- ~~EV Rentals / Truck Rentals~~ (completed in Phase 11)
- ~~Reports~~ (completed in Phase 12)
- ~~Expenses~~ (completed in Phase 13)
- ~~Settings~~ (completed in Phase 14 - every module is now live)
- ~~Deployment hardening~~ (completed in Phase 15)
- ~~Payroll~~ (completed in Phase 16 - module 16, manager/admin only)

All data-entry modules use the same offline-first pattern: local IndexedDB + sync queue + cloud sync.
Reports needs no sync surface: it recomputes from local rows when offline.

## 🌍 Deployment

- One-command Docker: `docker compose up -d` (Postgres 16 + hardened API + nginx SPA) - see `DEPLOYMENT.md`
- Bare-metal alternatives: PM2 (`deploy/ecosystem.config.cjs`) or systemd (`deploy/systemd-buja-api.service`)
- Prod refuses to boot with weak config (secrets, CORS, DB) - guards verified; backups/restore/rotation in `deploy/`
- Frontend: static `dist` behind nginx (cache-tuned, PWA works offline) or any CDN

## 📄 License

Private - Buja Auto Spa

---
Built with offline-first principles for reliable operation in Bujumbura, Burundi.
