import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'en' | 'fr';
export type Currency = 'bif' | 'usd';

/** Fixed peg used across the app: 1 USD = 6,000 BIF */
export const USD_TO_BIF = 6000;

interface UiState {
  language: Language;
  currency: Currency;
  setLanguage: (l: Language) => void;
  setCurrency: (c: Currency) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    set => ({
      language: 'en',
      currency: 'bif',
      setLanguage: language => set({ language }),
      setCurrency: currency => set({ currency }),
    }),
    { name: 'buja-ui-prefs' }
  )
);

/** Plain (non-hook) access for helpers & event handlers */
export const getUiPrefs = () => useUiStore.getState();
