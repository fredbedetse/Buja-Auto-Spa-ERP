import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

const supplierCreateSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for offline-first
  name: z.string().min(2, 'Supplier name must be at least 2 characters'),
  contactName: z.string().max(120).optional().nullable(),
  phone: z.string().min(6, 'A valid phone number is required'),
  altPhone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().max(300).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  taxId: z.string().max(60).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
  isActive: z.boolean().default(true),
  deviceId: z.string().optional(),
});

const supplierUpdateSchema = supplierCreateSchema.partial().omit({ id: true }).extend({
  version: z.number().int().optional(), // optimistic locking
});

function normalize(d: any) {
  const out: any = { ...d };
  for (const k of ['contactName', 'altPhone', 'email', 'address', 'city', 'taxId', 'notes']) {
    if (out[k] === '' ) out[k] = null;
  }
  if (out.phone) out.phone = String(out.phone).replace(/\s+/g, '');
  return out;
}

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({
    data: { userId, action, entityType: 'Supplier', entityId, oldData: oldData ? JSON.stringify(oldData) : undefined, newData: newData ? JSON.stringify(newData) : undefined, ipAddress: ip, deviceId },
  });
}

// GET /api/suppliers - list with search/filter + pagination
router.get('/', authorize(['suppliers:read', 'suppliers:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const isActive = req.query.isActive as string;

    const where: any = { isDeleted: false };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { city: { contains: search } },
        { contactName: { contains: search } },
      ];
    }
    if (isActive === 'true' || isActive === 'false') where.isActive = isActive === 'true';

    const skip = (page - 1) * limit;
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
      prisma.supplier.count({ where }),
    ]);

    res.json({ data: suppliers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('List suppliers error:', error);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

// GET /api/suppliers/stats
router.get('/stats', authorize(['suppliers:read', 'suppliers:manage', 'dashboard:read']), async (req, res) => {
  try {
    const [total, active, purchases, spendAgg, owedAgg] = await Promise.all([
      prisma.supplier.count({ where: { isDeleted: false } }),
      prisma.supplier.count({ where: { isDeleted: false, isActive: true } }),
      prisma.purchase.count({ where: { isDeleted: false, status: 'RECEIVED' } }),
      prisma.purchase.aggregate({ where: { isDeleted: false, status: 'RECEIVED' }, _sum: { total: true } }),
      prisma.purchase.aggregate({ where: { isDeleted: false, status: 'RECEIVED', balance: { gt: 0 } }, _sum: { balance: true } }),
    ]);
    res.json({
      total,
      active,
      purchases: purchases,
      spendAll: spendAgg._sum.total || 0,
      owedToSuppliers: owedAgg._sum.balance || 0,
    });
  } catch (error) {
    console.error('Suppliers stats error:', error);
    res.status(500).json({ error: 'Failed to fetch supplier stats' });
  }
});

// GET /api/suppliers/:id
router.get('/:id', authorize(['suppliers:read', 'suppliers:manage']), async (req, res) => {
  try {
    const supplier = await prisma.supplier.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({ error: 'Failed to fetch supplier' });
  }
});

// POST /api/suppliers
router.post('/', authorize(['suppliers:read', 'suppliers:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = supplierCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { deviceId, id: clientId, ...restRaw } = normalize(parsed.data);
    const rest: any = restRaw;

    const dup = await prisma.supplier.findFirst({ where: { phone: rest.phone, isDeleted: false } });
    if (dup) {
      return res.status(409).json({ error: 'A supplier with this phone already exists', code: 'DUPLICATE_PHONE' });
    }

    if (clientId) {
      const existing = await prisma.supplier.findUnique({ where: { id: clientId } });
      if (existing && !existing.isDeleted) {
        return res.status(409).json({ error: 'Supplier already exists', code: 'ALREADY_EXISTS', serverData: existing });
      }
      if (existing && existing.isDeleted) {
        const revived = await prisma.supplier.update({
          where: { id: existing.id },
          data: { ...rest, isDeleted: false, isActive: rest.isActive ?? true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
        });
        await audit(req.user?.userId, 'supplier.create', revived.id, revived, undefined, deviceId, req.ip);
        return res.status(200).json(revived);
      }
    }

    // A deleted record still holds the unique key - revive it instead of blocking re-registration forever
    const trashed = await prisma.supplier.findFirst({ where: { phone: rest.phone, isDeleted: true } });
    if (trashed) {
      const revived = await prisma.supplier.update({
        where: { id: trashed.id },
        data: { ...rest, ...(clientId ? { id: clientId } : {}), isDeleted: false, isActive: rest.isActive ?? true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
      });
      await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: deviceId || req.user?.deviceId || 'server', entityType: 'Supplier', entityId: revived.id, operation: 'CREATE', status: 'SYNCED', version: revived.version, syncedAt: new Date() } });
      await audit(req.user?.userId, 'supplier.create', revived.id, revived, { revivedFromDeleted: true }, deviceId, req.ip);
      return res.status(201).json(revived);
    }

    const created = await prisma.supplier.create({
      data: {
        ...rest,
        ...(clientId ? { id: clientId } : {}),
        lastSyncedAt: new Date(),
        deviceId: deviceId || req.user?.deviceId,
      },
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: deviceId || req.user?.deviceId || 'server',
        entityType: 'Supplier',
        entityId: created.id,
        operation: 'CREATE',
        status: 'SYNCED',
        version: created.version,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'supplier.create', created.id, created, undefined, deviceId, req.ip);

    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A supplier with this phone already exists', code: 'DUPLICATE_PHONE' });
    }
    console.error('Create supplier error:', error);
    res.status(500).json({ error: 'Failed to create supplier' });
  }
});

// PUT /api/suppliers/:id - partial update with optimistic locking
router.put('/:id', authorize(['suppliers:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = supplierUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { version, deviceId, ...restRaw } = normalize(parsed.data);
    const rest: any = restRaw;

    const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Supplier not found' });

    if (version !== undefined && version !== existing.version) {
      return res.status(409).json({ error: 'Version conflict', code: 'VERSION_CONFLICT', serverData: existing });
    }
    if (rest.phone) {
      const dup = await prisma.supplier.findFirst({ where: { phone: rest.phone, isDeleted: false, NOT: { id: existing.id } } });
      if (dup) return res.status(409).json({ error: 'A supplier with this phone already exists', code: 'DUPLICATE_PHONE' });
    }

    const updated = await prisma.supplier.update({
      where: { id: existing.id },
      data: { ...rest, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: deviceId || req.user?.deviceId || 'server',
        entityType: 'Supplier',
        entityId: updated.id,
        operation: 'UPDATE',
        status: 'SYNCED',
        version: updated.version,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'supplier.update', updated.id, updated, { phone: existing.phone, name: existing.name }, deviceId || req.user?.deviceId, req.ip);

    res.json(updated);
  } catch (error) {
    console.error('Update supplier error:', error);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
});

// DELETE /api/suppliers/:id - soft delete + SyncLog (purchase history stays)
router.delete('/:id', authorize(['suppliers:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Supplier not found' });

    await prisma.$transaction([
      prisma.supplier.update({
        where: { id: existing.id },
        data: { isDeleted: true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId },
      }),
      prisma.syncLog.create({
        data: {
          userId: req.user?.userId,
          deviceId: req.user?.deviceId || 'server',
          entityType: 'Supplier',
          entityId: existing.id,
          operation: 'DELETE',
          status: 'SYNCED',
          version: existing.version + 1,
          syncedAt: new Date(),
        },
      }),
    ]);
    await audit(req.user?.userId, 'supplier.delete', existing.id, undefined, { name: existing.name, phone: existing.phone }, req.user?.deviceId, req.ip);

    res.json({ message: 'Supplier deleted' });
  } catch (error) {
    console.error('Delete supplier error:', error);
    res.status(500).json({ error: 'Failed to delete supplier' });
  }
});

export default router;
