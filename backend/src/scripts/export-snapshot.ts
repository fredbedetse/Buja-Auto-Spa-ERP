// ---------------------------------------------------------------------------
// Read-only production snapshotter. Works WITHOUT Render shell / persistent
// disk: it extracts every row through the API the deployed app already serves
// (POST /api/sync/pull per entity type + a few existing GET gap-fills).
// No server-side code changes required; purely read-only traffic.
//
//   API_URL=https://buja-auto-spa-backend.onrender.com \
//   SNAPSHOT_EMAIL=admin@yourdomain SNAPSHOT_PASSWORD='***' \
//   npx tsx src/scripts/export-snapshot.ts            # writes ./prod-snapshot.json
//
// Use an ADMIN account: cashier/mechanic roles would get 403 on payroll/settings.
// The snapshot deliberately records (in meta) what is NOT recoverable through
// public APIs: user password hashes (login projection), AuditLog history and
// Sessions. See DEPLOYMENT.md §12 data-completeness matrix.
// ---------------------------------------------------------------------------
import { writeFileSync } from 'fs';

const API = (process.env.API_URL || 'https://buja-auto-spa-backend.onrender.com').replace(/\/+$/, '') + '/api';
const EMAIL = process.env.SNAPSHOT_EMAIL || '';
const PASSWORD = process.env.SNAPSHOT_PASSWORD || '';
const OUT = process.env.SNAPSHOT_OUT || './prod-snapshot.json';
const DEVICE_ID = 'snapshot-exporter-v1';
const PAGE = 500; // pull limit cap in routes/sync.ts

const PULL_TYPES = [
  'User', 'Product', 'Customer', 'Sale', 'Supplier', 'Purchase', 'Vehicle',
  'Employee', 'CarWashOrder', 'MaintenanceOrder', 'Payment', 'RentalBooking', 'Expense',
];

let token = '';
async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init?.headers || {}) },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) { const e: any = new Error(`${r.status} ${path}: ${JSON.stringify(body).slice(0, 160)}`); e.status = r.status; throw e; }
  return body;
}

// NB: we do NOT trust the requested-type label - the server emits each row's
// own entityType (e.g. purchases come back labelled 'Purchase' even when the
// page was requested via 'Supplier'). Everything lands in global buckets.
const allRows = new Map<string, Map<string, any>>();   // entityType -> entityId -> data
const allTomb = new Map<string, any[]>();               // entityType -> markers

async function pullType(type: string) {
  let cursor: string | null = null;
  let seen = 0;
  for (let page = 0; page < 200; page++) {
    const res = await api('/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ deviceId: DEVICE_ID, entityTypes: [type], limit: PAGE, ...(cursor ? { lastSyncAt: cursor } : {}) }),
    });
    const changes: any[] = res.changes || [];
    let newest: string | null = cursor;
    let fresh = 0;
    for (const c of changes) {
      if (c.operation === 'DELETE') {
        if (!allTomb.has(c.entityType)) allTomb.set(c.entityType, []);
        allTomb.get(c.entityType)!.push({ entityId: c.entityId, version: c.version, timestamp: c.timestamp });
      } else {
        if (!allRows.has(c.entityType)) allRows.set(c.entityType, new Map());
        allRows.get(c.entityType)!.set(c.entityId, c.data);
        fresh++;
        if (!newest || c.timestamp > newest) newest = c.timestamp;
      }
    }
    seen += changes.filter(c => c.operation !== 'DELETE').length;
    if (fresh < PAGE && changes.length < PAGE) break;             // drained
    if (!newest || newest === cursor) { console.warn(`  ! ${type}: page boundary at identical timestamps - bumping past it`); cursor = new Date(new Date(cursor || 0).getTime() + 1).toISOString(); continue; }
    cursor = newest;
  }
  return seen;
}

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error('set SNAPSHOT_EMAIL and SNAPSHOT_PASSWORD (an ADMIN account)');
  console.log('source:', API);
  const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: EMAIL, password: PASSWORD }) });
  token = login.accessToken || (() => { throw new Error('login failed: no accessToken'); })();
  console.log('logged in as', login.user?.email, '(' + (login.user?.roles || []).join(',') + ')');

  const counts: Record<string, number> = {};
  for (const t of PULL_TYPES) counts[t] = await pullType(t);
  const pull: Record<string, any> = {};
  for (const [t, m] of allRows) pull[t] = [...m.values()];
  const tombstones: Record<string, any> = {};
  for (const [t, v] of allTomb) tombstones[t] = v.slice(0, 3000);
  for (const [t, rows] of Object.entries(pull)) console.log(`  = ${t}: ${rows.length} rows`);

  const gaps: Record<string, any> = {};
  const tryGet = async (key: string, path: string) => {
    try { gaps[key] = await api(path); console.log(`  ~ ${key}: ok`); }
    catch (e: any) { gaps[key] = { error: String(e.message).slice(0, 120) }; console.log(`  ! ${key}: ${e.status || ''} - recorded as unavailable`); }
  };
  // /rentals/units REQUIRES ?class= (400 otherwise) - collect both fleets
  try {
    const ev = await api('/rentals/units?class=EV');
    const tr = await api('/rentals/units?class=TRUCK');
    gaps.rentalUnits = { data: [...(ev.data || []), ...(tr.data || [])] };
    console.log(`  ~ rentalUnits: ${gaps.rentalUnits.data.length} rows (EV+TRUCK)`);
  } catch (e2: any) { gaps.rentalUnits = { error: String(e2.message).slice(0, 120) }; console.log(`  ! rentalUnits: ${e2.status || ''} - recorded as unavailable`); }
  await tryGet('roles', '/users/roles/list'); // live per-role grants (may differ from seed)
  await tryGet('payrollRuns', '/payroll/runs');
  if (Array.isArray(gaps.payrollRuns?.data)) {
    gaps.payrollDetails = [];
    for (const r of gaps.payrollRuns.data) { try { gaps.payrollDetails.push(await api('/payroll/runs/' + r.id)); } catch { /* keep going */ } }
  }
  await tryGet('settings', '/settings');
  await tryGet('brand', '/settings/brand');

  const snapshot = {
    meta: {
      exportedAt: new Date().toISOString(), source: API, exportedBy: EMAIL, tool: 'export-snapshot.ts v1',
      NOT_captured: ['User.passwordHash (API projection excludes it - importer sets fresh strong passwords; rotate after)', 'AuditLog history', 'Sessions (clients just re-login)', 'deviceId/lastSync bookkeeping is re-derivable'],
    },
    pull, tombstones, gaps,
  };
  writeFileSync(OUT, JSON.stringify(snapshot, null, 1));
  const total = Object.values(pull).reduce((a: number, v: any) => a + v.length, 0);
  console.log(`\nsnapshot written: ${OUT} (${total} business rows + gap sections)`);
  console.log('STORE THIS FILE IN AT LEAST TWO PLACES (e.g. laptop + Google Drive). It is the export.')
}

main().catch(e => { console.error(e); process.exit(1); });
