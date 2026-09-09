// ---------------------------------------------------------------------------
// Phase 15: one hard place for runtime configuration. Dev is forgiving,
// production refuses to boot with weak/missing secrets.
// ---------------------------------------------------------------------------

const truthy = (v: string | undefined, dflt = false) =>
  v === undefined ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const isProd = process.env.NODE_ENV === 'production';

const WEAK = ['change-this', 'fallback-secret', 'fallback-refresh', 'dev-secret', 'secret-key-min', 'please-change', 'your-', 'xxxx'];

function originsFromEnv(): string[] {
  const raw = process.env.CORS_ORIGIN || '';
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (list.length) return list;
  const fe = process.env.FRONTEND_URL || 'http://localhost:5173';
  return isProd ? [fe] : [fe, 'http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'];
}

export const ENV = {
  node: process.env.NODE_ENV || 'development',
  isProd,
  port: Number(process.env.PORT || 4000),
  corsOrigins: originsFromEnv(),
  trustProxy: truthy(process.env.TRUST_PROXY, isProd),
  jsonLogs: truthy(process.env.JSON_LOGS, isProd),

  jwtSecret: process.env.JWT_SECRET || (isProd ? '' : 'dev-only-insecure-jwt-secret-32chars!'),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || (isProd ? '' : 'dev-only-insecure-refresh-secret-32!'),
  accessTtl: process.env.JWT_EXPIRES_IN || '15m',
  refreshTtl: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  databaseUrl: process.env.DATABASE_URL || '',
  prismaResetOnBoot: truthy(process.env.PREVIEW_RELEASE, false),

  // rate limiting (generous in dev so the QA matrix never trips it)
  authRateMax: Number(process.env.AUTH_RATE_MAX || (isProd ? 20 : 100000)),
  authRateWindowMs: Number(process.env.AUTH_RATE_WINDOW_MS || 15 * 60 * 1000),
  globalRateMax: Number(process.env.GLOBAL_RATE_MAX || (isProd ? 600 : 1000000)),
  globalRateWindowMs: Number(process.env.GLOBAL_RATE_WINDOW_MS || 60 * 1000),
};

/** Returns a list of fatal production config problems (empty = ok). */
export function productionConfigIssues(): string[] {
  if (!ENV.isProd) return [];
  const issues: string[] = [];
  const weak = (v: string) => !v || v.length < 32 || WEAK.some(w => v.toLowerCase().includes(w));
  if (weak(ENV.jwtSecret)) issues.push('JWT_SECRET must be set to a unique random value of at least 32 chars (see DEPLOYMENT.md, step 2)');
  if (weak(ENV.jwtRefreshSecret)) issues.push('JWT_REFRESH_SECRET must be set (different from JWT_SECRET, at least 32 chars)');
  if (ENV.jwtSecret && ENV.jwtSecret === ENV.jwtRefreshSecret) issues.push('JWT_SECRET and JWT_REFRESH_SECRET must not be equal');
  if (!ENV.databaseUrl) issues.push('DATABASE_URL must be set (postgres://... in production)');
  if (!process.env.CORS_ORIGIN && !process.env.FRONTEND_URL) issues.push('Set CORS_ORIGIN (or FRONTEND_URL) to your public origin(s)');
  return issues;
}
