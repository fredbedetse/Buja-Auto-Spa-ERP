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
- Customers module
- Inventory / Truck Parts
- Sales / Purchases
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
