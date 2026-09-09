// Rental rate catalog - BIF canonical. The API recomputes every booking from these numbers,
// so offline clients can never forge rates, discounts or overtime charges.

export const RENTAL_TYPES = {
  CITY_CAR:     { cls: 'EV',    label: 'Electric city car',   rate: 90000,  deposit: 150000 },
  VAN_EV:       { cls: 'EV',    label: 'Electric van',        rate: 120000, deposit: 200000 },
  TRUCK_EV:     { cls: 'EV',    label: 'Electric truck 3.5t', rate: 260000, deposit: 400000 },
  TRUCK_3T:     { cls: 'TRUCK', label: 'Truck 3 ton',         rate: 150000, deposit: 250000 },
  TRUCK_8T:     { cls: 'TRUCK', label: 'Truck 8 ton',         rate: 280000, deposit: 500000 },
  TRAILER_HEAD: { cls: 'TRUCK', label: 'Trailer head',        rate: 350000, deposit: 600000 },
  BUS_CHARTER:  { cls: 'TRUCK', label: 'Bus charter',         rate: 420000, deposit: 700000 },
} as const;

export type RentalTypeKey = keyof typeof RENTAL_TYPES;
export const TYPE_KEYS = Object.keys(RENTAL_TYPES) as RentalTypeKey[];

export const INSURANCE_PER_DAY = 15000; // BIF
export const WEEKLY_FACTOR = 0.85;      // full 7-day blocks priced at 85%

const DAY = 86400000;
const r100 = (n: number) => Math.round(n / 100) * 100;

export function rentalDays(startDate: Date, endDate: Date): number {
  const s = new Date(startDate).setHours(0, 0, 0, 0);
  const e = new Date(endDate).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((e - s) / DAY) + 1); // end date is inclusive
}

/** Day window [start, end+1) for overlap checks. */
export const dayWindow = (startDate: Date, endDate: Date) => {
  const s = new Date(new Date(startDate).setHours(0, 0, 0, 0));
  const e = new Date(new Date(endDate).setHours(0, 0, 0, 0) + DAY); // exclusive
  return { s, e };
};

export function priceBooking(unitType: string, startDate: Date, endDate: Date, insurance = false) {
  const t = (RENTAL_TYPES as any)[unitType] || RENTAL_TYPES.CITY_CAR;
  const days = rentalDays(startDate, endDate);
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  const list = t.rate * days;
  const rentAmount = r100(t.rate * rest + t.rate * WEEKLY_FACTOR * 7 * weeks);
  const discount = Math.max(0, list - rentAmount);
  const insuranceTotal = insurance ? r100(INSURANCE_PER_DAY * days) : 0;
  const totalAmount = rentAmount + insuranceTotal;
  return { dailyRate: t.rate, deposit: t.deposit, days, rentAmount, discount, insuranceTotal, totalAmount };
}

/** Late-return charge: 5% of the daily rate per late hour, capped at 1 day. */
export function overtimeFee(dailyRate: number, endDate: Date, actualReturn: Date): number {
  const due = new Date(new Date(endDate).setHours(0, 0, 0, 0) + DAY); // end of the last rental day
  const lateMs = new Date(actualReturn).getTime() - due.getTime();
  if (lateMs <= 0) return 0;
  const hours = Math.min(24, Math.ceil(lateMs / 3600000));
  return Math.min(r100(dailyRate * 0.05) * hours, dailyRate);
}

export function catalogSnapshot() {
  return {
    types: TYPE_KEYS.map(k => ({ key: k, cls: RENTAL_TYPES[k].cls, label: RENTAL_TYPES[k].label, rate: RENTAL_TYPES[k].rate, deposit: RENTAL_TYPES[k].deposit })),
    insurancePerDay: INSURANCE_PER_DAY,
    weeklyFactor: WEEKLY_FACTOR,
    currency: 'BIF',
    peg: 6000,
  };
}
