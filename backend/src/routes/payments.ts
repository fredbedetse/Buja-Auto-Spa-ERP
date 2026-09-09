import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;

const paymentCreateSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for offline-first
  saleId: z.string().uuid('Invoice is required'),
  amount: z.number().positive('Amount must be positive').max(1e10),
  paymentMethod: z.enum(PAYMENT_METHODS).default('CASH'),
  paymentDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  reference: z.string().max(80).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  deviceId: z.string().optional(),
});

async function audit(userId: string | undefined, action: string, entityId: string, newData?: any, oldData?: any, deviceId?: string, ip?: string) {
  await prisma.auditLog.create({
    data: { userId, action, entityType: 'Payment', entityId, oldData: oldData ? JSON.stringify(oldData) : undefined, newData: newData ? JSON.stringify(newData) : undefined, ipAddress: ip, deviceId },
  });
}

export async function nextPaymentNo(client: any = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `RCPT-${year}-`;
  let seq = (await client.payment.count({ where: { paymentNo: { startsWith: prefix } } })) + 1;
  let candidate = `${prefix}${String(seq).padStart(5, '0')}`;
  while (await client.payment.findUnique({ where: { paymentNo: candidate } })) {
    seq++;
    candidate = `${prefix}${String(seq).padStart(5, '0')}`;
  }
  return candidate;
}

// GET /api/payments - receipts list with search/filters + pagination
router.get('/', authorize(['payments:read', 'payments:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const method = req.query.paymentMethod as string;
    const saleId = req.query.saleId as string;

    const where: any = {}; // VOID receipts stay visible on purpose (void ledger)
    if (req.query.includeVoid !== 'true') where.status = { not: 'VOID' };
    if (search) {
      where.OR = [
        { paymentNo: { contains: search } },
        { saleInvoiceNo: { contains: search } },
        { customerName: { contains: search } },
        { reference: { contains: search } },
      ];
    }
    if (status === 'COMPLETED' || status === 'VOID') where.status = status;
    if ((PAYMENT_METHODS as readonly string[]).includes(method || '')) where.paymentMethod = method;
    if (saleId) where.saleId = saleId;

    const skip = (page - 1) * limit;
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({ where, skip, take: limit, orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] }),
      prisma.payment.count({ where }),
    ]);

    res.json({ data: payments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('List payments error:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// GET /api/payments/stats
router.get('/stats', authorize(['payments:read', 'payments:manage', 'dashboard:read']), async (req, res) => {
  try {
    const now = new Date();
    const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const live = { status: 'COMPLETED' as const };
    const [count, todayAgg, monthAgg, allAgg] = await Promise.all([
      prisma.payment.count({ where: live }),
      prisma.payment.aggregate({ where: { ...live, paymentDate: { gte: startToday } }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { ...live, paymentDate: { gte: startMonth } }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: live, _sum: { amount: true } }),
    ]);
    // Outstanding = balances of completed (billed) sales only - drafts are not yet invoices
    const outstanding = await prisma.sale.aggregate({
      where: { isDeleted: false, status: 'COMPLETED' },
      _sum: { balance: true },
    });
    res.json({
      total: count,
      receivedToday: todayAgg._sum.amount || 0,
      receivedMonth: monthAgg._sum.amount || 0,
      receivedAll: allAgg._sum.amount || 0,
      outstandingAll: outstanding._sum.balance || 0,
    });
  } catch (error) {
    console.error('Payments stats error:', error);
    res.status(500).json({ error: 'Failed to fetch payment stats' });
  }
});

// GET /api/payments/:id
router.get('/:id', authorize(['payments:read', 'payments:manage']), async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// POST /api/payments - record a receipt against an invoice; moves the sale's paidAmount
router.post('/', authorize(['payments:manage']), async (req: AuthenticatedRequest, res) => {
  let clientId: string | undefined;
  try {
    const parsed = paymentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { deviceId, id: cid, paymentDate, ...rest } = parsed.data;
    clientId = cid;

    const sale = await prisma.sale.findFirst({ where: { id: rest.saleId, isDeleted: false } });
    if (!sale) return res.status(404).json({ error: 'Invoice not found' });
    if (sale.status === 'CANCELLED') return res.status(409).json({ error: 'Invoice is cancelled', code: 'SALE_CANCELLED' });
    if (sale.status !== 'COMPLETED') return res.status(409).json({ error: 'Only completed sales can receive payments', code: 'SALE_NOT_COMPLETED' });

    // Replay guard: if the client's id already exists, return it untouched (offline re-send)
    if (clientId) {
      const dup = await prisma.payment.findUnique({ where: { id: clientId } });
      if (dup) return res.status(200).json(dup);
    }

    const bal = Math.max(0, (sale.balance ?? 0));
    if (rest.amount > bal + 0.001) {
      return res.status(400).json({
        error: 'Payment exceeds the outstanding balance',
        code: 'EXCEEDS_BALANCE',
        details: { balance: bal, requested: rest.amount },
      });
    }

    const paymentNo = await nextPaymentNo();
    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          ...(clientId ? { id: clientId } : {}),
          paymentNo,
          saleId: sale.id,
          saleInvoiceNo: sale.invoiceNo,
          customerName: sale.customerName,
          amount: rest.amount,
          paymentMethod: rest.paymentMethod,
          paymentDate: new Date(paymentDate),
          reference: rest.reference || null,
          notes: rest.notes || null,
          lastSyncedAt: new Date(),
          deviceId: deviceId || req.user?.deviceId,
        },
      });
      const paid = (sale.paidAmount || 0) + p.amount;
      const balance = Math.max(0, sale.total - paid);
      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: { paidAmount: paid, balance, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: deviceId || req.user?.deviceId },
      });
      await tx.syncLog.create({
        data: { userId: req.user?.userId, deviceId: deviceId || req.user?.deviceId || 'server', entityType: 'Sale', entityId: sale.id, operation: 'UPDATE', status: 'SYNCED', version: updatedSale.version, syncedAt: new Date() },
      });
      return p;
    });

    await prisma.syncLog.create({
      data: { userId: req.user?.userId, deviceId: deviceId || req.user?.deviceId || 'server', entityType: 'Payment', entityId: created.id, operation: 'CREATE', status: 'SYNCED', version: created.version, syncedAt: new Date() },
    });
    await audit(req.user?.userId, 'payment.create', created.id, { paymentNo: created.paymentNo, amount: created.amount, saleInvoiceNo: created.saleInvoiceNo }, undefined, deviceId, req.ip);

    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === 'P2002') {
      // paymentNo race: mint a new one once, else it was a client-id dup -> return existing
      const existing = clientId ? await prisma.payment.findUnique({ where: { id: clientId } }) : null;
      if (existing) return res.status(200).json(existing);
      return res.status(409).json({ error: 'Receipt number collision, retry', code: 'NUMBER_RACE' });
    }
    console.error('Create payment error:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// DELETE /api/payments/:id - void a receipt and give the balance back to the invoice
router.delete('/:id', authorize(['payments:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });
    if (existing.status === 'VOID') return res.json({ message: 'Receipt already voided' });

    const sale = await prisma.sale.findUnique({ where: { id: existing.saleId } });
    const reason = (req.query.reason as string) || 'Voided at counter';

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: existing.id },
        data: { status: 'VOID', voidReason: reason, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId },
      });
      if (sale && !sale.isDeleted) {
        const paid = Math.max(0, (sale.paidAmount || 0) - existing.amount);
        const balance = Math.max(0, sale.total - paid);
        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: { paidAmount: paid, balance, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId: req.user?.deviceId },
        });
        await tx.syncLog.create({
          data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'server', entityType: 'Sale', entityId: sale.id, operation: 'UPDATE', status: 'SYNCED', version: updatedSale.version, syncedAt: new Date() },
        });
      }
      await tx.syncLog.create({
        data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'server', entityType: 'Payment', entityId: existing.id, operation: 'UPDATE', status: 'SYNCED', version: existing.version + 1, syncedAt: new Date() },
      });
    });
    await audit(req.user?.userId, 'payment.void', existing.id, undefined, { paymentNo: existing.paymentNo, amount: existing.amount }, req.user?.deviceId, req.ip);

    res.json({ message: `Receipt ${existing.paymentNo} voided` });
  } catch (error) {
    console.error('Void payment error:', error);
    res.status(500).json({ error: 'Failed to void payment' });
  }
});

export default router;
