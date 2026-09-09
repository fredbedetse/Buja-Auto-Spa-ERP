import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

const VEHICLE_TYPES = ['TRUCK', 'BUS', 'MINIBUS', 'PICKUP', 'CAR', 'OTHER'] as const;
const VEHICLE_STATUSES = ['AVAILABLE', 'IN_USE', 'IN_MAINTENANCE', 'RENTED', 'RETIRED'] as const;

const vehicleCreateSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for offline-first
  plateNumber: z.string().min(4, 'Plate number is required'),
  type: z.enum(VEHICLE_TYPES).default('TRUCK'),
  make: z.string().min(2, 'Manufacturer is required'),
  model: z.string().max(80).optional().nullable(),
  year: z.number().int().min(1970).max(2100).optional().nullable(),
  vin: z.string().max(30).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
  status: z.enum(VEHICLE_STATUSES).default('AVAILABLE'),
  odometerKm: z.number().int().min(0).max(5_000_000).default(0),
  driverName: z.string().max(120).optional().nullable(),
  driverPhone: z.string().max(40).optional().nullable(),
  purchaseDate: z.string().datetime().optional().nullable(),
  purchasePrice: z.number().min(0).max(1e10).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().default(true),
  deviceId: z.string().optional(),
});

const vehicleUpdateSchema = vehicleCreateSchema.partial().omit({ id: true }).extend({
  version: z.number().int().optional(), // optimistic locking
});

function normalize(d: any) {
  const out: any = { ...d };
  for (const k of ['model', 'vin', 'color', 'driverName', 'driverPhone', 'notes']) {
    if (out[k] === '') out[k] = null;
  }
  if (out.plateNumber) {
    out.plateNumber = String(out.plateNumber).toUpperCase().replace(/\s+/g, ' ').trim();
  }
  if (out.vin) out.vin = String(out.vin).toUpperCase().replace(/\s+/g, '');
  return out;
}

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({
    data: { userId, action, entityType: 'Vehicle', entityId, oldData: oldData ? JSON.stringify(oldData) : undefined, newData: newData ? JSON.stringify(newData) : undefined, ipAddress: ip, deviceId },
  });
}

// GET /api/vehicles - list with search/filters + pagination
router.get('/', authorize(['vehicles:read', 'vehicles:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const type = req.query.type as string;
    const isActive = req.query.isActive as string;

    const where: any = { isDeleted: false };
    if (search) {
      where.OR = [
        { plateNumber: { contains: search } },
        { make: { contains: search } },
        { model: { contains: search } },
        { driverName: { contains: search } },
        { vin: { contains: search.toUpperCase() } },
      ];
    }
    if ((VEHICLE_STATUSES as readonly string[]).includes(status || '')) where.status = status;
    if ((VEHICLE_TYPES as readonly string[]).includes(type || '')) where.type = type;
    if (isActive === 'true' || isActive === 'false') where.isActive = isActive === 'true';

    const skip = (page - 1) * limit;
    const [vehicles, total] = await Promise.all([
      prisma.vehicle.findMany({ where, skip, take: limit, orderBy: { plateNumber: 'asc' } }),
      prisma.vehicle.count({ where }),
    ]);

    res.json({ data: vehicles, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('List vehicles error:', error);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// GET /api/vehicles/stats
router.get('/stats', authorize(['vehicles:read', 'vehicles:manage', 'dashboard:read']), async (req, res) => {
  try {
    const where = { isDeleted: false };
    const [total, active, byStatusRaw, valueAgg] = await Promise.all([
      prisma.vehicle.count({ where }),
      prisma.vehicle.count({ where: { ...where, isActive: true } }),
      prisma.vehicle.groupBy({ where, by: ['status'], _count: { _all: true } }),
      prisma.vehicle.aggregate({ where: { ...where, isActive: true }, _sum: { purchasePrice: true } }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const s of VEHICLE_STATUSES) byStatus[s] = 0;
    for (const g of byStatusRaw) byStatus[g.status] = g._count._all;
    res.json({
      total,
      active,
      byStatus,
      fleetValue: valueAgg._sum.purchasePrice || 0,
    });
  } catch (error) {
    console.error('Vehicles stats error:', error);
    res.status(500).json({ error: 'Failed to fetch vehicle stats' });
  }
});

// GET /api/vehicles/:id
router.get('/:id', authorize(['vehicles:read', 'vehicles:manage']), async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (error) {
    console.error('Get vehicle error:', error);
    res.status(500).json({ error: 'Failed to fetch vehicle' });
  }
});

// POST /api/vehicles
router.post('/', authorize(['vehicles:read', 'vehicles:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = vehicleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { deviceId, id: clientId, purchaseDate, ...restRaw } = normalize(parsed.data);
    const rest: any = restRaw;
    if (purchaseDate) rest.purchaseDate = new Date(purchaseDate);

    const dup = await prisma.vehicle.findFirst({ where: { plateNumber: rest.plateNumber, isDeleted: false } });
    if (dup) {
      return res.status(409).json({ error: 'A vehicle with this plate number is already registered', code: 'DUPLICATE_PLATE' });
    }

    if (clientId) {
      const existing = await prisma.vehicle.findUnique({ where: { id: clientId } });
      if (existing && !existing.isDeleted) {
        return res.status(409).json({ error: 'Vehicle already exists', code: 'ALREADY_EXISTS', serverData: existing });
      }
      if (existing && existing.isDeleted) {
        const revived = await prisma.vehicle.update({
          where: { id: existing.id },
          data: { ...rest, isDeleted: false, isActive: rest.isActive ?? true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
        });
        await audit(req.user?.userId, 'vehicle.create', revived.id, revived, undefined, deviceId, req.ip);
        return res.status(200).json(revived);
      }
    }

    const created = await prisma.vehicle.create({
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
        entityType: 'Vehicle',
        entityId: created.id,
        operation: 'CREATE',
        status: 'SYNCED',
        version: created.version,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'vehicle.create', created.id, created, undefined, deviceId, req.ip);

    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A vehicle with this plate number is already registered', code: 'DUPLICATE_PLATE' });
    }
    console.error('Create vehicle error:', error);
    res.status(500).json({ error: 'Failed to create vehicle' });
  }
});

// PUT /api/vehicles/:id - partial update with optimistic locking + odometer monotonicity
router.put('/:id', authorize(['vehicles:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = vehicleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { version, deviceId, purchaseDate, ...restRaw } = normalize(parsed.data);
    const rest: any = restRaw;
    if (purchaseDate) rest.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;

    const existing = await prisma.vehicle.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });

    if (version !== undefined && version !== existing.version) {
      return res.status(409).json({ error: 'Version conflict', code: 'VERSION_CONFLICT', serverData: existing });
    }
    if (rest.plateNumber) {
      const dup = await prisma.vehicle.findFirst({ where: { plateNumber: rest.plateNumber, isDeleted: false, NOT: { id: existing.id } } });
      if (dup) return res.status(409).json({ error: 'A vehicle with this plate number is already registered', code: 'DUPLICATE_PLATE' });
    }
    // Odometers never roll back - catches stale offline edits
    if (rest.odometerKm !== undefined && rest.odometerKm < existing.odometerKm) {
      return res.status(409).json({
        error: `Odometer cannot go below the recorded ${existing.odometerKm.toLocaleString('en-US')} km`,
        code: 'ODOMETER_REGRESSION',
        details: { stored: existing.odometerKm, requested: rest.odometerKm },
      });
    }

    const updated = await prisma.vehicle.update({
      where: { id: existing.id },
      data: { ...rest, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: deviceId || req.user?.deviceId || 'server',
        entityType: 'Vehicle',
        entityId: updated.id,
        operation: 'UPDATE',
        status: 'SYNCED',
        version: updated.version,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'vehicle.update', updated.id, updated, { plateNumber: existing.plateNumber, odometerKm: existing.odometerKm, status: existing.status }, deviceId || req.user?.deviceId, req.ip);

    res.json(updated);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A vehicle with this plate number is already registered', code: 'DUPLICATE_PLATE' });
    }
    console.error('Update vehicle error:', error);
    res.status(500).json({ error: 'Failed to update vehicle' });
  }
});

// DELETE /api/vehicles/:id - soft delete (history stays)
router.delete('/:id', authorize(['vehicles:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.vehicle.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });

    await prisma.$transaction([
      prisma.vehicle.update({
        where: { id: existing.id },
        data: { isDeleted: true, isActive: false, status: 'RETIRED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId },
      }),
      prisma.syncLog.create({
        data: {
          userId: req.user?.userId,
          deviceId: req.user?.deviceId || 'server',
          entityType: 'Vehicle',
          entityId: existing.id,
          operation: 'DELETE',
          status: 'SYNCED',
          version: existing.version + 1,
          syncedAt: new Date(),
        },
      }),
    ]);
    await audit(req.user?.userId, 'vehicle.delete', existing.id, undefined, { plateNumber: existing.plateNumber, make: existing.make }, req.user?.deviceId, req.ip);

    res.json({ message: 'Vehicle removed from fleet' });
  } catch (error) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

export default router;
