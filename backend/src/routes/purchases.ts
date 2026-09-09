import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

const PURCHASE_STATUSES = ['DRAFT', 'RECEIVED', 'CANCELLED'];
const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY', 'LOAN', 'CREDIT_30'];

const purchaseCreateSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for offline-first
  poNumber: z.string().max(40).optional().nullable(), // provisional TMP-* allowed; server assigns canonical
  supplierId: z.string().min(1, 'Supplier is required'),
  orderDate: z.string().optional().nullable(),
  expectedDate: z.string().optional().nullable(),
  status: z.enum(PURCHASE_STATUSES as [string, ...string[]]).default('RECEIVED'),
  paymentMethod: z.enum(PAYMENT_METHODS as [string, ...string[]]).default('CASH'),
  invoiceRef: z.string().max(60).optional().nullable(),
  discount: z.number().min(0).default(0),
  taxRate: z.number().min(0).max(100).default(0),
  paidAmount: z.number().min(0).optional(), // default: fully paid (0 for CREDIT_30)
  notes: z.string().max(2000).optional().nullable(),
  deviceId: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid().optional().nullable(),
    productName: z.string().min(1),
    sku: z.string().max(60).optional().nullable(),
    quantity: z.number().int().min(1),
    unitPrice: z.number().min(0), // supplier's price is authoritative for purchases
  })).min(1, 'A purchase needs at least one line item'),
});

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({
    data: { userId, action, entityType: 'Purchase', entityId, oldData: oldData ? JSON.stringify(oldData) : undefined, newData: newData ? JSON.stringify(newData) : undefined, ipAddress: ip, deviceId },
  });
}

export async function nextPoNo(client: any = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  let seq = (await client.purchase.count({ where: { poNumber: { startsWith: prefix } } })) + 1;
  let candidate = `${prefix}${String(seq).padStart(5, '0')}`;
  while (await client.purchase.findUnique({ where: { poNumber: candidate } })) {
    seq++;
    candidate = `${prefix}${String(seq).padStart(5, '0')}`;
  }
  return candidate;
}

// Shared engine used by REST POST and sync-push replay.
// Purchases are BUY-side: client unitPrice is authoritative (it is what we pay the supplier),
// but we update the product's latest cost price and INCREMENT stock when RECEIVED.
export async function buildPurchaseTxn(
  client: any,
  input: {
    id?: string; poNumber?: string | null; supplierId: string; orderDate?: string | null; expectedDate?: string | null;
    status: string; paymentMethod: string; invoiceRef?: string | null; discount: number; taxRate: number; paidAmount?: number;
    notes?: string | null; deviceId?: string;
    items: { productId?: string | null; productName: string; sku?: string | null; quantity: number; unitPrice: number }[];
  },
  opts: { recordStock?: boolean } = {}
) {
  const productIds = input.items.map(i => i.productId).filter(Boolean) as string[];
  const products: any[] = productIds.length
    ? await client.product.findMany({ where: { id: { in: productIds }, isDeleted: false } })
    : [];
  const byId = new Map<string, any>(products.map((p: any) => [p.id, p]));

  let subtotal = 0;
  const lines: { productId?: string | null; productName: string; sku?: string | null; quantity: number; unitPrice: number; lineTotal: number }[] = [];

  for (const item of input.items) {
    const p = item.productId ? byId.get(item.productId) : undefined;
    const unitPrice = Number(item.unitPrice) || 0; // supplier price wins on buy-side
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    lines.push({
      productId: item.productId || null,
      productName: p ? p.name : item.productName,
      sku: p ? p.sku : item.sku || null,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    });

    // Receipt into stock: increment + refresh latest cost + bump version so concurrent
    // offline edits of the same product surface as VERSION_CONFLICT (safe conflict).
    if (input.status === 'RECEIVED' && p && opts.recordStock !== false) {
      await client.product.update({
        where: { id: p.id },
        data: {
          stockQuantity: { increment: item.quantity },
          purchasePrice: unitPrice > 0 ? unitPrice : p.purchasePrice,
          version: { increment: 1 },
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  const discount = Math.min(Math.max(0, input.discount || 0), subtotal);
  const taxable = subtotal - discount;
  const taxAmount = +(taxable * (input.taxRate || 0) / 100).toFixed(2);
  const total = +(taxable + taxAmount).toFixed(2);
  // Supplier credit (30 days) => nothing paid up front unless specified
  const defaultPaid = input.paymentMethod === 'CREDIT_30' ? 0 : total;
  const paid = input.paidAmount === undefined ? defaultPaid : Math.max(0, Math.min(input.paidAmount, total));
  const balance = +(total - paid).toFixed(2);

  const supplier = await client.supplier.findFirst({ where: { id: input.supplierId, isDeleted: false } });
  if (!supplier) {
    const err: any = new Error('Supplier not found');
    err.code = 'SUPPLIER_NOT_FOUND';
    throw err;
  }

  const poNumber = input.poNumber && !String(input.poNumber).startsWith('TMP-') && !(await client.purchase.findUnique({ where: { poNumber: input.poNumber } }))
    ? input.poNumber
    : await nextPoNo(client);

  const purchase = await client.purchase.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      poNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      ...(input.orderDate ? { orderDate: new Date(input.orderDate) } : {}),
      ...(input.expectedDate ? { expectedDate: new Date(input.expectedDate) } : {}),
      status: input.status,
      paymentMethod: input.paymentMethod,
      invoiceRef: input.invoiceRef || null,
      subtotal: +subtotal.toFixed(2),
      discount,
      taxRate: input.taxRate || 0,
      taxAmount,
      total,
      paidAmount: +paid.toFixed(2),
      balance,
      notes: input.notes || null,
      lastSyncedAt: new Date(),
      deviceId: input.deviceId,
      items: { create: lines },
    },
    include: { items: true },
  });

  return purchase;
}

// GET /api/purchases - list with search/status/date filters + pagination
router.get('/', authorize(['purchases:read', 'purchases:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = (req.query.status as string) || '';
    const supplierId = req.query.supplierId as string;
    const from = req.query.from as string;
    const to = req.query.to as string;

    const where: any = { isDeleted: false };
    if (search) {
      where.OR = [
        { poNumber: { contains: search } },
        { supplierName: { contains: search } },
        { invoiceRef: { contains: search } },
      ];
    }
    if (status && PURCHASE_STATUSES.includes(status)) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (from || to) {
      where.orderDate = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }

    const skip = (page - 1) * limit;
    const [purchases, total] = await Promise.all([
      prisma.purchase.findMany({ where, skip, take: limit, orderBy: { orderDate: 'desc' }, include: { items: true } }),
      prisma.purchase.count({ where }),
    ]);

    res.json({ data: purchases, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('List purchases error:', error);
    res.status(500).json({ error: 'Failed to fetch purchases' });
  }
});

// GET /api/purchases/stats
router.get('/stats', authorize(['purchases:read', 'purchases:manage', 'dashboard:read']), async (req, res) => {
  try {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, allReceived, today, month, owedAgg] = await Promise.all([
      prisma.purchase.count({ where: { isDeleted: false } }),
      prisma.purchase.aggregate({ where: { isDeleted: false, status: 'RECEIVED' }, _sum: { total: true } }),
      prisma.purchase.aggregate({ where: { isDeleted: false, status: 'RECEIVED', orderDate: { gte: dayStart } }, _sum: { total: true } }),
      prisma.purchase.aggregate({ where: { isDeleted: false, status: 'RECEIVED', orderDate: { gte: monthStart } }, _sum: { total: true } }),
      prisma.purchase.aggregate({ where: { isDeleted: false, status: 'RECEIVED', balance: { gt: 0 } }, _sum: { balance: true } }),
    ]);

    res.json({
      total,
      spendToday: today._sum.total || 0,
      spendMonth: month._sum.total || 0,
      spendAll: allReceived._sum.total || 0,
      owedToSuppliers: owedAgg._sum.balance || 0,
    });
  } catch (error) {
    console.error('Purchases stats error:', error);
    res.status(500).json({ error: 'Failed to fetch purchases stats' });
  }
});

// GET /api/purchases/:id
router.get('/:id', authorize(['purchases:read', 'purchases:manage']), async (req, res) => {
  try {
    const purchase = await prisma.purchase.findFirst({ where: { id: req.params.id, isDeleted: false }, include: { items: true } });
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    res.json(purchase);
  } catch (error) {
    console.error('Get purchase error:', error);
    res.status(500).json({ error: 'Failed to fetch purchase' });
  }
});

// POST /api/purchases
router.post('/', authorize(['purchases:read', 'purchases:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = purchaseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const input = { ...parsed.data, deviceId: parsed.data.deviceId || req.user?.deviceId };

    if (input.id) {
      const existing = await prisma.purchase.findUnique({ where: { id: input.id } });
      if (existing && !existing.isDeleted) {
        return res.status(409).json({ error: 'Purchase already exists', code: 'ALREADY_EXISTS', serverData: existing });
      }
    }

    const purchase = await prisma.$transaction(async (tx) => buildPurchaseTxn(tx, input));

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: input.deviceId || 'server',
        entityType: 'Purchase',
        entityId: purchase.id,
        operation: 'CREATE',
        status: 'SYNCED',
        version: 1,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'purchase.create', purchase.id, { poNumber: purchase.poNumber, total: purchase.total }, undefined, input.deviceId, req.ip);

    res.status(201).json(purchase);
  } catch (error: any) {
    if (error.code === 'SUPPLIER_NOT_FOUND') {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('Create purchase error:', error);
    res.status(500).json({ error: 'Failed to create purchase' });
  }
});

// DELETE /api/purchases/:id - cancel: soft delete + reverse stock if it was RECEIVED.
// Guard: cancelling a receipt must not push current stock negative.
router.delete('/:id', authorize(['purchases:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.purchase.findFirst({ where: { id: req.params.id, isDeleted: false }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: 'Purchase not found' });

    if (existing.status === 'RECEIVED') {
      // Pre-flight floor check against CURRENT stock (some may already have been sold)
      for (const it of existing.items) {
        if (!it.productId) continue;
        const p = await prisma.product.findUnique({ where: { id: it.productId } });
        if (p && p.stockQuantity < it.quantity) {
          return res.status(409).json({
            error: `Cannot cancel: only ${p.stockQuantity} in stock for "${p.name}" but ${it.quantity} were received and some are already sold/consumed`,
            code: 'CANCEL_WOULD_NEGATE_STOCK',
            details: { productId: p.id, name: p.name, available: p.stockQuantity, toRemove: it.quantity },
          });
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      if (existing.status === 'RECEIVED') {
        for (const it of existing.items) {
          if (it.productId) {
            await tx.product.update({
              where: { id: it.productId },
              data: { stockQuantity: { decrement: it.quantity }, version: { increment: 1 }, lastSyncedAt: new Date() },
            });
          }
        }
      }
      await tx.purchase.update({
        where: { id: existing.id },
        data: { isDeleted: true, status: 'CANCELLED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId },
      });
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: req.user?.deviceId || 'server',
        entityType: 'Purchase',
        entityId: existing.id,
        operation: 'DELETE',
        status: 'SYNCED',
        version: existing.version + 1,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'purchase.delete', existing.id, undefined, { poNumber: existing.poNumber }, req.user?.deviceId, req.ip);

    res.json({ message: 'Purchase cancelled and stock reversed' });
  } catch (error) {
    console.error('Delete purchase error:', error);
    res.status(500).json({ error: 'Failed to cancel purchase' });
  }
});

export default router;
