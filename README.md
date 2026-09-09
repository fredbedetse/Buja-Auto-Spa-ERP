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
- Purchases / Suppliers
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
