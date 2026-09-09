import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Invoices are the billing face of sales; status is derived from the payment ledger.
const OVERDUE_DAYS = 30;

function billingStatus(s: { total: number; paidAmount: number; balance: number; status: string; saleDate: Date }) {
  if (s.status === 'CANCELLED') return 'CANCELLED' as const;
  if (s.status === 'DRAFT') return 'DRAFT' as const;
  const bal = Math.max(0, s.balance ?? s.total - (s.paidAmount || 0));
  if (bal <= 0.001) return 'PAID' as const;
  if ((s.paidAmount || 0) > 0) return 'PARTIAL' as const;
  const ageDays = (Date.now() - new Date(s.saleDate).getTime()) / 86_400_000;
  if (ageDays > OVERDUE_DAYS) return 'OVERDUE' as const;
  return 'UNPAID' as const;
}

// GET /api/invoices
router.get('/', authorize(['invoices:read', 'invoices:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const billing = (req.query.billing as string) || '';

    const where: any = { isDeleted: false };
    if (search) {
      where.OR = [
        { invoiceNo: { contains: search } },
        { customerName: { contains: search } },
      ];
    }
    const sales = await prisma.sale.findMany({
      where,
      include: { items: true },
      orderBy: { saleDate: 'desc' },
    });

    let rows = sales.map(s => ({ ...s, billingStatus: billingStatus(s as any) }));
    if (billing) rows = rows.filter(r => r.billingStatus === billing);

    const total = rows.length;
    const data = rows.slice((page - 1) * limit, (page - 1) * limit + limit);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('List invoices error:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// GET /api/invoices/stats
router.get('/stats', authorize(['invoices:read', 'invoices:manage', 'dashboard:read']), async (req, res) => {
  try {
    const sales = await prisma.sale.findMany({ where: { isDeleted: false } });
    const counts: Record<string, number> = { DRAFT: 0, UNPAID: 0, PARTIAL: 0, PAID: 0, OVERDUE: 0, CANCELLED: 0 };
    let outstanding = 0;
    for (const s of sales) {
      const st = billingStatus(s as any);
      counts[st] = (counts[st] || 0) + 1;
      if (st === 'UNPAID' || st === 'PARTIAL' || st === 'OVERDUE') outstanding += Math.max(0, s.balance ?? 0);
    }
    res.json({ total: sales.length, byBilling: counts, outstanding: Math.round(outstanding) });
  } catch (error) {
    console.error('Invoices stats error:', error);
    res.status(500).json({ error: 'Failed to fetch invoice stats' });
  }
});

// GET /api/invoices/:id - document view: sale + lines + receipts
router.get('/:id', authorize(['invoices:read', 'invoices:manage']), async (req, res) => {
  try {
    const sale = await prisma.sale.findFirst({ where: { id: req.params.id, isDeleted: false }, include: { items: true } });
    if (!sale) return res.status(404).json({ error: 'Invoice not found' });
    const payments = await prisma.payment.findMany({ where: { saleId: sale.id }, orderBy: { paymentDate: 'asc' } });
    res.json({ ...sale, billingStatus: billingStatus(sale as any), payments });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

export default router;
