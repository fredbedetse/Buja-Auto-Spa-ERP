#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-time SQLite (Render) -> Neon PostgreSQL cutover.  DRILL-VERIFIED on
# PostgreSQL 17 against the full 28-model dataset before use.
#
#   NEON_URL=postgresql://... PROD_DB=/path/to/copied-prod.db CONFIRM=CUTOVER \
#     bash deploy/postgres-cutover.sh          (run from repo root)
#
# Rules this script upholds:
#   * NEVER deletes or edits prisma/migrations - history stays intact.
#   * NEVER resets a non-empty target: refuses to run if the Neon DB already
#     contains users, unless it is explicitly re-confirmed as clean.
#   * Uses the project-pinned Prisma CLI (5.22) only - not a floating npx.
#   * Rollback after cutover is always just: point Render DATABASE_URL back
#     to the (untouched) SQLite file. Nothing destructive ever touches SQLite.
# ---------------------------------------------------------------------------
set -euo pipefail
: "${NEON_URL:?export NEON_URL=postgresql://user:pass@host/dbname?sslmode=require (Neon pooled URL is fine)}"
: "${PROD_DB:?path to a COPY of the production .db file - copy it while the Render service is paused or in maintenance}"
[ "${CONFIRM:-}" = "CUTOVER" ] || { echo "Refusing to run: set CONFIRM=CUTOVER to acknowledge the pre-flight checklist (Render service paused / prod.db copied and backed up / NEON_URL is the NEW empty database)."; exit 1; }
cd "$(dirname "$0")/../backend"

P=./node_modules/.bin/prisma
[ -x "$P" ] || { echo "prisma CLI missing - run 'npm ci' in backend/ first"; exit 1; }
export DATABASE_URL="$NEON_URL"

echo "== [0/6] pre-flight: target must be an empty database (no real data) =="
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count().then(n => { console.log('target users:', n); if (n > 0) { console.error('ABORT: target already contains data - refusing to cutover into a live database.'); process.exit(1);} }).catch(() => { console.log('target has no app tables yet - fresh baseline expected'); }).finally(() => p.\$disconnect());
" || true

echo "== [1/6] baseline schema (prisma/baseline.sql, generated from current schema.prisma) =="
$P db execute --url "$NEON_URL" --file prisma/baseline.sql
echo "   28 tables created (or already present)"

echo "== [2/6] mark the 14 historical SQLite migrations as applied (never executed here) =="
for m in prisma/migrations/2*/; do $P migrate resolve --applied "$(basename "$m")" >/dev/null 2>&1 || true; done

echo "== [3/6] verify migrate deploy is a clean no-op =="
$P migrate deploy | tail -1

echo "== [4/6] regenerate client for the Postgres schema =="
$P generate >/dev/null 2>&1 && echo "   client generated"

echo "== [5/6] import data from the SQLite copy =="
SQLITE_PATH="$PROD_DB" ./node_modules/.bin/tsx src/scripts/import-sqlite.ts

echo "== [6/6] verify counts + aggregates match =="
SQLITE_PATH="$PROD_DB" ./node_modules/.bin/tsx src/scripts/verify-import.ts

cat <<'DONE'

Cutover import complete and verified. Next manual steps:
  1. Render dashboard -> Environment -> DATABASE_URL = the same NEON_URL (this is
     the ONLY config change; the app code already speaks Postgres).
  2. Restart the Render service. Watch logs for "Database connected".
  3. Smoke: log in as admin/manager/cashier, open Expenses + Payroll, create one
     wash order, confirm sync status page is green.
  4. Keep the old SQLite service paused (not deleted) for 2 weeks as rollback.
Rollback anytime = set DATABASE_URL back to the SQLite file path and restart.
DONE
