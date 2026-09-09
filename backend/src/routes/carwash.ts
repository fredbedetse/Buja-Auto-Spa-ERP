import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { priceWash, catalogSnapshot, SERVICE_KEYS, VEHICLE_KEYS } from '../lib/washCatalog';

const router = Router();

router.use(authenticate);

const STATUSES = ['WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;

const orderCreateSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for offline-first
  customerName: z.string().max(160).optional().nullable(),
  customerPhone: z.string().max(40).optional().nullable(),
  vehiclePlate: z.string().min(2, 'Vehicle plate is required').max(30),
  vehicleType: z.enum(VEHICLE_KEYS as any).default('SEDAN'),
  serviceType: z.enum(SERVICE_KEYS as any).default('CLASSIC'),
  discount: z.number().min(0).max(1e9).default(0), // BIF
  bay: z.number().int().min(1).max(6).default(1),
  washerName: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(STATUSES).default('WAITING'),
  deviceId: z.string().optional(),
});

const orderUpdateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  bay: z.number().int().min(1).max(6).optional(),
  washerName: z.string().max(120).nullable().optional(),
  customerName: z.string().max(160).nullable().optional(),
  customerPhone: z.string().max(40).nullable().optional(),
  vehiclePlate: z.string().min(2).max(30).optional(),
  vehicleType: z.enum(VEHICLE_KEYS as any).optional(),
  serviceType: z.enum(SERVICE_KEYS as any).optional(),
  discount: z.number().min(0).max(1e9).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  paidAmount: z.number().min(0).max(1e9).optional(),
  notes: z.string().max(2000).nullable().optional(),
  version: z.number().int().optional(), // optimistic locking
});

function normalize(d: any) {
  const out = { ...d };
  if (out.vehiclePlate) out.vehiclePlate = String(out.vehiclePlate).toUpperCase().replace(/\s+/g, ' ').trim();
  for (const k of ['customerName', 'customerPhone', 'washerName', 'notes']) {
    if (out[k] === '') out[k] = null;
  }
  return out;
}

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({ data: { userId: userId || 'system', action, entityId, entityType: 'CarWashOrder', newData: newData ? JSON.stringify(newData) : undefined, oldData: oldData ? JSON.stringify(oldData) : undefined, deviceId, ipAddress: ip } }).catch(() => undefined);
}

export async function nextWashOrderNo(client: any = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `WSH-${year}-`;
  const count = await client.carWashOrder.count();
  let n = count + 1;
  // collision-safe sequential numbering
  while (await client.carWashOrder.findUnique({ where: { orderNo: `${prefix}${String(n).padStart(5, '0')}` } })) n++;
  return `${prefix}${String(n).padStart(5, '0')}`;
}

// GET /api/carwash/catalog - price matrix (BIF) for client-side preview
router.get('/catalog', async (_req, res) => {
  res.json(catalogSnapshot());
});

// GET /api/carwash - list with filters
router.get('/', authorize(['carwash:read', 'carwash:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const serviceType = req.query.serviceType as string;
    const where: any = { isDeleted: false };
    if (status && (STATUSES as any).includes(status)) where.status = status;
    if (serviceType && (SERVICE_KEYS as any).includes(serviceType)) where.serviceType = serviceType;
    if (search) {
      where.OR = [
        { orderNo: { contains: search } },
        { vehiclePlate: { contains: search } },
        { customerName: { contains: search } },
        { washerName: { contains: search } },
      ];
    }
    const skip = (page - 1) * limit;
    const [orders, total] = await Promise.all([
      prisma.carWashOrder.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.carWashOrder.count({ where }),
    ]);
    res.json({ data: orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Carwash list error:', error);
    res.status(500).json({ error: 'Failed to fetch wash orders' });
  }
});

// GET /api/carwash/stats - board metrics
router.get('/stats', authorize(['carwash:read', 'carwash:manage', 'dashboard:read']), async (_req, res) => {
  try {
    const now = new Date();
    const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [total, waiting, active, todayAgg, allAgg] = await Promise.all([
      prisma.carWashOrder.count({ where: { isDeleted: false } }),
      prisma.carWashOrder.count({ where: { isDeleted: false, status: 'WAITING' } }),
      prisma.carWashOrder.count({ where: { isDeleted: false, status: 'IN_PROGRESS' } }),
      prisma.carWashOrder.aggregate({ where: { isDeleted: false, status: 'COMPLETED', completedAt: { gte: startToday } }, _sum: { totalAmount: true }, _count: true }),
      prisma.carWashOrder.aggregate({ where: { isDeleted: false, status: 'COMPLETED' }, _sum: { totalAmount: true } }),
    ]);
    res.json({
      total,
      waiting,
      active,
      completedToday: todayAgg._count || 0,
      revenueToday: todayAgg._sum.totalAmount || 0,
      revenueAll: allAgg._sum.totalAmount || 0,
    });
  } catch (error) {
    console.error('Carwash stats error:', error);
    res.status(500).json({ error: 'Failed to compute carwash stats' });
  }
});

// GET /api/carwash/:id
router.get('/:id', authorize(['carwash:read', 'carwash:manage']), async (req, res) => {
  const order = await prisma.carWashOrder.findFirst({ where: { id: req.params.id, isDeleted: false } });
  if (!order) return res.status(404).json({ error: 'Wash order not found' });
  res.json(order);
});

// POST /api/carwash - create (prices recomputed server-side; idempotent by client id)
router.post('/', authorize(['carwash:manage']), async (req: AuthenticatedRequest, res) => {
  let clientId: string | undefined;
  try {
    const body = orderCreateSchema.parse(req.body);
    clientId = body.id;
    const d = normalize(body);

    if (clientId) {
      const dupe = await prisma.carWashOrder.findUnique({ where: { id: clientId } });
      if (dupe) return res.status(200).json({ ...dupe, _idempotent: true });
    }

    const { basePrice, surcharge, total, discount: discUsed } = priceWash(d.serviceType, d.vehicleType, d.discount);
    const orderNo = await nextWashOrderNo();
    const order = await prisma.carWashOrder.create({
      data: {
        id: clientId,
        orderNo,
        customerName: d.customerName,
        customerPhone: d.customerPhone,
        vehiclePlate: d.vehiclePlate,
        vehicleType: d.vehicleType,
        serviceType: d.serviceType,
        basePrice, surcharge, discount: discUsed, totalAmount: total,
        paidAmount: d.status === 'COMPLETED' ? total : 0,
        status: d.status,
        bay: d.bay,
        washerName: d.washerName,
        notes: d.notes,
        completedAt: d.status === 'COMPLETED' ? new Date() : null,
        startedAt: d.status === 'IN_PROGRESS' ? new Date() : null,
        lastSyncedAt: new Date(),
        deviceId: d.deviceId || req.user?.deviceId,
      },
    });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'CarWashOrder', entityId: order.id, operation: 'CREATE', status: 'SYNCED', version: 1, payload: JSON.stringify(d), syncedAt: new Date() } });
    await audit(req.user?.userId, 'CARWASH_CREATE', order.id, { orderNo, totalAmount: total }, undefined, req.user?.deviceId, req.ip);
    res.status(201).json(order);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const existing = clientId ? await prisma.carWashOrder.findUnique({ where: { id: clientId } }) : null;
      if (existing) return res.status(200).json(existing);
      return res.status(409).json({ error: 'Wash order number race - retry', code: 'NUMBER_RACE' });
    }
    if (error?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: error.issues });
    console.error('Carwash create error:', error);
    res.status(500).json({ error: 'Failed to create wash order' });
  }
});

// PUT /api/carwash/:id - status transitions + edits (optimistic version lock)
router.put('/:id', authorize(['carwash:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const patch = orderUpdateSchema.parse(req.body);
    const existing = await prisma.carWashOrder.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Wash order not found' });

    if (patch.version !== undefined && patch.version !== existing.version) {
      return res.status(409).json({ error: 'Version conflict', code: 'VERSION_CONFLICT', serverVersion: existing.version });
    }
    if (existing.status === 'COMPLETED' && patch.status && patch.status !== 'COMPLETED') {
      return res.status(409).json({ error: 'Completed orders are final', code: 'WASH_COMPLETED' });
    }

    const data: any = { ...normalize(patch), lastSyncedAt: new Date(), deviceId: req.user?.deviceId, version: { increment: 1 } };
    // (patch.version was consumed by the optimistic-lock check above; the spread's
    //  explicit increment key below normalize() overrides any leaked value)
    const nextStatus = patch.status ?? existing.status;
    if (nextStatus === 'IN_PROGRESS' && !existing.startedAt) data.startedAt = new Date();
    if (nextStatus === 'COMPLETED' && existing.status !== 'COMPLETED') {
      data.completedAt = new Date();
      const total = existing.totalAmount;
      data.paidAmount = patch.paidAmount !== undefined ? Math.min(patch.paidAmount, total) : total; // default: fully paid
      if (patch.paymentMethod === null) data.paymentMethod = existing.paymentMethod;
    }

    // reprice if service/vehicle/discount touched and not yet completed
    if ((patch.serviceType || patch.vehicleType || patch.discount !== undefined) && existing.status !== 'COMPLETED') {
      const { basePrice, surcharge, total } = priceWash(patch.serviceType || existing.serviceType, patch.vehicleType || existing.vehicleType, patch.discount !== undefined ? patch.discount : existing.discount);
      data.basePrice = basePrice; data.surcharge = surcharge; data.totalAmount = total;
    }

    const order = await prisma.carWashOrder.update({ where: { id: existing.id }, data });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'CarWashOrder', entityId: order.id, operation: 'UPDATE', status: 'SYNCED', version: order.version, syncedAt: new Date() } });
    await audit(req.user?.userId, 'CARWASH_UPDATE', order.id, { status: order.status, patch: patch }, { status: existing.status }, req.user?.deviceId, req.ip);
    res.json(order);
  } catch (error: any) {
    if (error?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: error.issues });
    console.error('Carwash update error:', error);
    res.status(500).json({ error: 'Failed to update wash order' });
  }
});

// DELETE /api/carwash/:id - remove from board (soft); completed orders stay on record
router.delete('/:id', authorize(['carwash:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.carWashOrder.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Wash order not found' });
    if (existing.status === 'COMPLETED') {
      return res.status(409).json({ error: 'Completed wash orders are part of the revenue record - cancel is not allowed', code: 'WASH_COMPLETED' });
    }
    await prisma.carWashOrder.update({ where: { id: existing.id }, data: { isDeleted: true, status: 'CANCELLED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId } });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'CarWashOrder', entityId: existing.id, operation: 'DELETE', status: 'SYNCED', version: existing.version + 1, syncedAt: new Date() } });
    await audit(req.user?.userId, 'CARWASH_DELETE', existing.id, undefined, { orderNo: existing.orderNo }, req.user?.deviceId, req.ip);
    res.json({ message: `${existing.orderNo} removed from the board` });
  } catch (error) {
    console.error('Carwash delete error:', error);
    res.status(500).json({ error: 'Failed to remove wash order' });
  }
});

export default router;
