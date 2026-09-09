// Currency-aware money formatting. Canonical storage unit is BIF; USD is a
// display/input layer at the fixed peg 1 USD = 6,000 BIF (uiStore.USD_TO_BIF).
import { useUiStore, USD_TO_BIF } from '../stores/uiStore';

export const CUR_LABEL = (c: 'bif' | 'usd') => (c === 'usd' ? 'USD' : 'BIF');

/** Format a BIF amount in the user's chosen currency */
export function fmtMoneyBif(bif: number | null | undefined, currency: 'bif' | 'usd'): string {
  const n = bif || 0;
  if (currency === 'usd') {
    return `$${(n / USD_TO_BIF).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(n).toLocaleString('en-US')} BIF`;
}

/** Reactive hook: returns formatters bound to the current currency */
export function useMoney() {
  const currency = useUiStore(s => s.currency);
  return {
    currency,
    curLabel: CUR_LABEL(currency),
    /** BIF (storage) -> formatted string for display */
    fmt: (bif: number | null | undefined) => fmtMoneyBif(bif, currency),
    /** BIF (storage) -> number in display currency (for editing inputs) */
    toDisplay: (bif: number) => (currency === 'usd' ? Math.round((bif / USD_TO_BIF) * 100) / 100 : Math.round(bif * 100) / 100),
    /** display-currency number -> BIF for the API */
    toBif: (display: number) => (currency === 'usd' ? Math.round(display * USD_TO_BIF * 100) / 100 : Math.round(display * 100) / 100),
  };
}

/** Non-reactive formatter for module-level render helpers */
export const fmtNow = (bif: number | null | undefined) => fmtMoneyBif(bif, useUiStore.getState().currency);
