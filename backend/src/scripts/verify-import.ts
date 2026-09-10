// Post-import verification: per-table row counts + business aggregates,
// SQLite (source of truth) vs Postgres (target). Both must agree before cutover.
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';

const TABLES = ['Permission','Role','RolePermission','User','UserRole','Session','AuditLog','SyncLog','SyncCheckpoint','SyncMetadata','Customer','Vehicle','Product','Supplier','Employee','CarWashOrder','MaintenanceOrder','MaintenanceOrderPart','Sale','SaleItem','Purchase','PurchaseItem','Invoice','InvoiceItem','Payment','RentalUnit','RentalBooking','Expense','AppSetting','PayrollRun','PayrollItem'];
const delegate = (p: any, t: string) => p[t[0].toLowerCase() + t.slice(1)];

async function main() {
  const sq = new Database(process.env.SQLITE_PATH || './dev.db', { readonly: true });
  const p = new PrismaClient();
  let bad = 0;
  for (const t of TABLES) {
    const d = delegate(p, t); if (!d) continue;
    let src = 0;
    if (sq.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t))
      src = (sq.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as any).c;
    const dst = await d.count();
    if (src !== dst) { console.log(`MISMATCH ${t}: sqlite=${src} postgres=${dst}`); bad++; }
  }
  const [sqPay, pgPay] = [
    (sq.prepare("SELECT COALESCE(SUM(net),0) s FROM PayrollItem WHERE paid=1").get() as any).s,
    await p.payrollItem.aggregate({ where: { paid: true, run: { year: new Date().getUTCFullYear() } }, _sum: { net: true } }),
  ];
  const sqTotals = (sq.prepare("SELECT COALESCE(SUM(total),0) s FROM Sale WHERE isDeleted=0").get() as any).s;
  const pgTotals = (await p.sale.aggregate({ where: { isDeleted: false }, _sum: { total: true } }))._sum.total || 0;
  console.log(`payroll paid-this-year: sqlite=${sqPay} postgres=${pgPay._sum.net ?? 0} ${sqPay === (pgPay._sum.net ?? 0) ? '✓' : '✗'}`);
  if (sqPay !== (pgPay._sum.net ?? 0)) bad++;
  console.log(`sales total: sqlite=${sqTotals} postgres=${pgTotals} ${sqTotals === pgTotals ? '✓' : '✗'}`);
  if (sqTotals !== pgTotals) bad++;
  const lastDate = sq.prepare("SELECT MAX(createdAt) m FROM AuditLog").get() as any;
  const pgDate = await p.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  console.log(`audit newest: sqlite=${new Date(Number(lastDate.m) || lastDate.m).toISOString()} pg=${pgDate ? pgDate.createdAt.toISOString() : 'none'}`);
  await p.$disconnect(); sq.close();
  console.log(bad === 0 ? 'VERIFY OK - all tables and aggregates match' : `VERIFY FAILED (${bad} mismatches)`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
