import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

const SALE_STATUSES = ['DRAFT', 'COMPLETED', 'CANCELLED'];
const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY', 'LOAN'];

const saleCreateSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for offline-first
  invoiceNo: z.string().max(40).optional().nullable(), // provisional allowed; server assigns canonical
  customerId: z.string().min(1, 'Customer is required'),
  saleDate: z.string().datetime().or(z.string()).optional().nullable(),
  status: z.enum(SALE_STATUSES as [string, ...string[]]).default('COMPLETED'),
  paymentMethod: z.enum(PAYMENT_METHODS as [string, ...string[]]).default('CASH'),
  discount: z.number().min(0).default(0),
  taxRate: z.number().min(0).max(100).default(0),
  paidAmount: z.number().min(0).optional(), // default: fully paid
  notes: z.string().max(2000).optional().nullable(),
  deviceId: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid().optional().nullable(),
    productName: z.string().min(1),
    sku: z.string().max(60).optional().nullable(),
    quantity: z.number().int().min(1),
    unitPrice: z.number().min(0), // fallback price; server overrides from product catalog when available
  })).min(1, 'A sale needs at least one line item'),
});

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({
    data: { userId, action, entityType: 'Sale', entityId, oldData: oldData ? JSON.stringify(oldData) : undefined, newData: newData ? JSON.stringify(newData) : undefined, ipAddress: ip, deviceId },
  });
}

export async function nextInvoiceNo(client: any = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  let seq = (await client.sale.count({ where: { invoiceNo: { startsWith: prefix } } })) + 1;
  let candidate = `${prefix}${String(seq).padStart(5, '0')}`;
  while (await client.sale.findUnique({ where: { invoiceNo: candidate } })) {
    seq++;
    candidate = `${prefix}${String(seq).padStart(5, '0')}`;
  }
  return candidate;
}

// Shared price/total engine: server is the source of truth for prices and stock.
// opts.checkStock=false for sync-push replay (already validated per-item on push).
export async function buildSaleTxn(
  client: any,
  input: {
    id?: string; invoiceNo?: string | null; customerId: string; saleDate?: string | null;
    status: string; paymentMethod: string; discount: number; taxRate: number; paidAmount?: number;
    notes?: string | null; deviceId?: string;
    items: { productId?: string | null; productName: string; sku?: string | null; quantity: number; unitPrice: number }[];
  },
  opts: { checkStock: boolean }
) {
  // Load referenced products for authoritative price/stock
  const productIds = input.items.map(i => i.productId).filter(Boolean) as string[];
  const products: any[] = productIds.length
    ? await client.product.findMany({ where: { id: { in: productIds }, isDeleted: false } })
    : [];
  const byId = new Map<string, any>(products.map((p: any) => [p.id, p]));

  let subtotal = 0;
  const lines: { productId?: string | null; productName: string; sku?: string | null; quantity: number; unitPrice: number; lineTotal: number }[] = [];

  for (const item of input.items) {
    const p = item.productId ? byId.get(item.productId) : undefined;
    const unitPrice = p ? p.sellingPrice : item.unitPrice;
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

    if (input.status === 'COMPLETED' && p) {
      if (opts.checkStock && p.stockQuantity < item.quantity) {
        const err: any = new Error(`Insufficient stock for "${p.name}" (available ${p.stockQuantity}, requested ${item.quantity})`);
        err.code = 'INSUFFICIENT_STOCK';
        err.details = { productId: p.id, name: p.name, available: p.stockQuantity, requested: item.quantity };
        throw err;
      }
      // decrement + bump version so concurrent offline edits conflict safely
      await client.product.update({
        where: { id: p.id },
        data: { stockQuantity: { decrement: item.quantity }, version: { increment: 1 }, lastSyncedAt: new Date() },
      });
    }
  }

  const discount = Math.min(Math.max(0, input.discount || 0), subtotal);
  const taxable = subtotal - discount;
  const taxAmount = +(taxable * (input.taxRate || 0) / 100).toFixed(2);
  const total = +(taxable + taxAmount).toFixed(2);
  const paid = input.paidAmount === undefined ? total : Math.max(0, Math.min(input.paidAmount, total));
  const balance = +(total - paid).toFixed(2);

  const customer = await client.customer.findFirst({ where: { id: input.customerId, isDeleted: false } });
  if (!customer) {
    const err: any = new Error('Customer not found');
    err.code = 'CUSTOMER_NOT_FOUND';
    throw err;
  }

  const invoiceNo = input.invoiceNo && !String(input.invoiceNo).startsWith('TMP-') && !(await client.sale.findUnique({ where: { invoiceNo: input.invoiceNo } }))
    ? input.invoiceNo
    : await nextInvoiceNo();

  const sale = await client.sale.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      invoiceNo,
      customerId: customer.id,
      customerName: customer.name,
      ...(input.saleDate ? { saleDate: new Date(input.saleDate) } : {}),
      status: input.status,
      paymentMethod: input.paymentMethod,
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

  return sale;
}

// GET /api/sales - list with search/status/date filters + pagination
router.get('/', authorize(['sales:read', 'sales:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = (req.query.status as string) || '';
    const from = req.query.from as string;
    const to = req.query.to as string;

    const where: any = { isDeleted: false };
    if (search) {
      where.OR = [
        { invoiceNo: { contains: search } },
        { customerName: { contains: search } },
      ];
    }
    if (status && SALE_STATUSES.includes(status)) where.status = status;
    if (from || to) {
      where.saleDate = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }

    const skip = (page - 1) * limit;
    const [sales, total] = await Promise.all([
      prisma.sale.findMany({ where, skip, take: limit, orderBy: { saleDate: 'desc' }, include: { items: true } }),
      prisma.sale.count({ where }),
    ]);

    res.json({ data: sales, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('List sales error:', error);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// GET /api/sales/stats
router.get('/stats', authorize(['sales:read', 'sales:manage', 'dashboard:read']), async (req, res) => {
  try {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, allCompleted, today, month, balanceAgg] = await Promise.all([
      prisma.sale.count({ where: { isDeleted: false } }),
      prisma.sale.aggregate({ where: { isDeleted: false, status: 'COMPLETED' }, _sum: { total: true } }),
      prisma.sale.aggregate({ where: { isDeleted: false, status: 'COMPLETED', saleDate: { gte: dayStart } }, _sum: { total: true } }),
      prisma.sale.aggregate({ where: { isDeleted: false, status: 'COMPLETED', saleDate: { gte: monthStart } }, _sum: { total: true } }),
      prisma.sale.aggregate({ where: { isDeleted: false, status: 'COMPLETED', balance: { gt: 0 } }, _sum: { balance: true } }),
    ]);

    res.json({
      total,
      revenueToday: today._sum.total || 0,
      revenueMonth: month._sum.total || 0,
      revenueAll: allCompleted._sum.total || 0,
      balanceOutstanding: balanceAgg._sum.balance || 0,
    });
  } catch (error) {
    console.error('Sales stats error:', error);
    res.status(500).json({ error: 'Failed to fetch sales stats' });
  }
});

// GET /api/sales/:id
router.get('/:id', authorize(['sales:read', 'sales:manage']), async (req, res) => {
  try {
    const sale = await prisma.sale.findFirst({ where: { id: req.params.id, isDeleted: false }, include: { items: true } });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    res.json(sale);
  } catch (error) {
    console.error('Get sale error:', error);
    res.status(500).json({ error: 'Failed to fetch sale' });
  }
});

// POST /api/sales
router.post('/', authorize(['sales:create', 'sales:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = saleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const input = { ...parsed.data, deviceId: parsed.data.deviceId || req.user?.deviceId };

    if (input.id) {
      const existing = await prisma.sale.findUnique({ where: { id: input.id } });
      if (existing && !existing.isDeleted) {
        return res.status(409).json({ error: 'Sale already exists', code: 'ALREADY_EXISTS', serverData: existing });
      }
    }

    const sale = await prisma.$transaction(async (tx) => buildSaleTxn(tx, input, { checkStock: true }));

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: input.deviceId || 'server',
        entityType: 'Sale',
        entityId: sale.id,
        operation: 'CREATE',
        status: 'SYNCED',
        version: 1,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'sale.create', sale.id, { invoiceNo: sale.invoiceNo, total: sale.total }, undefined, input.deviceId, req.ip);

    res.status(201).json(sale);
  } catch (error: any) {
    if (error.code === 'INSUFFICIENT_STOCK') {
      return res.status(409).json({ error: error.message, code: error.code, details: error.details });
    }
    if (error.code === 'CUSTOMER_NOT_FOUND') {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('Create sale error:', error);
    res.status(500).json({ error: 'Failed to create sale' });
  }
});

// DELETE /api/sales/:id - cancel: soft delete + restore stock if it was COMPLETED
router.delete('/:id', authorize(['sales:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.sale.findFirst({ where: { id: req.params.id, isDeleted: false }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: 'Sale not found' });

    await prisma.$transaction(async (tx) => {
      if (existing.status === 'COMPLETED') {
        for (const it of existing.items) {
          if (it.productId) {
            await tx.product.update({
              where: { id: it.productId },
              data: { stockQuantity: { increment: it.quantity }, version: { increment: 1 }, lastSyncedAt: new Date() },
            });
          }
        }
      }
      await tx.sale.update({
        where: { id: existing.id },
        data: { isDeleted: true, status: 'CANCELLED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId },
      });
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: req.user?.deviceId || 'server',
        entityType: 'Sale',
        entityId: existing.id,
        operation: 'DELETE',
        status: 'SYNCED',
        version: existing.version + 1,
        syncedAt: new Date(),
      },
    });
    await audit(req.user?.userId, 'sale.delete', existing.id, undefined, { invoiceNo: existing.invoiceNo }, req.user?.deviceId, req.ip);

    res.json({ message: 'Sale cancelled and stock restored' });
  } catch (error) {
    console.error('Delete sale error:', error);
    res.status(500).json({ error: 'Failed to cancel sale' });
  }
});

export default router;
