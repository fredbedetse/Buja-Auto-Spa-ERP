// Car Wash price catalog - BIF canonical, per-vehicle-type surcharge multipliers.
// The API recomputes prices from this catalog so offline clients can never forge totals.

export const WASH_SERVICES = {
  EXPRESS: { base: 5000 },   // quick exterior rinse
  CLASSIC: { base: 10000 },  // exterior wash + dry
  PREMIUM: { base: 18000 },  // exterior + interior vacuum
  INTERIOR: { base: 12000 }, // deep interior clean
  ENGINE: { base: 15000 },   // engine bay wash
  FULL: { base: 25000 },     // full detail inside-out
  WAX: { base: 20000 },      // polish + wax
} as const;

export const WASH_VEHICLE_TYPES = {
  SEDAN: { multiplier: 1.0 },
  SUV: { multiplier: 1.25 },
  VAN: { multiplier: 1.3 },
  PICKUP: { multiplier: 1.2 },
  TRUCK: { multiplier: 1.6 },
  BUS: { multiplier: 2.0 },
} as const;

export type WashServiceKey = keyof typeof WASH_SERVICES;
export type WashVehicleKey = keyof typeof WASH_VEHICLE_TYPES;

export const SERVICE_KEYS = Object.keys(WASH_SERVICES) as WashServiceKey[];
export const VEHICLE_KEYS = Object.keys(WASH_VEHICLE_TYPES) as WashVehicleKey[];

/** Returns { basePrice, surcharge, total } in BIF, rounded to the nearest 100. */
export function priceWash(serviceType: string, vehicleType: string, discount = 0) {
  const svc = (WASH_SERVICES as any)[serviceType] || WASH_SERVICES.CLASSIC;
  const veh = (WASH_VEHICLE_TYPES as any)[vehicleType] || WASH_VEHICLE_TYPES.SEDAN;
  const basePrice = svc.base;
  const gross = Math.round((svc.base * veh.multiplier) / 100) * 100;
  const surcharge = Math.max(0, gross - basePrice);
  const disc = Math.min(Math.max(0, Math.round(discount || 0)), gross); // never below zero
  const total = gross - disc;
  return { basePrice, surcharge, discount: disc, total };
}

export function catalogSnapshot() {
  return {
    services: SERVICE_KEYS.map(k => ({ key: k, base: WASH_SERVICES[k].base })),
    vehicleTypes: VEHICLE_KEYS.map(k => ({ key: k, multiplier: WASH_VEHICLE_TYPES[k].multiplier })),
    currency: 'BIF',
    peg: 6000,
  };
}
