import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

const POSITIONS = ['DRIVER', 'MECHANIC', 'CASHIER', 'WASHER', 'SALESPERSON', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'OTHER'] as const;
const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] as const;

const employeeCreateSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for offline-first
  firstName: z.string().min(2, 'First name is required'),
  lastName: z.string().min(2, 'Last name is required'),
  position: z.enum(POSITIONS).default('OTHER'),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable().or(z.literal('').transform(() => null)),
  nationalId: z.string().max(40).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  hireDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  salary: z.number().min(0).max(1e9).default(0), // canonical BIF per month
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).default('ACTIVE'),
  notes: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().default(true),
  deviceId: z.string().optional(),
});

const employeeUpdateSchema = employeeCreateSchema.partial().omit({ id: true }).extend({
  version: z.number().int().optional(), // optimistic locking
});

function normalize(d: any) {
  const out: any = { ...d };
  for (const k of ['phone', 'email', 'nationalId', 'address', 'city', 'notes']) {
    if (out[k] === '') out[k] = null;
  }
  if (out.firstName) out.firstName = String(out.firstName).trim();
  if (out.lastName) out.lastName = String(out.lastName).trim();
  if (out.phone) out.phone = String(out.phone).replace(/\s+/g, ' ').trim();
  if (out.nationalId) out.nationalId = String(out.nationalId).toUpperCase().trim();
  return out;
}

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({
    data: { userId, action, entityType: 'Employee', entityId, oldData: oldData ? JSON.stringify(oldData) : undefined, newData: newData ? JSON.stringify(newData) : undefined, ipAddress: ip, deviceId },
  });
}

// GET /api/employees - list with search/filters + pagination
router.get('/', authorize(['employees:read', 'employees:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const position = req.query.position as string;
    const isActive = req.query.isActive as string;

    const where: any = { isDeleted: false };
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { nationalId: { contains: search.toUpperCase() } },
      ];
    }
    if ((EMPLOYMENT_STATUSES as readonly string[]).includes(status || '')) where.employmentStatus = status;
    if ((POSITIONS as readonly string[]).includes(position || '')) where.position = position;
    if (isActive === 'true' || isActive === 'false') where.isActive = isActive === 'true';

    const skip = (page - 1) * limit;
    const [employees, total] = await Promise.all([
      prisma.employee.findMany({ where, skip, take: limit, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      prisma.employee.count({ where }),
    ]);

    res.json({ data: employees, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('List employees error:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// GET /api/employees/stats
router.get('/stats', authorize(['employees:read', 'employees:manage', 'dashboard:read']), async (req, res) => {
  try {
    const where = { isDeleted: false };
    const [total, byStatusRaw, byPositionRaw, payrollAgg] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.groupBy({ where, by: ['employmentStatus'], _count: { _all: true } }),
      prisma.employee.groupBy({ where, by: ['position'], _count: { _all: true } }),
      // Payroll = monthly cost of everyone still on the books (active + on leave)
      prisma.employee.aggregate({ where: { ...where, employmentStatus: { in: ['ACTIVE', 'ON_LEAVE'] } }, _sum: { salary: true } }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const s of EMPLOYMENT_STATUSES) byStatus[s] = 0;
    for (const g of byStatusRaw) byStatus[g.employmentStatus] = g._count._all;
    const byPosition: Record<string, number> = {};
    for (const g of byPositionRaw) byPosition[g.position] = g._count._all;
    res.json({
      total,
      active: byStatus.ACTIVE,
      onLeave: byStatus.ON_LEAVE,
      terminated: byStatus.TERMINATED,
      byPosition,
      payrollMonth: payrollAgg._sum.salary || 0,
    });
  } catch (error) {
    console.error('Employees stats error:', error);
    res.status(500).json({ error: 'Failed to fetch employee stats' });
  }
});

// GET /api/employees/:id
router.get('/:id', authorize(['employees:read', 'employees:manage']), async (req, res) => {
  try {
    const employee = await prisma.employee.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee);
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

// POST /api/employees
router.post('/', authorize(['employees:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = employeeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { deviceId, id: clientId, hireDate, ...restRaw } = normalize(parsed.data);
    const rest: any = restRaw;
    rest.hireDate = new Date(hireDate);

    if (clientId) {
      const existing = await prisma.employee.findUnique({ where: { id: clientId } });
      if (existing && !existing.isDeleted) {
        return res.status(409).json({ error: 'Employee already exists', code: 'ALREADY_EXISTS', serverData: existing });
      }
      if (existing && existing.isDeleted) {
        const revived = await prisma.employee.update({
          where: { id: existing.id },
          data: { ...rest, isDeleted: false, isActive: rest.isActive ?? true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
        });
        await audit(req.user?.userId, 'employee.create', revived.id, revived, undefined, deviceId, req.ip);
        return res.status(200).json(revived);
      }
    }

    const created = await prisma.employee.create({
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
        entityType: 'Employee',
        entityId: created.id,
        operation: 'CREATE',
        status: 'SYNCED',
        version: created.version,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'employee.create', created.id, created, undefined, deviceId, req.ip);

    res.status(201).json(created);
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// PUT /api/employees/:id - partial update with optimistic locking
router.put('/:id', authorize(['employees:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = employeeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { version, deviceId, hireDate, ...restRaw } = normalize(parsed.data);
    const rest: any = restRaw;
    if (hireDate) rest.hireDate = new Date(hireDate);
    if (rest.employmentStatus === 'TERMINATED') rest.isActive = false;

    const existing = await prisma.employee.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Employee not found' });

    if (version !== undefined && version !== existing.version) {
      return res.status(409).json({ error: 'Version conflict', code: 'VERSION_CONFLICT', serverData: existing });
    }

    const updated = await prisma.employee.update({
      where: { id: existing.id },
      data: { ...rest, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: deviceId || req.user?.deviceId || 'server',
        entityType: 'Employee',
        entityId: updated.id,
        operation: 'UPDATE',
        status: 'SYNCED',
        version: updated.version,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'employee.update', updated.id, updated, { employmentStatus: existing.employmentStatus, salary: existing.salary, position: existing.position }, deviceId || req.user?.deviceId, req.ip);

    res.json(updated);
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// DELETE /api/employees/:id - soft delete (payroll history stays)
router.delete('/:id', authorize(['employees:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.employee.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Employee not found' });

    await prisma.$transaction([
      prisma.employee.update({
        where: { id: existing.id },
        data: { isDeleted: true, isActive: false, employmentStatus: 'TERMINATED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId },
      }),
      prisma.syncLog.create({
        data: {
          userId: req.user?.userId,
          deviceId: req.user?.deviceId || 'server',
          entityType: 'Employee',
          entityId: existing.id,
          operation: 'DELETE',
          status: 'SYNCED',
          version: existing.version + 1,
          syncedAt: new Date(),
        },
      }),
    ]);
    await audit(req.user?.userId, 'employee.delete', existing.id, undefined, { firstName: existing.firstName, lastName: existing.lastName, position: existing.position }, req.user?.deviceId, req.ip);

    res.json({ message: 'Employee removed from payroll' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

export default router;
