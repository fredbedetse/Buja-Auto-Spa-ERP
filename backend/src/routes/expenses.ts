import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Expenses (Phase 13) - simple operating-expense ledger.
// Categories are fixed; amounts are canonical BIF, rounded server-side.
// expenseNo = EXP-YYYY-NNNNN assigned by the server (TMP-EXP-xxx offline).
// Fully syncable like wash/maintenance/rentals; deletions are tombstones.
// ---------------------------------------------------------------------------

const DAY = 86400000;
export const EXPENSE_CATEGORIES = ['FUEL', 'RENT', 'UTILITIES', 'SUPPLIES', 'INSURANCE', 'TRANSPORT', 'MARKETING', 'MISC'] as const;
const CAT_ENUM = z.enum(EXPENSE_CATEGORIES);
const METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;
const midnight = (v: string | Date) => new Date(new Date(v).setUTCHours(0, 0, 0, 0));
const r100 = (n: number) => Math.round(n);

export async function nextExpenseNo(year: number): Promise<string> {
  for (let n = 1; n < 100000; n++) {
    const candidate = `EXP-${year}-${String(n).padStart(5, '0')}`;
    const clash = await prisma.expense.findUnique({ where: { expenseNo: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw new Error('EXPENSE_NUMBER_EXHAUSTED');
}

const expCreate = z.object({
  id: z.string().uuid().optional(),
  category: CAT_ENUM,
  amount: z.number().finite().positive(),
  date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}/), z.string().datetime()]).optional(),
  vendor: z.string().trim().min(1).max(120).optional(),
  paidBy: z.string().trim().max(80).optional(),
  paymentMethod: z.enum(METHODS as any).optional(),
  notes: z.string().trim().max(500).optional(),
});
const expUpdate = expCreate.partial().omit({ id: true }).extend({ version: z.number().int().positive().optional() });

const router = Router();
router.use(authenticate);

// GET /api/expenses?category&from&to&search&page&limit
router.get('/', authorize(['expenses:read', 'expenses:manage']), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const where: any = { isDeleted: false };
    if (req.query.category && CAT_ENUM.safeParse(req.query.category).success) where.category = req.query.category;
    const from = req.query.from ? midnight(String(req.query.from)) : null;
    const to = req.query.to ? midnight(String(req.query.to)) : null;
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: new Date(to.getTime() + DAY - 1) } : {}) };
    const search = String(req.query.search || '').trim();
    if (search) where.OR = [
      { expenseNo: { contains: search } }, { vendor: { contains: search } },
      { paidBy: { contains: search } }, { notes: { contains: search } },
    ];
    const [rows, total] = await Promise.all([
      prisma.expense.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      prisma.expense.count({ where }),
    ]);
    res.json({ data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { console.error('expenses list error:', e); res.status(500).json({ error: 'Failed to fetch expenses' }); }
});

// GET /api/expenses/stats
router.get('/stats', authorize(['expenses:read', 'expenses:manage', 'dashboard:read']), async (_req, res) => {
  try {
    const now = new Date();
    const day0 = midnight(now);
    const month0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [todayAgg, monthAgg, allAgg, byCat] = await Promise.all([
      prisma.expense.aggregate({ where: { isDeleted: false, date: { gte: day0 } }, _count: true, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { isDeleted: false, date: { gte: month0 } }, _count: true, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { isDeleted: false }, _count: true, _sum: { amount: true } }),
      prisma.expense.groupBy({ by: ['category'], where: { isDeleted: false, date: { gte: month0 } }, _count: true, _sum: { amount: true } }),
    ]);
    res.json({
      total: allAgg._sum.amount || 0,
      count: allAgg._count,
      today: { count: todayAgg._count, amount: todayAgg._sum.amount || 0 },
      month: { count: monthAgg._count, amount: monthAgg._sum.amount || 0 },
      byCategory: byCat.map(c => ({ category: c.category, count: c._count, amount: c._sum.amount || 0 })).sort((a: any, b: any) => b.amount - a.amount),
    });
  } catch (e) { console.error('expenses stats error:', e); res.status(500).json({ error: 'Failed to build stats' }); }
});

router.get('/:id', authorize(['expenses:read', 'expenses:manage']), async (req, res) => {
  const row = await prisma.expense.findFirst({ where: { id: req.params.id, isDeleted: false } });
  if (!row) return res.status(404).json({ error: 'Expense not found' });
  res.json(row);
});

// POST /api/expenses - idempotent on client uuid
router.post('/', authorize(['expenses:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const d = expCreate.parse(req.body);
    if (d.id) {
      const dupe = await prisma.expense.findUnique({ where: { id: d.id } });
      if (dupe) return res.status(200).json({ ...dupe, _idempotent: true });
    }
    const date = midnight(d.date || new Date());
    const expenseNo = await nextExpenseNo(date.getUTCFullYear());
    const row = await prisma.expense.create({
      data: {
        id: d.id, expenseNo, category: d.category, amount: r100(d.amount), date,
        vendor: d.vendor || null, paidBy: d.paidBy || null,
        paymentMethod: d.paymentMethod || 'CASH', notes: d.notes || null,
        lastSyncedAt: new Date(),
      },
    });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'Expense', entityId: row.id, operation: 'CREATE', status: 'SYNCED', version: 1, syncedAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'EXPENSE_CREATE', entityType: 'Expense', entityId: row.id, newData: JSON.stringify({ expenseNo, amount: row.amount, category: row.category }), ipAddress: req.ip } });
    res.status(201).json(row);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', issues: e.issues?.slice(0, 4) });
    console.error('expense create error:', e);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// PUT /api/expenses/:id
router.put('/:id', authorize(['expenses:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Expense not found' });
    const d = expUpdate.parse(req.body);
    if (d.version !== undefined && d.version !== existing.version) {
      return res.status(409).json({ error: 'Version conflict - reload the row', code: 'VERSION_CONFLICT', serverVersion: existing.version });
    }
    const upd: any = { lastSyncedAt: new Date(), version: { increment: 1 } };
    if (d.category) upd.category = d.category;
    if (d.amount !== undefined) { if (!(d.amount > 0)) return res.status(400).json({ error: 'Amount must be positive' }); upd.amount = r100(d.amount); }
    if (d.date) { upd.date = midnight(d.date); }
    if (d.vendor !== undefined) upd.vendor = d.vendor || null;
    if (d.paidBy !== undefined) upd.paidBy = d.paidBy || null;
    if (d.paymentMethod) upd.paymentMethod = d.paymentMethod;
    if (d.notes !== undefined) upd.notes = d.notes || null;
    const row = await prisma.expense.update({ where: { id: existing.id }, data: upd });
    // if the date year changed, renumber? No - expenseNo keeps its issue-year stamp, like WO/EVR.
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'Expense', entityId: row.id, operation: 'UPDATE', status: 'SYNCED', version: row.version, syncedAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'EXPENSE_UPDATE', entityType: 'Expense', entityId: row.id, oldData: JSON.stringify({ amount: existing.amount, category: existing.category }), newData: JSON.stringify({ amount: row.amount, category: row.category }), ipAddress: req.ip } });
    res.json(row);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', issues: e.issues?.slice(0, 4) });
    console.error('expense update error:', e);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// DELETE /api/expenses/:id - tombstone (mis-entries are legitimately deletable)
router.delete('/:id', authorize(['expenses:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Expense not found' });
    await prisma.expense.update({ where: { id: existing.id }, data: { isDeleted: true, version: { increment: 1 }, lastSyncedAt: new Date() } });
    await prisma.syncLog.create({ data: { userId: req.user?.userId, deviceId: req.user?.deviceId || 'api', entityType: 'Expense', entityId: existing.id, operation: 'DELETE', status: 'SYNCED', version: existing.version + 1, syncedAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'EXPENSE_DELETE', entityType: 'Expense', entityId: existing.id, oldData: JSON.stringify({ expenseNo: existing.expenseNo, amount: existing.amount }), ipAddress: req.ip } });
    res.json({ message: `${existing.expenseNo} removed from the ledger` });
  } catch (e) {
    console.error('expense delete error:', e);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
