import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { priceMaint, catalogSnapshot, SERVICE_KEYS } from '../lib/maintCatalog';
import { buildMaintLines, linesTotal, applyMaintStock, parseLines, diffStock } from '../lib/maintStock';

const router = Router();

router.use(authenticate);

const STATUSES = ['WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const PRIORITIES = ['NORMAL', 'URGENT'] as const;
const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;
const consuming = (s: string) => s === 'IN_PROGRESS' || s === 'COMPLETED';

const partLineSchema = z.object({ productId: z.string().min(1), qty: z.number().int().min(1).max(9999) });

const orderCreateSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for offline-first
  vehiclePlate: z.string().min(2, 'Vehicle plate is required').max(30),
  vehicleId: z.string().optional().nullable(),
  vehicleLabel: z.string().max(120).optional().nullable(),
  customerName: z.string().max(160).optional().nullable(),
  customerPhone: z.string().max(40).optional().nullable(),
  serviceType: z.enum(SERVICE_KEYS as any).default('OIL'),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  status: z.enum(STATUSES).default('WAITING'),
  scheduledFor: z.string().max(40).optional().nullable(),
  mechanicName: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  findings: z.string().max(2000).optional().nullable(),
  discount: z.number().min(0).max(1e9).default(0), // BIF
  partsLines: z.array(partLineSchema).max(50).default([]),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  paidAmount: z.number().min(0).max(1e9).optional(),
  deviceId: z.string().optional(),
});

const orderUpdateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  serviceType: z.enum(SERVICE_KEYS as any).optional(),
  vehiclePlate: z.string().min(2).max(30).optional(),
  customerName: z.string().max(160).nullable().optional(),
  customerPhone: z.string().max(40).nullable().optional(),
  mechanicName: z.string().max(120).nullable().optional(),
  scheduledFor: z.string().max(40).nullable().optional(),
  discount: z.number().min(0).max(1e9).optional(),
  partsLines: z.array(partLineSchema).max(50).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  paidAmount: z.number().min(0).max(1e9).optional(),
  notes: z.string().max(2000).nullable().optional(),
  findings: z.string().max(2000).nullable().optional(),
  version: z.number().int().optional(), // optimistic locking
});

function normalize(d: any) {
  const out = { ...d };
  if (out.vehiclePlate) out.vehiclePlate = String(out.vehiclePlate).toUpperCase().replace(/\s+/g, ' ').trim();
  for (const k of ['customerName', 'customerPhone', 'mechanicName', 'notes', 'findings', 'vehicleLabel']) {
    if (out[k] === '') out[k] = null;
  }
  return out;
}

const parseDate = (v: any) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({ data: { userId: userId || 'system', action, entityId, entityType: 'MaintenanceOrder', newData: newData ? JSON.stringify(newData) : undefined, oldData: oldData ? JSON.stringify(oldData) : undefined, deviceId, ipAddress: ip } }).catch(() => undefined);
}

export async function nextMaintOrderNo(client: any = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `WO-${year}-`;
  const count = await client.maintenanceOrder.count();
  let n = count + 1;
  while (await client.maintenanceOrder.findUnique({ where: { orderNo: `${prefix}${String(n).padStart(5, '0')}` } })) n++;
  return `${prefix}${String(n).padStart(5, '0')}`;
}

// GET /api/maintenance/catalog - labor matrix (BIF) for client-side preview
router.get('/catalog', async (_req, res) => {
  res.json(catalogSnapshot());
});

// GET /api/maintenance - list with filters
router.get('/', authorize(['maintenance:read', 'maintenance:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const priority = req.query.priority as string;
    const where: any = { isDeleted: false };
    if (status && (STATUSES as any).includes(status)) where.status = status;
    if (priority && (PRIORITIES as any).includes(priority)) where.priority = priority;
    if (search) {
      where.OR = [
        { orderNo: { contains: search } },
        { vehiclePlate: { contains: search } },
        { customerName: { contains: search } },
        { mechanicName: { contains: search } },
      ];
    }
    const skip = (page - 1) * limit;
    const [orders, total] = await Promise.all([
      prisma.maintenanceOrder.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.maintenanceOrder.count({ where }),
    ]);
    res.json({ data: orders.map(o => ({ ...o, partsLines: parseLines(o.partsJson) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Maintenance list error:', error);
    res.status(500).json({ error: 'Failed to fetch work orders' });
  }
});

// GET /api/maintenance/stats - shop metrics (incl. scheduling pressure)
router.get('/stats', authorize(['maintenance:read', 'maintenance:manage', 'dashboard:read']), async (_req, res) => {
  try {
    const now = new Date();
    const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const soon = new Date(now.getTime() + 3 * 86400000);
    const [total, waiting, active, urgent, overdue, dueSoon, todayAgg, allAgg] = await Promise.all([
      prisma.maintenanceOrder.count({ where: { isDeleted: false } }),
      prisma.maintenanceOrder.count({ where: { isDeleted: false, status: 'WAITING' } }),
      prisma.maintenanceOrder.count({ where: { isDeleted: false, status: 'IN_PROGRESS' } }),
      prisma.maintenanceOrder.count({ where: { isDeleted: false, priority: 'URGENT', status: { in: ['WAITING', 'IN_PROGRESS'] } } }),
      prisma.maintenanceOrder.count({ where: { isDeleted: false, status: { in: ['WAITING', 'IN_PROGRESS'] }, scheduledFor: { lt: now } } }),
      prisma.maintenanceOrder.count({ where: { isDeleted: false, status: { in: ['WAITING', 'IN_PROGRESS'] }, scheduledFor: { gte: now, lte: soon } } }),
      prisma.maintenanceOrder.aggregate({ where: { isDeleted: false, status: 'COMPLETED', completedAt: { gte: startToday } }, _sum: { totalAmount: true }, _count: true }),
      prisma.maintenanceOrder.aggregate({ where: { isDeleted: false, status: 'COMPLETED' }, _sum: { totalAmount: true } }),
    ]);
    res.json({
      total, waiting, active, urgent, overdue, dueSoon,
      completedToday: todayAgg._count || 0,
      revenueToday: todayAgg._sum.totalAmount || 0,
      revenueAll: allAgg._sum.totalAmount || 0,
    });
  } catch (error) {
    console.error('Maintenance stats error:', error);
    res.status(500).json({ error: 'Failed to compute maintenance stats' });
  }
});

// GET /api/maintenance/:id
router.get('/:id', authorize(['maintenance:read', 'maintenance:manage']), async (req, res) => {
  const order = await prisma.maintenanceOrder.findFirst({ where: { id: req.params.id, isDeleted: false } });
  if (!order) return res.status(404).json({ error: 'Work order not found' });
  res.json({ ...order, partsLines: parseLines(order.partsJson) });
});

// POST /api/maintenance - create (prices + parts recomputed server-side; idempotent by client id)
router.post('/', authorize(['maintenance:manage']), async (req: AuthenticatedRequest, res) => {
  let clientId: string | undefined;
  try {
    const body = orderCreateSchema.parse(req.body);
    clientId = body.id;
    const d = normalize(body);

    if (clientId) {
      const dupe = await prisma.maintenanceOrder.findUnique({ where: { id: clientId } });
      if (dupe) return res.status(200).json({ ...dupe, partsLines: parseLines(dupe.partsJson), _idempotent: true });
    }

    const { rows, warnings } = await buildMaintLines(d.partsLines);
    const partsTotal = linesTotal(rows);
    const px = priceMaint(d.serviceType, partsTotal, d.discount);
    const orderNo = await nextMaintOrderNo();

    if (consuming(d.status)) {
      try { await applyMaintStock(rows, +1); }
      catch (e: any) {
        if (e?.code === 'INSUFFICIENT_STOCK') return res.status(409).json({ error: `Not enough stock for ${e.sku} (needs ${e.need})`, code: 'INSUFFICIENT_STOCK', sku: e.sku });
        throw e;
      }
    }

    const order = await prisma.maintenanceOrder.create({
      data: {
        id: clientId, orderNo,
        vehicleId: d.vehicleId || null, vehiclePlate: d.vehiclePlate, vehicleLabel: d.vehicleLabel,
        customerName: d.customerName, customerPhone: d.customerPhone,
        serviceType: d.serviceType, priority: d.priority, status: d.status,
        scheduledFor: parseDate(d.scheduledFor), mechanicName: d.mechanicName,
        notes: d.notes, findings: d.findings,
        laborHours: px.laborHours, laborTotal: px.laborTotal, partsTotal, discount: px.discount, totalAmount: px.total,
        paidAmount: d.status === 'COMPLETED' ? (d.paidAmount !== undefined ? Math.min(d.paidAmount, px.total) : px.total) : 0,
        paymentMethod: d.status === 'COMPLETED' ? (d.paymentMethod || 'CASH') : (d.paymentMethod ?? null),
        startedAt: consuming(d.status) ? new Date() : null,
        completedAt: d.status === 'COMPLETED' ? new Date() : null,
        partsJson: JSON.stringify(rows),
        lastSyncedAt: new Date(),
        deviceId: d.deviceId || req.user?.deviceId,
      },
    });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'MaintenanceOrder', entityId: order.id, operation: 'CREATE', status: 'SYNCED', version: 1, payload: JSON.stringify(d), syncedAt: new Date() } });
    await audit(req.user?.userId, 'MAINT_CREATE', order.id, { orderNo, totalAmount: px.total, parts: rows.length }, undefined, req.user?.deviceId, req.ip);
    res.status(201).json({ ...order, partsLines: rows, ...(warnings.length ? { warnings } : {}) });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const existing = clientId ? await prisma.maintenanceOrder.findUnique({ where: { id: clientId } }) : null;
      if (existing) return res.status(200).json({ ...existing, partsLines: parseLines(existing.partsJson) });
      return res.status(409).json({ error: 'Work order number race - retry', code: 'NUMBER_RACE' });
    }
    if (error?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: error.issues });
    console.error('Maintenance create error:', error);
    res.status(500).json({ error: 'Failed to create work order' });
  }
});

// PUT /api/maintenance/:id - status transitions + edits (optimistic version lock)
router.put('/:id', authorize(['maintenance:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const patch = orderUpdateSchema.parse(req.body);
    const existing = await prisma.maintenanceOrder.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });

    if (patch.version !== undefined && patch.version !== existing.version) {
      return res.status(409).json({ error: 'Version conflict', code: 'VERSION_CONFLICT', serverVersion: existing.version });
    }
    if (existing.status === 'COMPLETED' && ((patch.status && patch.status !== 'COMPLETED') || patch.partsLines !== undefined)) {
      return res.status(409).json({ error: 'Completed work orders are final', code: 'MAINT_COMPLETED' });
    }

    const oldLines = parseLines(existing.partsJson);
    let newLines = oldLines;
    const warnings: string[] = [];
    if (patch.partsLines !== undefined) {
      const built = await buildMaintLines(patch.partsLines);
      newLines = built.rows; warnings.push(...built.warnings);
    }
    const partsTotal = patch.partsLines !== undefined ? linesTotal(newLines) : existing.partsTotal;
    const nextStatus = patch.status ?? existing.status;

    const upd: any = { lastSyncedAt: new Date(), deviceId: req.user?.deviceId, version: { increment: 1 } };
    for (const k of ['priority', 'mechanicName', 'notes', 'findings', 'customerName', 'customerPhone', 'paymentMethod', 'serviceType', 'status'] as const) {
      if ((patch as any)[k] !== undefined) upd[k] = (patch as any)[k];
    }
    if (patch.vehiclePlate) upd.vehiclePlate = String(patch.vehiclePlate).toUpperCase();
    if (patch.scheduledFor !== undefined) upd.scheduledFor = parseDate(patch.scheduledFor);
    if (patch.partsLines !== undefined) { upd.partsJson = JSON.stringify(newLines); upd.partsTotal = partsTotal; }

    // stock moves only the delta between what was reserved and what should be reserved
    const { consume, release } = diffStock(oldLines, newLines, consuming(existing.status), consuming(nextStatus));
    if (consume.length) {
      try { await applyMaintStock(consume, +1); }
      catch (e: any) {
        if (e?.code === 'INSUFFICIENT_STOCK') return res.status(409).json({ error: `Not enough stock for ${e.sku} (needs ${e.need})`, code: 'INSUFFICIENT_STOCK', sku: e.sku });
        throw e;
      }
    }
    if (release.length) await applyMaintStock(release, -1);

    // reprice while the job is open - server always wins
    if (existing.status !== 'COMPLETED' && (patch.serviceType || patch.discount !== undefined || patch.partsLines !== undefined)) {
      const px = priceMaint(patch.serviceType || existing.serviceType, partsTotal, patch.discount !== undefined ? patch.discount : existing.discount);
      upd.laborHours = px.laborHours; upd.laborTotal = px.laborTotal; upd.discount = px.discount; upd.totalAmount = px.total;
    }
    const effTotal = upd.totalAmount ?? existing.totalAmount;
    if (nextStatus === 'IN_PROGRESS' && !existing.startedAt) upd.startedAt = new Date();
    if (nextStatus === 'COMPLETED' && existing.status !== 'COMPLETED') {
      upd.completedAt = new Date();
      upd.paidAmount = patch.paidAmount !== undefined ? Math.min(patch.paidAmount, effTotal) : effTotal; // default: fully paid
      if (!patch.paymentMethod) upd.paymentMethod = existing.paymentMethod || 'CASH';
    }

    const order = await prisma.maintenanceOrder.update({ where: { id: existing.id }, data: upd });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'MaintenanceOrder', entityId: order.id, operation: 'UPDATE', status: 'SYNCED', version: order.version, syncedAt: new Date() } });
    await audit(req.user?.userId, 'MAINT_UPDATE', order.id, { status: order.status, patch }, { status: existing.status }, req.user?.deviceId, req.ip);
    res.json({ ...order, partsLines: parseLines(order.partsJson), ...(warnings.length ? { warnings } : {}) });
  } catch (error: any) {
    if (error?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: error.issues });
    console.error('Maintenance update error:', error);
    res.status(500).json({ error: 'Failed to update work order' });
  }
});

// DELETE /api/maintenance/:id - off the board (soft); completed jobs stay on the revenue record
router.delete('/:id', authorize(['maintenance:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.maintenanceOrder.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status === 'COMPLETED') {
      return res.status(409).json({ error: 'Completed work orders are part of the revenue record - cancel is not allowed', code: 'MAINT_COMPLETED' });
    }
    if (consuming(existing.status)) await applyMaintStock(parseLines(existing.partsJson), -1).catch(() => undefined); // put planned parts back
    await prisma.maintenanceOrder.update({ where: { id: existing.id }, data: { isDeleted: true, status: 'CANCELLED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId } });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'MaintenanceOrder', entityId: existing.id, operation: 'DELETE', status: 'SYNCED', version: existing.version + 1, syncedAt: new Date() } });
    await audit(req.user?.userId, 'MAINT_DELETE', existing.id, undefined, { orderNo: existing.orderNo }, req.user?.deviceId, req.ip);
    res.json({ message: `${existing.orderNo} removed from the workshop board` });
  } catch (error) {
    console.error('Maintenance delete error:', error);
    res.status(500).json({ error: 'Failed to remove work order' });
  }
});

export default router;
