import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { priceBooking, overtimeFee, catalogSnapshot, TYPE_KEYS, RENTAL_TYPES } from '../lib/rentalCatalog';

const router = Router();
router.use(authenticate);

const CLASS_KEYS = { EV: 'evrentals', TRUCK: 'truckrentals' } as const;
const DAY = 86400000;
const midnight = (v: any) => new Date(new Date(v).setUTCHours(0, 0, 0, 0));

function canClass(req: AuthenticatedRequest, cls: string, action: 'read' | 'manage'): boolean {
  const mod = CLASS_KEYS[cls as 'EV' | 'TRUCK'];
  const perms = req.user?.permissions || [];
  // same convention as the rest of the API: manage implies read
  return !!req.user && (req.user.roles.includes('SUPER_ADMIN') || perms.includes(`${mod}:${action}`) || (action === 'read' && perms.includes(`${mod}:manage`)));
}
// row-scoped ops (/:id) can't know the class up front: allow if the user may manage EITHER board
const guardAny = (action: 'read' | 'manage') => (req: AuthenticatedRequest, res: any, next: any) => {
  const ok = canClass(req, 'EV', action) || canClass(req, 'TRUCK', action);
  if (!ok) return res.status(403).json({ error: 'Insufficient permissions', required: `rentals:${action}` });
  next();
};

const guard = (action: 'read' | 'manage') => (req: AuthenticatedRequest, res: any, next: any) => {
  const cls = String(req.query.class || req.body?.fleetClass || '');
  if (cls !== 'EV' && cls !== 'TRUCK') return res.status(400).json({ error: 'class must be EV or TRUCK' });
  if (!canClass(req, cls, action)) return res.status(403).json({ error: 'Insufficient permissions', required: `${CLASS_KEYS[cls as 'EV' | 'TRUCK']}:${action}` });
  next();
};

const unitSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  fleetClass: z.enum(['EV', 'TRUCK']),
  unitType: z.enum(TYPE_KEYS as any),
  plate: z.string().max(30).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  deviceId: z.string().optional(),
});
const unitPatchSchema = unitSchema.partial().extend({
  status: z.enum(['ACTIVE', 'MAINTENANCE']).optional(),
  odometerKm: z.number().int().min(0).max(2000000).optional(),
  version: z.number().int().optional(),
});
const bookingCreateSchema = z.object({
  id: z.string().uuid().optional(),
  fleetClass: z.enum(['EV', 'TRUCK']),
  unitId: z.string().min(1),
  customerName: z.string().min(2, 'Customer name is required').max(160),
  customerPhone: z.string().max(40).optional().nullable(),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  insurance: z.boolean().default(false),
  notes: z.string().max(2000).optional().nullable(),
  deviceId: z.string().optional(),
});
const bookingPatchSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'RETURNED', 'CANCELLED']).optional(),
  unitId: z.string().min(1).optional(),
  customerName: z.string().min(2).max(160).optional(),
  customerPhone: z.string().max(40).nullable().optional(),
  startDate: z.string().min(8).optional(),
  endDate: z.string().min(8).optional(),
  insurance: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  damageNotes: z.string().max(2000).nullable().optional(),
  returnLevel: z.number().int().min(0).max(100).optional(),
  mileageOut: z.number().int().min(0).max(2000000).optional(),
  mileageReturn: z.number().int().min(0).max(2000000).optional(),
  refundDeposit: z.boolean().optional(),
  paymentMethod: z.enum(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE']).nullable().optional(),
  version: z.number().int().optional(),
});

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({ data: { userId: userId || 'system', action, entityId, entityType: 'RentalBooking', newData: newData ? JSON.stringify(newData) : undefined, oldData: oldData ? JSON.stringify(oldData) : undefined, deviceId, ipAddress: ip } }).catch(() => undefined);
}

async function findOverlap(unitId: string, start: Date, end: Date, excludeId?: string) {
  const where: any = { unitId, isDeleted: false, status: { in: ['PENDING', 'ACTIVE'] }, startDate: { lte: end }, endDate: { gte: start } };
  if (excludeId) where.id = { not: excludeId };
  return prisma.rentalBooking.findFirst({ where });
}

export async function nextBookingNo(fleetClass: string, client: any = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${fleetClass === 'EV' ? 'EVR' : 'TRR'}-${year}-`;
  const count = await client.rentalBooking.count();
  let n = count + 1;
  while (await client.rentalBooking.findUnique({ where: { bookingNo: `${prefix}${String(n).padStart(5, '0')}` } })) n++;
  return `${prefix}${String(n).padStart(5, '0')}`;
}

// GET /api/rentals/catalog - rate matrix (BIF)
router.get('/catalog', async (_req, res) => res.json(catalogSnapshot()));

// ---------- UNITS ----------
router.get('/units', guard('read'), async (req: AuthenticatedRequest, res) => {
  try {
    const cls = String(req.query.class);
    const units = await prisma.rentalUnit.findMany({ where: { isDeleted: false, fleetClass: cls }, orderBy: { name: 'asc' } });
    const open = await prisma.rentalBooking.findMany({ where: { isDeleted: false, status: { in: ['PENDING', 'ACTIVE'] }, fleetClass: cls }, orderBy: { startDate: 'asc' } });
    const byUnit = new Map<string, any>();
    for (const b of open) if (!byUnit.has(b.unitId)) byUnit.set(b.unitId, b);
    res.json({
      data: units.map(u => ({
        ...u,
        unitTypeLabel: (RENTAL_TYPES as any)[u.unitType]?.label || u.unitType,
        dailyRate: (RENTAL_TYPES as any)[u.unitType]?.rate || 0,
        depositAmount: (RENTAL_TYPES as any)[u.unitType]?.deposit || 0,
        nextBooking: byUnit.get(u.id) ? { bookingNo: byUnit.get(u.id).bookingNo, status: byUnit.get(u.id).status, startDate: byUnit.get(u.id).startDate, endDate: byUnit.get(u.id).endDate } : null,
      })),
    });
  } catch (e) { console.error('rental units error:', e); res.status(500).json({ error: 'Failed to fetch rental units' }); }
});

router.post('/units', guard('manage'), async (req: AuthenticatedRequest, res) => {
  try {
    const d = unitSchema.parse(req.body);
    const unit = await prisma.rentalUnit.create({ data: { id: d.id, name: d.name, fleetClass: d.fleetClass, unitType: d.unitType, plate: d.plate ? d.plate.toUpperCase() : null, notes: d.notes ?? null, deviceId: d.deviceId || req.user?.deviceId, lastSyncedAt: new Date() } });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'RentalUnit', entityId: unit.id, operation: 'CREATE', status: 'SYNCED', version: 1, syncedAt: new Date() } });
    res.status(201).json(unit);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: e.issues });
    console.error('rental unit create error:', e); res.status(500).json({ error: 'Failed to add rental unit' });
  }
});

router.put('/units/:id', guardAny('manage'), async (req: AuthenticatedRequest, res) => {
  try {
    const patch = unitPatchSchema.parse(req.body);
    const existing = await prisma.rentalUnit.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Rental unit not found' });
    if (patch.version !== undefined && patch.version !== existing.version)
      return res.status(409).json({ error: 'Version conflict', code: 'VERSION_CONFLICT', serverVersion: existing.version });
    if ((patch.status === 'MAINTENANCE' || patch.unitType === undefined) && patch.status === 'MAINTENANCE') {
      const open = await prisma.rentalBooking.findFirst({ where: { unitId: existing.id, isDeleted: false, status: { in: ['PENDING', 'ACTIVE'] } } });
      if (open) return res.status(409).json({ error: `Unit has open booking ${open.bookingNo} - return it first`, code: 'UNIT_BUSY' });
    }
    const { version: _v, ...rest } = patch as any;
    if (rest.plate) rest.plate = String(rest.plate).toUpperCase();
    const unit = await prisma.rentalUnit.update({ where: { id: existing.id }, data: { ...rest, deviceId: req.user?.deviceId, lastSyncedAt: new Date(), version: { increment: 1 } } });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'RentalUnit', entityId: unit.id, operation: 'UPDATE', status: 'SYNCED', version: unit.version, syncedAt: new Date() } });
    res.json(unit);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: e.issues });
    console.error('rental unit update error:', e); res.status(500).json({ error: 'Failed to update rental unit' });
  }
});

router.delete('/units/:id', guardAny('manage'), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.rentalUnit.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Rental unit not found' });
    const open = await prisma.rentalBooking.findFirst({ where: { unitId: existing.id, isDeleted: false, status: { in: ['PENDING', 'ACTIVE'] } } });
    if (open) return res.status(409).json({ error: `Unit has open booking ${open.bookingNo}`, code: 'UNIT_BUSY' });
    await prisma.rentalUnit.update({ where: { id: existing.id }, data: { isDeleted: true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId } });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'RentalUnit', entityId: existing.id, operation: 'DELETE', status: 'SYNCED', version: existing.version + 1, syncedAt: new Date() } });
    res.json({ message: `${existing.name} removed from the rental fleet` });
  } catch (e) { console.error('rental unit delete error:', e); res.status(500).json({ error: 'Failed to remove rental unit' }); }
});

// ---------- BOOKINGS ----------
router.get('/bookings', guard('read'), async (req: AuthenticatedRequest, res) => {
  try {
    const cls = String(req.query.class);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const where: any = { isDeleted: false, fleetClass: cls };
    if (['PENDING', 'ACTIVE', 'RETURNED', 'CANCELLED'].includes(String(status))) where.status = status;
    if (search) where.OR = [{ bookingNo: { contains: search } }, { unitName: { contains: search } }, { customerName: { contains: search } }];
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.rentalBooking.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.rentalBooking.count({ where }),
    ]);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { console.error('rental bookings error:', e); res.status(500).json({ error: 'Failed to fetch bookings' }); }
});

// GET /api/rentals/timeline?class=EV&days=14 - unit availability strip
router.get('/timeline', guard('read'), async (req: AuthenticatedRequest, res) => {
  try {
    const cls = String(req.query.class);
    const days = Math.min(30, Math.max(7, parseInt(req.query.days as string) || 14));
    const today = midnight(new Date());
    const units = await prisma.rentalUnit.findMany({ where: { isDeleted: false, fleetClass: cls }, orderBy: { name: 'asc' } });
    const bookings = await prisma.rentalBooking.findMany({
      where: { isDeleted: false, fleetClass: cls, status: { in: ['PENDING', 'ACTIVE'] }, endDate: { gte: today }, startDate: { lt: new Date(today.getTime() + days * DAY) } },
    });
    const cells = units.map(u => {
      const arr: string[] = [];
      for (let i = 0; i < days; i++) {
        const d0 = today.getTime() + i * DAY, d1 = d0 + DAY;
        const hit = bookings.find(b => b.unitId === u.id && new Date(b.startDate).getTime() < d1 && new Date(b.endDate).getTime() + DAY > d0);
        if (u.status === 'MAINTENANCE' && !hit) arr.push('maint');
        else arr.push(hit ? (hit.status === 'ACTIVE' ? 'active' : 'pending') : 'free');
      }
      return { unitId: u.id, name: u.name, plate: u.plate, status: u.status, cells: arr };
    });
    res.json({ start: today.toISOString(), days, units: cells });
  } catch (e) { console.error('rental timeline error:', e); res.status(500).json({ error: 'Failed to build timeline' }); }
});

// GET /api/rentals/stats
router.get('/stats', guard('read'), async (req: AuthenticatedRequest, res) => {
  try {
    const cls = String(req.query.class);
    const now = new Date();
    const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const soon = new Date(now.getTime() + 7 * DAY);
    const base = { isDeleted: false, fleetClass: cls };
    const [units, maint, active, pending7, dueBack, todayAgg, allAgg] = await Promise.all([
      prisma.rentalUnit.count({ where: { ...base, isDeleted: false } as any }),
      prisma.rentalUnit.count({ where: { ...base, isDeleted: false, status: 'MAINTENANCE' } as any }),
      prisma.rentalBooking.count({ where: { ...base, status: 'ACTIVE' } }),
      prisma.rentalBooking.count({ where: { ...base, status: 'PENDING', startDate: { gte: midnight(startToday), lte: midnight(soon) } } }),
      prisma.rentalBooking.count({ where: { ...base, status: 'ACTIVE', endDate: { lte: midnight(startToday) } } }),
      prisma.rentalBooking.aggregate({ where: { ...base, status: 'RETURNED', returnedAt: { gte: startToday } }, _sum: { totalAmount: true }, _count: true }),
      prisma.rentalBooking.aggregate({ where: { ...base, status: { in: ['RETURNED', 'ACTIVE'] } }, _sum: { totalAmount: true } }),
    ]);
    res.json({
      units: units - maint, unitsTotal: units, maintUnits: maint,
      active, pending7, dueBack,
      returnedToday: todayAgg._count || 0, revenueToday: todayAgg._sum.totalAmount || 0,
      revenueAll: allAgg._sum.totalAmount || 0,
    });
  } catch (e) { console.error('rental stats error:', e); res.status(500).json({ error: 'Failed to compute rental stats' }); }
});

router.get('/bookings/:id', guardAny('read'), async (req: AuthenticatedRequest, res) => {
  const b = await prisma.rentalBooking.findFirst({ where: { id: req.params.id, isDeleted: false } });
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  res.json(b);
});

// POST /api/rentals/bookings - PENDING reservation; server computes all money
router.post('/bookings', guard('manage'), async (req: AuthenticatedRequest, res) => {
  let clientId: string | undefined;
  try {
    const body = bookingCreateSchema.parse(req.body);
    clientId = body.id;
    if (clientId) {
      const dupe = await prisma.rentalBooking.findUnique({ where: { id: clientId } });
      if (dupe) return res.status(200).json({ ...dupe, _idempotent: true });
    }
    const start = midnight(body.startDate), end = midnight(body.endDate);
    if (end < start) return res.status(400).json({ error: 'End date must not precede start date', code: 'BAD_WINDOW' });
    const unit = await prisma.rentalUnit.findFirst({ where: { id: body.unitId, isDeleted: false } });
    if (!unit || unit.fleetClass !== body.fleetClass) return res.status(400).json({ error: 'Rental unit not found in this fleet', code: 'UNIT_NOT_FOUND' });
    if (unit.status !== 'ACTIVE') return res.status(409).json({ error: `${unit.name} is in maintenance`, code: 'UNIT_UNAVAILABLE' });
    const clash = await findOverlap(unit.id, start, end);
    if (clash) return res.status(409).json({ error: `${unit.name} is already booked ${clash.startDate.toISOString().slice(0, 10)} → ${clash.endDate.toISOString().slice(0, 10)} (${clash.bookingNo})`, code: 'UNIT_BOOKED', conflictBookingNo: clash.bookingNo });

    const px = priceBooking(unit.unitType, start, end, body.insurance);
    const bookingNo = await nextBookingNo(body.fleetClass);
    const booking = await prisma.rentalBooking.create({
      data: {
        id: clientId, bookingNo, fleetClass: body.fleetClass, unitId: unit.id, unitName: unit.name, unitPlate: unit.plate,
        customerName: body.customerName, customerPhone: body.customerPhone || null,
        startDate: start, endDate: end, status: 'PENDING', insurance: body.insurance,
        dailyRate: px.dailyRate, days: px.days, rentAmount: px.rentAmount, discount: px.discount,
        insuranceTotal: px.insuranceTotal, totalAmount: px.totalAmount, depositAmount: px.deposit,
        paidAmount: 0, notes: body.notes || null,
        lastSyncedAt: new Date(), deviceId: body.deviceId || req.user?.deviceId,
      },
    });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'RentalBooking', entityId: booking.id, operation: 'CREATE', status: 'SYNCED', version: 1, payload: JSON.stringify(body), syncedAt: new Date() } });
    await audit(req.user?.userId, 'RENTAL_CREATE', booking.id, { bookingNo, totalAmount: px.totalAmount }, undefined, req.user?.deviceId, req.ip);
    res.status(201).json(booking);
  } catch (e: any) {
    if (e?.code === 'P2002') {
      const existing = clientId ? await prisma.rentalBooking.findUnique({ where: { id: clientId } }) : null;
      if (existing) return res.status(200).json(existing);
      return res.status(409).json({ error: 'Booking number race - retry', code: 'NUMBER_RACE' });
    }
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: e.issues });
    console.error('rental booking create error:', e); res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PUT /api/rentals/bookings/:id - edits while PENDING; start/return transitions
router.put('/bookings/:id', guardAny('manage'), async (req: AuthenticatedRequest, res) => {
  try {
    const patch = bookingPatchSchema.parse(req.body);
    const existing = await prisma.rentalBooking.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Booking not found' });
    if (patch.version !== undefined && patch.version !== existing.version)
      return res.status(409).json({ error: 'Version conflict', code: 'VERSION_CONFLICT', serverVersion: existing.version });
    if (existing.status === 'RETURNED')
      return res.status(409).json({ error: 'Returned rentals are final', code: 'RENTAL_RETURNED' });
    if (existing.status === 'ACTIVE' && patch.status && patch.status !== 'RETURNED')
      return res.status(409).json({ error: 'Active rentals can only be returned', code: 'RENTAL_ACTIVE_LOCK' });
    if (patch.status === 'CANCELLED') return res.status(400).json({ error: 'Use DELETE to cancel a pending booking', code: 'BAD_TRANSITION' });

    const upd: any = { lastSyncedAt: new Date(), deviceId: req.user?.deviceId, version: { increment: 1 } };
    let { startDate, endDate, unitId, insurance } = existing;
    if (existing.status === 'PENDING') {
      if (patch.startDate) startDate = midnight(patch.startDate);
      if (patch.endDate) endDate = midnight(patch.endDate);
      if (patch.unitId) unitId = patch.unitId;
      if (patch.insurance !== undefined) insurance = patch.insurance;
      if (patch.customerName !== undefined) upd.customerName = patch.customerName;
      if (patch.customerPhone !== undefined) upd.customerPhone = patch.customerPhone || null;
      if (patch.endDate || patch.startDate || patch.unitId || patch.insurance !== undefined) {
        if (endDate < startDate) return res.status(400).json({ error: 'End date must not precede start date', code: 'BAD_WINDOW' });
        const unit = unitId === existing.unitId ? await prisma.rentalUnit.findFirst({ where: { id: unitId, isDeleted: false } }) : await prisma.rentalUnit.findFirst({ where: { id: unitId, isDeleted: false, fleetClass: existing.fleetClass } });
        if (!unit) return res.status(400).json({ error: 'Rental unit not found in this fleet', code: 'UNIT_NOT_FOUND' });
        if (unit.status !== 'ACTIVE') return res.status(409).json({ error: `${unit.name} is in maintenance`, code: 'UNIT_UNAVAILABLE' });
        const clash = await findOverlap(unit.id, startDate, endDate, existing.id);
        if (clash) return res.status(409).json({ error: `${unit.name} is already booked (${clash.bookingNo})`, code: 'UNIT_BOOKED', conflictBookingNo: clash.bookingNo });
        const px = priceBooking(unit.unitType, startDate, endDate, insurance);
        Object.assign(upd, {
          unitId: unit.id, unitName: unit.name, unitPlate: unit.plate, startDate, endDate, insurance,
          dailyRate: px.dailyRate, days: px.days, rentAmount: px.rentAmount, discount: px.discount,
          insuranceTotal: px.insuranceTotal, totalAmount: px.totalAmount, depositAmount: px.deposit,
        });
      }
    }

    if (patch.status === 'ACTIVE' && existing.status === 'PENDING') {
      const clash = await findOverlap(unitId, startDate, endDate, existing.id);
      if (clash) return res.status(409).json({ error: `Unit was double-booked meanwhile (${clash.bookingNo})`, code: 'UNIT_BOOKED', conflictBookingNo: clash.bookingNo });
      upd.status = 'ACTIVE'; upd.startedAt = new Date();
      upd.paidAmount = existing.status === 'PENDING' ? (upd.totalAmount ?? existing.totalAmount) : existing.paidAmount; // rent collected at pickup
      upd.paymentMethod = patch.paymentMethod || 'CASH';
      if (patch.mileageOut !== undefined) { upd.mileageOut = patch.mileageOut; await prisma.rentalUnit.update({ where: { id: unitId }, data: { odometerKm: Math.max(0, patch.mileageOut), updatedAt: new Date() } }).catch(() => undefined); }
    } else if (patch.status === 'RETURNED') {
      if (existing.status !== 'ACTIVE') return res.status(400).json({ error: 'Only active rentals can be returned', code: 'BAD_TRANSITION' });
      const late = overtimeFee(existing.dailyRate, endDate, new Date());
      const newTotal = existing.rentAmount + existing.insuranceTotal + late;
      upd.status = 'RETURNED'; upd.returnedAt = new Date();
      upd.overtimeFee = late; upd.totalAmount = newTotal;
      upd.paidAmount = newTotal; // balance + late fee settled at the counter
      if (patch.refundDeposit !== undefined) upd.depositRefunded = patch.refundDeposit;
      if (patch.damageNotes !== undefined) upd.damageNotes = patch.damageNotes || null;
      if (patch.returnLevel !== undefined) upd.returnLevel = patch.returnLevel;
      if (patch.mileageReturn !== undefined) {
        upd.mileageReturn = patch.mileageReturn;
        await prisma.rentalUnit.update({ where: { id: unitId }, data: { odometerKm: Math.max(existing.mileageOut || 0, patch.mileageReturn), updatedAt: new Date() } }).catch(() => undefined);
      }
    }
    if (patch.notes !== undefined) upd.notes = patch.notes || null;

    const booking = await prisma.rentalBooking.update({ where: { id: existing.id }, data: upd });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'RentalBooking', entityId: booking.id, operation: 'UPDATE', status: 'SYNCED', version: booking.version, syncedAt: new Date() } });
    await audit(req.user?.userId, 'RENTAL_UPDATE', booking.id, { status: booking.status, patch }, { status: existing.status }, req.user?.deviceId, req.ip);
    res.json(booking);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: e.issues });
    console.error('rental booking update error:', e); res.status(500).json({ error: 'Failed to update booking' });
  }
});

// DELETE /api/rentals/bookings/:id - cancel a PENDING booking only
router.delete('/bookings/:id', guardAny('manage'), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.rentalBooking.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Booking not found' });
    if (existing.status !== 'PENDING')
      return res.status(409).json({ error: existing.status === 'ACTIVE' ? 'Return the rental before cancelling' : 'Returned rentals stay on the revenue record', code: 'RENTAL_NOT_CANCELLABLE' });
    await prisma.rentalBooking.update({ where: { id: existing.id }, data: { isDeleted: true, status: 'CANCELLED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId } });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'RentalBooking', entityId: existing.id, operation: 'DELETE', status: 'SYNCED', version: existing.version + 1, syncedAt: new Date() } });
    await audit(req.user?.userId, 'RENTAL_DELETE', existing.id, undefined, { bookingNo: existing.bookingNo }, req.user?.deviceId, req.ip);
    res.json({ message: `${existing.bookingNo} cancelled - unit is free again` });
  } catch (e) { console.error('rental booking delete error:', e); res.status(500).json({ error: 'Failed to cancel booking' }); }
});

export default router;
