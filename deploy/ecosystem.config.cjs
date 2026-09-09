// PM2 alternative for hosts without Docker (single VM, sqlite or managed PG).
//   cd backend && npm ci && npm run build && pm2 start ../deploy/ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'buja-api',
    cwd: `${__dirname}/../backend`,
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production' }, // JWT_SECRET et al. come from backend/.env
  }],
};
