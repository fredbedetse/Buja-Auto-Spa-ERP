// One-shot migration helper: copy a SQLite dev.db into the (empty) production
// Postgres database. Run from backend/ with both URLs available:
//   SQLITE_PATH=./dev.db DATABASE_URL="postgresql://..." npx tsx src/scripts/import-sqlite.ts
// Requires: npx -y -p better-sqlite3 -p @types/better-sqlite3 not needed at runtime if
// you run `npm i -D better-sqlite3` first (dev-only dependency, never shipped).
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';

const TABLES = [
  // FK order: referenced tables first
  'Permission', 'Role', 'RolePermission', 'User', 'UserRole', 'Session', 'AuditLog', 'SyncLog',
  'Customer', 'Vehicle', 'Product', 'Supplier', 'Employee',
  'CarWashOrder', 'MaintenanceOrder', 'MaintenanceOrderPart',
  'Sale', 'SaleItem', 'Purchase', 'PurchaseItem', 'Invoice', 'InvoiceItem', 'Payment',
  'RentalUnit', 'RentalBooking', 'Expense', 'AppSetting',
] as const;

async function main() {
  const path = process.env.SQLITE_PATH || './dev.db';
  const db = new Database(path, { readonly: true });
  const p = new PrismaClient();
  await p.$connect();
  let total = 0;
  for (const table of TABLES) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    if (!exists) { console.log(`  - ${table}: not in sqlite, skipped`); continue; }
    const rows = db.prepare(`SELECT * FROM "${table}"`).all() as any[];
    if (!rows.length) { console.log(`  - ${table}: 0 rows`); continue; }
    const model = table[0].toLowerCase() + table.slice(1);
    const delegate = (p as any)[model];
    if (!delegate) { console.log(`  ? ${table}: no prisma delegate, skipped`); continue; }
    const cols = Object.keys(rows[0]);
    // booleans/timestamps: sqlite stores ints/ms - Prisma coerces on createMany
    const clean = rows.map(r => { const o: any = {}; for (const c of cols) o[c] = r[c] instanceof Uint8Array ? Buffer.from(r[c]) : r[c]; return o; });
    await delegate.createMany({ data: clean, skipDuplicates: true });
    console.log(`  + ${table}: ${rows.length} rows`);
    total += rows.length;
  }
  await p.$disconnect();
  console.log(`imported ${total} rows from ${path}`);
}
main().catch(e => { console.error(e); process.exit(1); });
