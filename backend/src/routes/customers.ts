import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// All customer routes require authentication
router.use(authenticate);

// Validation schemas
const customerCreateSchema = z.object({
  // Client-generated UUID supported for offline-first creates
  id: z.string().uuid().optional(),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  contactName: z.string().min(2).optional().nullable(),
  phone: z.string().min(6, 'Phone is required'),
  altPhone: z.string().min(6).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  customerType: z.enum(['INDIVIDUAL', 'COMPANY']).default('INDIVIDUAL'),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  creditLimit: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  deviceId: z.string().optional(),
});

const customerUpdateSchema = customerCreateSchema.partial().omit({ id: true }).extend({
  version: z.number().int().optional(), // optimistic locking
});

// Helper: strip empty strings to null
function normalize(data: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === '' ? null : v;
  }
  return out;
}

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType: 'Customer',
      entityId,
      oldData: oldData ? JSON.stringify(oldData) : undefined,
      newData: newData ? JSON.stringify(newData) : undefined,
      ipAddress: ip,
      deviceId,
    },
  });
}

// GET /api/customers - List with search + pagination
router.get('/', authorize(['customers:read', 'customers:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const type = req.query.type as string;
    const active = req.query.active as string;

    const skip = (page - 1) * limit;

    const where: any = { isDeleted: false };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { contactName: { contains: search } },
        { phone: { contains: search } },
        { altPhone: { contains: search } },
        { email: { contains: search } },
      ];
    }

    if (type && (type === 'INDIVIDUAL' || type === 'COMPANY')) {
      where.customerType = type;
    }

    if (active === 'true' || active === 'false') {
      where.isActive = active === 'true';
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({
      data: customers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// GET /api/customers/stats - Quick counters for dashboard
router.get('/stats', authorize(['customers:read', 'customers:manage', 'dashboard:read']), async (req, res) => {
  try {
    const [total, active, companies, individuals, newThisMonth] = await Promise.all([
      prisma.customer.count({ where: { isDeleted: false } }),
      prisma.customer.count({ where: { isDeleted: false, isActive: true } }),
      prisma.customer.count({ where: { isDeleted: false, customerType: 'COMPANY' } }),
      prisma.customer.count({ where: { isDeleted: false, customerType: 'INDIVIDUAL' } }),
      prisma.customer.count({
        where: { isDeleted: false, createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
      }),
    ]);
    res.json({ total, active, companies, individuals, newThisMonth });
  } catch (error) {
    console.error('Customer stats error:', error);
    res.status(500).json({ error: 'Failed to fetch customer stats' });
  }
});

// GET /api/customers/:id
router.get('/:id', authorize(['customers:read', 'customers:manage']), async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(customer);
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// POST /api/customers
router.post('/', authorize(['customers:create', 'customers:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = customerCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { deviceId, id: clientId, ...restRaw } = normalize(parsed.data);
    const rest: any = restRaw;

    // Phone uniqueness (SQLite has no partial unique indexes; enforce here)
    const dup = await prisma.customer.findFirst({ where: { phone: rest.phone, isDeleted: false } });
    if (dup) {
      return res.status(409).json({ error: 'A customer with this phone already exists', code: 'DUPLICATE_PHONE' });
    }

    // If the client (offline queue) already created this id, treat as upsert-on-replay
    if (clientId) {
      const existing = await prisma.customer.findUnique({ where: { id: clientId } });
      if (existing && !existing.isDeleted) {
        return res.status(409).json({ error: 'Customer already exists', code: 'ALREADY_EXISTS', serverData: existing });
      }
      if (existing && existing.isDeleted) {
        const revived = await prisma.customer.update({
          where: { id: existing.id },
          data: { ...rest, isDeleted: false, isActive: rest.isActive ?? true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
        });
        await audit(req.user?.userId, 'customer.create', revived.id, revived, undefined, deviceId, req.ip);
        return res.status(200).json(revived);
      }
    }

    // A deleted record still holds the unique key - revive it instead of blocking re-registration forever
    const trashed = await prisma.customer.findFirst({ where: { phone: rest.phone, isDeleted: true } });
    if (trashed) {
      const revived = await prisma.customer.update({
        where: { id: trashed.id },
        data: { ...rest, ...(clientId ? { id: clientId } : {}), isDeleted: false, isActive: rest.isActive ?? true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
      });
      await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: deviceId || req.user?.deviceId || 'server', entityType: 'Customer', entityId: revived.id, operation: 'CREATE', status: 'SYNCED', version: revived.version, syncedAt: new Date() } });
      await audit(req.user?.userId, 'customer.create', revived.id, revived, { revivedFromDeleted: true }, deviceId, req.ip);
      return res.status(201).json(revived);
    }

    const created = await prisma.customer.create({
      data: {
        ...rest,
        // Preserve client-generated id so offline queue items stay matched
        ...(clientId ? { id: clientId } : {}),
        lastSyncedAt: new Date(),
        deviceId: deviceId || req.user?.deviceId,
      },
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: deviceId || req.user?.deviceId || 'server',
        entityType: 'Customer',
        entityId: created.id,
        operation: 'CREATE',
        status: 'SYNCED',
        version: created.version,
        syncedAt: new Date(),
      },
    });

    await audit(req.user?.userId, 'customer.create', created.id, created, undefined, deviceId, req.ip);

    res.status(201).json(created);
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// PUT /api/customers/:id - Update with optimistic locking
router.put('/:id', authorize(['customers:update', 'customers:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = customerUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const { version, deviceId, ...updateData } = normalize(parsed.data);

    // Optimistic locking check (same contract as users route & sync engine)
    if (version !== undefined && version !== existing.version) {
      return res.status(409).json({
        error: 'Conflict: record has been modified by another user',
        code: 'VERSION_CONFLICT',
        serverVersion: existing.version,
        clientVersion: version,
        serverData: existing,
      });
    }

    // Phone uniqueness if changing
    if (updateData.phone && updateData.phone !== existing.phone) {
      const dup = await prisma.customer.findFirst({
        where: { phone: updateData.phone, isDeleted: false, id: { not: existing.id } },
      });
      if (dup) {
        return res.status(409).json({ error: 'A customer with this phone already exists', code: 'DUPLICATE_PHONE' });
      }
    }

    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...updateData,
        version: { increment: 1 },
        lastSyncedAt: new Date(),
        deviceId: deviceId || req.user?.deviceId,
      },
    });

    await audit(req.user?.userId, 'customer.update', updated.id, updated, existing, deviceId, req.ip);

    res.json(updated);
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// DELETE /api/customers/:id - Soft delete (sync-safe)
router.delete('/:id', authorize(['customers:delete', 'customers:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        isDeleted: true,
        isActive: false,
        version: { increment: 1 },
        lastSyncedAt: new Date(),
        deviceId: req.user?.deviceId,
      },
    });

    // Sync-safe deletion marker (pull consumers pick this up)
    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: req.user?.deviceId || 'server',
        entityType: 'Customer',
        entityId: updated.id,
        operation: 'DELETE',
        status: 'SYNCED',
        version: updated.version,
        syncedAt: new Date(),
      },
    });

    await audit(req.user?.userId, 'customer.delete', updated.id, undefined, existing, req.user?.deviceId, req.ip);

    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

export default router;
