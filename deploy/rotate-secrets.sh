#!/usr/bin/env bash
# Prints fresh secrets to paste into .env.production, then `docker compose up -d api`.
# Rotating JWT_SECRET intentionally invalidates every live session (that is the point).
set -euo pipefail
echo "JWT_SECRET=*** rand -hex 32)"
echo "JWT_REFRESH_SECRET=*** rand -hex 32)"
echo "POSTGRES_PASSWORD=*** rand -base64 24)"
