// JSON-capable console logger (Phase 15). Human lines in dev, JSON in prod.
import { ENV } from '../config/env';

type Level = 'info' | 'warn' | 'error';
export function log(level: Level, msg: string, fields: Record<string, any> = {}) {
  if (ENV.jsonLogs) {
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n');
  } else {
    const extra = Object.keys(fields).length ? ' ' + JSON.stringify(fields) : '';
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`${msg}${extra}`);
  }
}
