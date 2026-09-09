import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// All inventory routes require authentication
router.use(authenticate);

const CATEGORIES = ['ENGINE', 'BRAKES', 'ELECTRICAL', 'FLUIDS', 'TYRES', 'BODY', 'ACCESSORIES', 'GENERAL'];
const UNITS = ['PCS', 'LTR', 'KG', 'SET', 'BOX'];

const productCreateSchema = z.object({
  // Client-generated UUID supported for offline-first creates
  id: z.string().uuid().optional(),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  sku: z.string().min(2, 'SKU is required').max(60),
  category: z.enum(CATEGORIES as [string, ...string[]]).default('GENERAL'),
  unit: z.enum(UNITS as [string, ...string[]]).default('PCS'),
  stockQuantity: z.number().int().min(0).default(0),
  reorderLevel: z.number().int().min(0).default(5),
  purchasePrice: z.number().min(0).default(0),
  sellingPrice: z.number().min(0).default(0),
  supplierName: z.string().max(120).optional().nullable(),
  location: z.string().max(120).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().default(true),
  deviceId: z.string().optional(),
});

const productUpdateSchema = productCreateSchema.partial().omit({ id: true }).extend({
  version: z.number().int().optional(), // optimistic locking
});

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
      entityType: 'Product',
      entityId,
      oldData: oldData ? JSON.stringify(oldData) : undefined,
      newData: newData ? JSON.stringify(newData) : undefined,
      ipAddress: ip,
      deviceId,
    },
  });
}

// GET /api/inventory - List with search, category & low-stock filters + pagination
router.get('/', authorize(['inventory:read', 'inventory:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const category = (req.query.category as string) || '';
    const lowStock = req.query.lowStock === 'true';

    const skip = (page - 1) * limit;

    const where: any = { isDeleted: false };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { supplierName: { contains: search } },
        { location: { contains: search } },
      ];
    }

    if (category && CATEGORIES.includes(category)) {
      where.category = category;
    }

    if (lowStock) {
      // stockQuantity <= reorderLevel via raw-ish filter (Prisma lacks field-to-field compare)
      where.id = { in: (await prisma.product.findMany({
        where: { isDeleted: false },
        select: { id: true, stockQuantity: true, reorderLevel: true },
      })).filter(p => p.stockQuantity <= p.reorderLevel).map(p => p.id) };
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      data: products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('List products error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// GET /api/inventory/stats - Counters for dashboard + page summary
router.get('/stats', authorize(['inventory:read', 'inventory:manage', 'dashboard:read']), async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { isDeleted: false },
      select: { stockQuantity: true, reorderLevel: true, purchasePrice: true, sellingPrice: true },
    });

    const total = products.length;
    const lowStock = products.filter(p => p.stockQuantity <= p.reorderLevel && p.stockQuantity > 0).length;
    const outOfStock = products.filter(p => p.stockQuantity === 0).length;
    const stockValue = products.reduce((s, p) => s + p.stockQuantity * p.purchasePrice, 0);
    const retailValue = products.reduce((s, p) => s + p.stockQuantity * p.sellingPrice, 0);

    res.json({ total, lowStock, outOfStock, stockValue, retailValue });
  } catch (error) {
    console.error('Inventory stats error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory stats' });
  }
});

// GET /api/inventory/categories - Distinct categories in use (for filter chips)
router.get('/categories', authorize(['inventory:read', 'inventory:manage']), async (req, res) => {
  try {
    const rows = await prisma.product.groupBy({
      by: ['category'],
      where: { isDeleted: false },
      _count: { category: true },
    });
    res.json({
      data: rows.map(r => ({ category: r.category, count: r._count.category })),
    });
  } catch (error) {
    console.error('Inventory categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET /api/inventory/:id
router.get('/:id', authorize(['inventory:read', 'inventory:manage']), async (req, res) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// POST /api/inventory
router.post('/', authorize(['inventory:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = productCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { deviceId, id: clientId, ...rest } = normalize(parsed.data) as any;

    // SKU uniqueness (soft-delete-aware, like customers' phone rule)
    const dup = await prisma.product.findFirst({ where: { sku: rest.sku, isDeleted: false } });
    if (dup) {
      return res.status(409).json({ error: 'A product with this SKU already exists', code: 'DUPLICATE_SKU' });
    }

    if (clientId) {
      const existing = await prisma.product.findUnique({ where: { id: clientId } });
      if (existing && !existing.isDeleted) {
        return res.status(409).json({ error: 'Product already exists', code: 'ALREADY_EXISTS', serverData: existing });
      }
      if (existing && existing.isDeleted) {
        const revived = await prisma.product.update({
          where: { id: existing.id },
          data: { ...rest, isDeleted: false, isActive: rest.isActive ?? true, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
        });
        await audit(req.user?.userId, 'product.create', revived.id, revived, undefined, deviceId, req.ip);
        return res.status(200).json(revived);
      }
    }

    const created = await prisma.product.create({
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
        entityType: 'Product',
        entityId: created.id,
        operation: 'CREATE',
        status: 'SYNCED',
        version: created.version,
        syncedAt: new Date(),
      },
    });

    await audit(req.user?.userId, 'product.create', created.id, created, undefined, deviceId, req.ip);

    res.status(201).json(created);
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/inventory/:id - Update with optimistic locking
router.put('/:id', authorize(['inventory:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = productUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const existing = await prisma.product.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const { version, deviceId, ...updateData } = normalize(parsed.data) as any;

    // Optimistic locking (same contract as users/customers routes & sync engine)
    if (version !== undefined && version !== existing.version) {
      return res.status(409).json({
        error: 'Conflict: record has been modified by another user',
        code: 'VERSION_CONFLICT',
        serverVersion: existing.version,
        clientVersion: version,
        serverData: existing,
      });
    }

    if (updateData.sku && updateData.sku !== existing.sku) {
      const dup = await prisma.product.findFirst({
        where: { sku: updateData.sku, isDeleted: false, id: { not: existing.id } },
      });
      if (dup) {
        return res.status(409).json({ error: 'A product with this SKU already exists', code: 'DUPLICATE_SKU' });
      }
    }

    const updated = await prisma.product.update({
      where: { id: existing.id },
      data: {
        ...updateData,
        version: { increment: 1 },
        lastSyncedAt: new Date(),
        deviceId: deviceId || req.user?.deviceId,
      },
    });

    await audit(req.user?.userId, 'product.update', updated.id, updated, existing, deviceId, req.ip);

    res.json(updated);
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /api/inventory/:id - Soft delete (sync-safe)
router.delete('/:id', authorize(['inventory:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.product.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updated = await prisma.product.update({
      where: { id: existing.id },
      data: {
        isDeleted: true,
        isActive: false,
        version: { increment: 1 },
        lastSyncedAt: new Date(),
        deviceId: req.user?.deviceId,
      },
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: req.user?.deviceId || 'server',
        entityType: 'Product',
        entityId: updated.id,
        operation: 'DELETE',
        status: 'SYNCED',
        version: updated.version,
        syncedAt: new Date(),
      },
    });

    await audit(req.user?.userId, 'product.delete', updated.id, undefined, existing, req.user?.deviceId, req.ip);

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

export default router;
