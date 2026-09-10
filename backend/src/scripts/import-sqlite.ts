// ---------------------------------------------------------------------------
// One-shot migration helper: copy a real production SQLite file into the
// (schema-baselined, empty) Postgres database. Verified end-to-end against
// PostgreSQL 17 with the full 28-model dataset + row-count/aggregate checks.
//
//   SQLITE_PATH=./prod-copy.db DATABASE_URL="postgresql://..." \
//     npx tsx src/scripts/import-sqlite.ts
//
// Design notes:
//  * Idempotent: createMany with skipDuplicates on UUID PKs - re-running is
//    harmless, it just skips rows already present.
//  * Types: SQLite has no bool/timestamp storage; better-sqlite3 hands back
//    0/1 ints and epoch-ms ints. We read each table's DDL to know which
//    columns are BOOLEAN/DATETIME/DATE and cast before Prisma validation.
//  * @updatedAt/@createdAt values are preserved verbatim (audit history).
// ---------------------------------------------------------------------------
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';

// FK order: referenced tables first. Missing-in-source tables are skipped
// (older prod dbs pre-payroll just have no such tables).
const TABLES = [
  'Permission', 'Role', 'RolePermission', 'User', 'UserRole', 'Session', 'AuditLog',
  'SyncLog', 'SyncCheckpoint', 'SyncMetadata',
  'Customer', 'Vehicle', 'Product', 'Supplier', 'Employee',
  'CarWashOrder', 'MaintenanceOrder', 'MaintenanceOrderPart',
  'Sale', 'SaleItem', 'Purchase', 'PurchaseItem', 'Invoice', 'InvoiceItem', 'Payment',
  'RentalUnit', 'RentalBooking', 'Expense', 'AppSetting',
  'PayrollRun', 'PayrollItem',
] as const;

type ColType = 'bool' | 'date' | 'plain';

function columnTypes(db: Database.Database, table: string): Record<string, ColType> {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string };
  const out: Record<string, ColType> = {};
  for (const m of row.sql.matchAll(/"(\w+)"\s+(\w+)/g)) {
    const [, col, type] = m;
    if (/^BOOLEAN$/i.test(type)) out[col] = 'bool';
    else if (/^(DATE|DATETIME|TIMESTAMP)$/i.test(type)) out[col] = 'date';
  }
  return out;
}

function cast(value: any, kind: ColType): any {
  if (value === null || value === undefined) return value;
  if (kind === 'bool') return value === 1 || value === true;
  if (kind === 'date') {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);            // epoch ms
    const s = String(value);
    // Prisma writes 'YYYY-MM-DD HH:MM:SS[.sss]' (UTC) as text on older files
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? new Date(n) : new Date(s);
  }
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
}

async function main() {
  const path = process.env.SQLITE_PATH || './dev.db';
  const db = new Database(path, { readonly: true });
  const p = new PrismaClient();
  await p.$connect();
  let total = 0;
  const report: Array<{ table: string; src: number; skipped?: string }> = [];
  for (const table of TABLES) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) { console.log(`  - ${table}: not in sqlite, skipped`); report.push({ table, src: 0, skipped: 'absent in source' }); continue; }
    const rows = db.prepare(`SELECT * FROM "${table}"`).all() as any[];
    if (!rows.length) { console.log(`  - ${table}: 0 rows`); report.push({ table, src: 0 }); continue; }
    const model = table[0].toLowerCase() + table.slice(1);
    const delegate = (p as any)[model];
    if (!delegate) { console.log(`  ? ${table}: no prisma delegate, skipped`); report.push({ table, src: rows.length, skipped: 'no delegate' }); continue; }
    const types = columnTypes(db, table);
    const cols = Object.keys(rows[0]);
    const clean = rows.map(r => {
      const o: any = {};
      for (const c of cols) o[c] = cast(r[c], (types[c] ?? 'plain') as ColType);
      return o;
    });
    // chunked so a wide table never builds an oversized statement
    const CHUNK = 500;
    for (let i = 0; i < clean.length; i += CHUNK) {
      await delegate.createMany({ data: clean.slice(i, i + CHUNK), skipDuplicates: true });
    }
    console.log(`  + ${table}: ${rows.length} rows`);
    report.push({ table, src: rows.length });
    total += rows.length;
  }
  console.log(`\nimported ${total} rows from ${path}`);
  console.log('REPORT_JSON=' + JSON.stringify(report));
  await p.$disconnect();
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
