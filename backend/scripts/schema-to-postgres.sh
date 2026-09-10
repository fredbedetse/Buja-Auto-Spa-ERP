#!/usr/bin/env bash
# Keeps prisma/schema.postgres.prisma in sync with the dev SQLite schema.
# Run from repo root after adding a migration, then commit both files.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p prisma
sed -e 's/provider *= *"sqlite"/provider = "postgresql"/' prisma/schema.prisma > prisma/schema.postgres.prisma
echo "wrote prisma/schema.postgres.prisma"
