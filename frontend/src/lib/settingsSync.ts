import apiClient from './api';
import { useUiStore } from '../stores/uiStore';

// ---------------------------------------------------------------------------
// Phase 14: personal-preference round-trip. Local storage is instant; the
// server copy is what follows the user to another device. On first authed
// load per session we pull once and adopt the server values (they win, so a
// fresh machine shows what the user last picked). Writes are mirrored back
// fire-and-forget from uiStore's setters.
// ---------------------------------------------------------------------------

let pulled = false;
type Brand = { companyName: string; location: string };
let brand: Brand | null = null;
const brandWaiters: Array<(b: { companyName: string; location: string }) => void> = [];

export async function pullPersonalSettings(): Promise<void> {
  if (pulled) return;
  const tok = localStorage.getItem('buja_access_token');
  if (!tok) return;
  pulled = true;
  try {
    const s = await apiClient.get<{ personal?: Record<string, any>; global?: Record<string, any> }>('/settings');
    const p = s.personal || {};
    const ui = useUiStore.getState() as any;
    let dirty = false;
    if ((p.theme === 'light' || p.theme === 'dark' || p.theme === 'system') && p.theme !== ui.theme) { ui.setTheme(p.theme); dirty = true; }
    if (typeof p.reduceMotion === 'boolean' && p.reduceMotion !== ui.reduceMotion) ui.setReduceMotion(p.reduceMotion);
    if ((p.currency === 'bif' || p.currency === 'usd') && p.currency !== ui.currency) ui.setCurrency(p.currency);
    if ((p.language === 'en' || p.language === 'fr') && p.language !== ui.language) ui.setLanguage(p.language);
    void dirty;
  } catch { /* offline - local prefs already applied by the bootstrap script */ }
}

export function resetSettingsPullFlag() { pulled = false; }

export async function getBrand(): Promise<Brand> {
  if (brand) return brand;
  let b: Brand;
  try {
    // bare fetch on purpose: public endpoint, must not trip apiClient's auth-refresh retry loop
    const r = await fetch((import.meta.env.VITE_API_URL || '/api') + '/settings/brand');
    if (!r.ok) throw new Error('brand ' + r.status);
    b = await r.json();
  } catch {
    b = { companyName: 'Buja Auto Spa', location: 'Bujumbura, Burundi' };
  }
  brand = b;
  brandWaiters.splice(0).forEach(cb => cb(b));
  return b;
}
export function onBrand(cb: (b: Brand) => void) {
  if (brand) cb(brand); else brandWaiters.push(cb);
}
