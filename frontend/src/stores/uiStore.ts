import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'en' | 'fr';
export type Currency = 'bif' | 'usd';
export type Theme = 'light' | 'dark' | 'system';

/** Fixed peg used across the app: 1 USD = 6,000 BIF */
export const USD_TO_BIF = 6000;

interface UiState {
  language: Language;
  currency: Currency;
  theme: Theme;
  reduceMotion: boolean;
  setLanguage: (l: Language) => void;
  setCurrency: (c: Currency) => void;
  setTheme: (t: Theme) => void;
  setReduceMotion: (v: boolean) => void;
}

/**
 * Fire-and-forget mirror of the four personal prefs to the server so they
 * follow the user across devices. Skipped when unauthenticated/offline -
 * local storage stays the source of truth for the current device.
 */
function syncPersonalPrefs() {
  try {
    const s = useUiStore.getState();
    const tok = localStorage.getItem('buja_access_token');
    if (!tok) return;
    fetch((import.meta.env.VITE_API_URL || '/api') + '/settings/personal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ theme: s.theme, currency: s.currency, language: s.language, reduceMotion: s.reduceMotion }),
    }).catch(() => undefined);
  } catch { /* never let a prefs mirror break the UI */ }
}

/** Resolve the effective dark flag and stamp it on <html> (idempotent). */
export function applyTheme() {
  const { theme, reduceMotion } = useUiStore.getState();
  const dark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b1220' : '#C1272D');
  return dark;
}

export const useUiStore = create<UiState>()(
  persist(
    set => ({
      language: 'en',
      currency: 'bif',
      theme: 'light',
      reduceMotion: false,
      setLanguage: language => { set({ language }); syncPersonalPrefs(); },
      setCurrency: currency => { set({ currency }); syncPersonalPrefs(); },
      setTheme: t => { set({ theme: t }); applyTheme(); syncPersonalPrefs(); },
      setReduceMotion: v => { set({ reduceMotion: v }); applyTheme(); syncPersonalPrefs(); },
    }),
    { name: 'buja-ui-prefs' }
  )
);

/** Plain (non-hook) access for helpers & event handlers */
export const getUiPrefs = () => useUiStore.getState();

if (typeof window !== 'undefined') {
  // class bootstrap (first paint already handled inline in index.html) + live OS-theme tracking
  applyTheme();
  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => {
    if (useUiStore.getState().theme === 'system') applyTheme();
  });
}
