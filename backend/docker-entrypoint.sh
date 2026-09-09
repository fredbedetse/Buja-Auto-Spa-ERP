#!/bin/sh
set -e
# Postgres schema mode for the compose stack (provider is not env-switchable in Prisma 5).
if [ "$PRISMA_SCHEMA" = "postgres" ] && [ -f prisma/schema.postgres.prisma ]; then
  cp prisma/schema.postgres.prisma prisma/schema.prisma
  npx prisma generate >/dev/null 2>&1 || true
fi
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  if ! npx prisma migrate deploy; then
    echo "migrate deploy failed (fresh Postgres DB or provider mismatch) - falling back to db push"
    npx prisma db push --skip-generate
  fi
fi
if [ "${RUN_SEED:-0}" = "1" ]; then node dist/seed.js; fi
exec node dist/index.js
