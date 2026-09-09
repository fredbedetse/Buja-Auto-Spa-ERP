// Maintenance labor catalog - BIF canonical. Labor = service hours x shop hourly rate,
// rounded to the nearest 100. Parts are priced from live Product rows at write time.
// The API always recomputes money server-side, so offline clients can never forge totals.

export const MAINT_HOURLY_RATE = 20000; // BIF per mechanic-hour

export const MAINT_SERVICES = {
  OIL:     { label: 'Oil & filter change', hours: 1 },
  FULL:    { label: 'Full service', hours: 4 },
  BRAKES:  { label: 'Brake service', hours: 2 },
  TIRES:   { label: 'Tyre rotation & balance', hours: 1.5 },
  DIAG:    { label: 'Diagnostics & road test', hours: 1 },
  AC:      { label: 'A/C service', hours: 2.5 },
  COOLANT: { label: 'Coolant flush', hours: 1.25 },
  BELT:    { label: 'Timing belt replacement', hours: 6 },
} as const;

export type MaintServiceKey = keyof typeof MAINT_SERVICES;
export const SERVICE_KEYS = Object.keys(MAINT_SERVICES) as MaintServiceKey[];

/** labor+parts-discount math in BIF. Discount clamps at gross so totals never go negative. */
export function priceMaint(serviceType: string, partsTotal = 0, discount = 0) {
  const svc = (MAINT_SERVICES as any)[serviceType] || MAINT_SERVICES.OIL;
  const laborHours = svc.hours;
  const laborTotal = Math.round((svc.hours * MAINT_HOURLY_RATE) / 100) * 100;
  const parts = Math.max(0, Math.round(partsTotal || 0));
  const gross = laborTotal + parts;
  const disc = Math.min(Math.max(0, Math.round(discount || 0)), gross);
  const total = gross - disc;
  return { laborHours, laborTotal, partsTotal: parts, discount: disc, total };
}

export function catalogSnapshot() {
  return {
    services: SERVICE_KEYS.map(k => ({
      key: k, label: MAINT_SERVICES[k].label, hours: MAINT_SERVICES[k].hours,
      labor: Math.round((MAINT_SERVICES[k].hours * MAINT_HOURLY_RATE) / 100) * 100,
    })),
    hourlyRate: MAINT_HOURLY_RATE,
    currency: 'BIF',
    peg: 6000,
  };
}
