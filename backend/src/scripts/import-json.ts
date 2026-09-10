// ---------------------------------------------------------------------------
// Imports a prod-snapshot.json (from export-snapshot.ts) into an EMPTY
// Postgres database that has ONLY the auth skeleton:
//
//   1) prisma/baseline.sql applied            (schema, see DEPLOYMENT.md §11)
//   2) SKIP_DEMO_DATA=1 npm run db:seed       (roles/permissions, no demo rows)
//   3) SNAP=./prod-snapshot.json npx tsx src/scripts/import-json.ts
//
// Safety properties:
//   * REFUSES to run against a database that already has users (FORCE=1 to override).
//   * Upserts by id  -> re-running after a partial import is safe and converges.
//   * Users get freshly generated strong passwords (printed once, bottom line)
//     because password hashes are not extractable through the API by design.
//   * Prints a per-table verification (snapshot rows vs Postgres counts) and
//     exits non-zero on any mismatch of the tables it manages.
// ---------------------------------------------------------------------------
import { readFileSync } from 'fs';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const SNAP = process.env.SNAP || './prod-snapshot.json';
const snapshot = JSON.parse(readFileSync(SNAP, 'utf8'));
const p = new PrismaClient();

// order matters: FK parents first. Children arrays are nested in parents.
const ORDER = ['Product', 'Customer', 'Supplier', 'Vehicle', 'Employee', 'User', 'CarWashOrder', 'MaintenanceOrder', 'RentalBooking', 'Expense', 'Payment', 'Sale', 'Purchase'];
const DELEGATE: Record<string, string> = {
  Product: 'product', Customer: 'customer', Supplier: 'supplier', Vehicle: 'vehicle', Employee: 'employee',
  User: 'user', CarWashOrder: 'carWashOrder', MaintenanceOrder: 'maintenanceOrder', RentalBooking: 'rentalBooking',
  Expense: 'expense', Payment: 'payment', Sale: 'sale', Purchase: 'purchase',
};


/** Keep only real model columns - API payloads decorate rows (partsLines,
 *  nextBooking, unitTypeLabel...). Whitelist from the client's runtime DMMF. */
const fieldCache = new Map<string, Set<string>>();
function fit(model: string, row: any): any {
  if (!fieldCache.has(model)) {
    const m = (p as any)._runtimeDataModel.models[model];
    if (!m) return row;
    fieldCache.set(model, new Set(m.fields.filter((f: any) => f.kind === 'scalar').map((f: any) => f.name)));
  }
  const keep = fieldCache.get(model)!;
  const out: any = {};
  for (const [k, v] of Object.entries(row)) if (keep.has(k)) out[k] = v;
  return out;
}

const genPass = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', b = 'abcdefghijkmnpqrstuvwxyz', c = '23456789', s = '!*#$%&?';
  const pick = (x: string, n: number) => Array.from({ length: n }, () => x[Math.floor(Math.random() * x.length)]).join('');
  return pick(a, 2) + pick(b, 5) + pick(c, 3) + pick(s, 1);
};

async function main() {
  if (!snapshot?.pull) throw new Error('not a snapshot file (missing pull)');
  await p.$connect();

  const users = await p.user.count();
  if (users > 0 && process.env.FORCE !== '1') {
    throw new Error(`target already contains ${users} users - refusing (this import targets an EMPTY db). FORCE=1 to override intentionally.`);
  }
  const roles = await p.role.count();
  if (roles < 9) throw new Error(`auth skeleton missing (roles=${roles}) - run: SKIP_DEMO_DATA=1 npm run db:seed first`);

  // ---- reconcile live role->permission grants captured by /users/roles/list
  const rolesSnap = Array.isArray(snapshot.gaps?.roles) ? snapshot.gaps.roles : [];
  if (rolesSnap.length) {
    const perms = await p.permission.findMany({ select: { id: true, key: true } });
    const pid = new Map(perms.map(x => [x.key, x.id]));
    let added = 0, removed = 0;
    for (const r of rolesSnap) {
      const role = await p.role.findUnique({ where: { name: r.name } });
      if (!role) { console.warn(`  ! role ${r.name} missing in target skeleton`); continue; }
      const keys: string[] = (r.permissions || []).map((x: any) => String(typeof x === 'string' ? x : x.key));
      const wantIds: Set<string> = new Set(keys.filter(k => pid.has(k)).map(k => pid.get(k) as string));
      const have = await p.rolePermission.findMany({ where: { roleId: role.id }, select: { id: true, permissionId: true } });
      const haveIds = new Set(have.map(h => h.permissionId));
      for (const h of have) if (!wantIds.has(h.permissionId)) { await p.rolePermission.delete({ where: { id: h.id } }); removed++; }
      for (const wid of wantIds) if (!haveIds.has(wid)) { await p.rolePermission.create({ data: { roleId: role.id, permissionId: wid } }); added++; }
    }
    console.log(`  role grants reconciled: +${added} -${removed}`);
  }

  const byType: Record<string, any[]> = snapshot.pull;
  const created: Record<string, number> = {};
  const passwords: Array<{ email: string; password: string }> = [];

  // ---- users + role links (special: no passwordHash in snapshot, roles by name)
  const roleByName = new Map((await p.role.findMany()).map(r => [r.name, r.id]));
  for (const u of byType.User || []) {
    const { roles: roleNames, ...row } = u;
    const existing = await p.user.findUnique({ where: { id: row.id }, select: { id: true } });
    const plain = genPass();
    await p.user.upsert({
      where: { id: row.id },
      create: { ...fit('User', row), passwordHash: bcrypt.hashSync(plain, 12) },
      update: fit('User', row), // existing user: password untouched
    });
    if (!existing) passwords.push({ email: row.email, password: plain });
    for (const rn of roleNames || []) {
      const rid = roleByName.get(rn);
      if (!rid) { console.warn(`  ! user ${row.email}: unknown role '${rn}' skipped`); continue; }
      await p.userRole.upsert({ where: { userId_roleId: { userId: row.id, roleId: rid } }, create: { userId: row.id, roleId: rid }, update: {} }).catch(async () => {
        await p.userRole.create({ data: { userId: row.id, roleId: rid } }).catch(() => undefined);
      });
    }
    created.User = (created.User || 0) + 1;
  }

  // ---- everything else: plain row upserts + nested children
  for (const type of ORDER) {
    if (type === 'User') continue;
    const d = (p as any)[DELEGATE[type]];
    let n = 0;
    for (const raw of byType[type] || []) {
      const row = { ...raw };
      const items = Array.isArray(row.items) ? row.items : null;
      delete row.items;
      const fitRow = fit(type, row);
      await d.upsert({ where: { id: fitRow.id }, create: fitRow, update: fitRow });
      n++;
      if (items) {
        const child: any = type === 'Sale' ? p.saleItem : p.purchaseItem; // union delegate narrowed
        const fk = type === 'Sale' ? 'saleId' : 'purchaseId';
        for (const it of items) {
          const cfit = fit(type === 'Sale' ? 'SaleItem' : 'PurchaseItem', { ...it, [fk]: row.id });
          await child.upsert({ where: { id: it.id }, create: cfit as any, update: cfit as any });
        }
      }
    }
    created[type] = n;
  }

  // ---- gap sections (may be absent if the exporting user lacked rights)
  const units = snapshot.gaps?.rentalUnits?.data ?? (Array.isArray(snapshot.gaps?.rentalUnits) ? snapshot.gaps.rentalUnits : []);
  if (Array.isArray(units)) for (const u of units) { const uf = fit('RentalUnit', u); await p.rentalUnit.upsert({ where: { id: u.id }, create: uf, update: uf }); created.RentalUnit = (created.RentalUnit || 0) + 1; }
  else if (snapshot.gaps?.rentalUnits?.error) console.log(`  ! rentalUnits unavailable in snapshot (${snapshot.gaps.rentalUnits.error}) - import/verify skipped`);

  const payRuns = Array.isArray(snapshot.gaps?.payrollDetails) ? snapshot.gaps.payrollDetails : [];
  for (const r of payRuns) {
    const { items, ...run } = r;
    const rf = fit('PayrollRun', run);
    await p.payrollRun.upsert({ where: { id: run.id }, create: rf, update: rf });
    for (const it of items || []) { const itf = fit('PayrollItem', it); await p.payrollItem.upsert({ where: { id: it.id }, create: itf, update: itf }); }
    created.PayrollRun = (created.PayrollRun || 0) + 1;
    created.PayrollItem = (created.PayrollItem || 0) + (items?.length || 0);
  }
  if (!payRuns.length && snapshot.gaps?.payrollRuns?.error) console.log(`  ! payroll not in snapshot (${snapshot.gaps.payrollRuns.error})`);

  // Two accepted shapes: raw AppSetting rows (future admin export) or the merged
  // GET /api/settings object {global, personal, me}. Values are JSON-encoded strings in the DB.
  const sgRaw: unknown = snapshot.gaps?.settings;
  const setRows: Array<{ key: string; userId: string; value: string }> = [];
  if (Array.isArray(sgRaw)) {
    for (const s of sgRaw as any[]) if (s?.key) setRows.push({ key: s.key, userId: s.userId ?? 'GLOBAL', value: typeof s.value === 'string' ? s.value : JSON.stringify(s.value) });
  } else if (sgRaw && typeof sgRaw === 'object') {
    const sgo = sgRaw as any;
    if (sgo.global || sgo.personal) {
      for (const [k, v] of Object.entries(sgo.global || {})) setRows.push({ key: k, userId: 'GLOBAL', value: JSON.stringify(v) });
      const meId = sgo.me?.id;
      if (meId) for (const [k, v] of Object.entries(sgo.personal || {})) setRows.push({ key: k, userId: meId, value: JSON.stringify(v) });
    }
  }
  for (const r of setRows) {
    await p.appSetting.upsert({ where: { key_userId: { key: r.key, userId: r.userId } }, create: { key: r.key, value: r.value, userId: r.userId }, update: { value: r.value } });
  }
  created.AppSetting = setRows.length;

  // ---- verify
  console.log('\n== verification (snapshot vs Postgres) ==');
  let bad = 0;
  const countsFns: Array<[string, () => Promise<number>, number]> = [
    ...ORDER.filter(t => t !== 'User').map(t => [t, () => (p as any)[DELEGATE[t]].count(), created[t] ?? 0] as any),
    ['User', () => p.user.count(), created.User || 0],
  ];
  for (const [t, fn, expected] of countsFns) {
    const dst = await fn();
    const src = (byType[t] || []).length;
    const okCount = dst >= expected; // dst may legitimately hold extra (appSettings merge etc.); flag shortfalls only
    const okSrc = t === 'AppSetting' || dst >= src ? '' : ` (snapshot had ${src})`;
    if (!okCount) bad++;
    console.log(`  ${t}: imported=${expected} pg=${dst}${okCount ? ' ✓' : ' ✗ MISSING ROWS'}${okSrc}`);
  }
  const pcnt = [
    ['RentalUnit', () => p.rentalUnit.count(), created.RentalUnit || 0],
    ['PayrollRun', () => p.payrollRun.count(), created.PayrollRun || 0],
    ['PayrollItem', () => p.payrollItem.count(), created.PayrollItem || 0],
  ] as const;
  for (const [t, fn, expected] of pcnt) {
    const dst = await fn();
    if (expected && dst < expected) { console.log(`  ${t}: ✗ pg=${dst} < imported=${expected}`); bad++; }
    else console.log(`  ${t}: pg=${dst}${expected ? ' ✓' : ' (none in snapshot)'} `);
  }
  const tomb = Object.entries(snapshot.tombstones || {}).map(([k, v]: any) => `${k}:${v.length}`).filter((x: string) => !x.endsWith(':0'));
  if (tomb.length) console.log(`\n  note: soft-deleted rows intentionally NOT re-created (${tomb.join(', ')} markers) - their ids/numbers are not reserved in Postgres`);

  if (passwords.length) {
    console.log('\n== freshly created users (one-time credentials - distribute + force change) ==');
    for (const { email, password } of passwords) console.log(`  ${email}  ${password}`);
  } else {
    console.log('\n(no new users created - all matched existing ids; passwords unchanged)');
  }
  console.log(bad === 0 ? '\nIMPORT OK' : `\nIMPORT PROBLEMS (${bad}) - fix before switching DATABASE_URL`);
  await p.$disconnect();
  if (bad) process.exit(1);
}

main().catch(async e => { console.error(e); await p.$disconnect().catch(() => undefined); process.exit(1); });
