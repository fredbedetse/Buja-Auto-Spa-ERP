import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Payroll (Phase 16) - manager/admin only (payroll:read is granted to nobody
// else, deliberately). Runs snapshot employee salaries at creation, so a
// later salary edit never rewrites a closed month. Money flow:
//   OPEN --approve--> APPROVED --settle--> PAID  (PAID --unapprove--> APPROVED)
// Online-only by design: payroll rows never sit in an unconfirmed queue.
// ---------------------------------------------------------------------------

const r100 = (n: number) => Math.max(0, Math.round(n));
const METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'] as const;

const runCreate = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  note: z.string().trim().max(300).optional(),
  employeeIds: z.array(z.string().uuid()).optional(), // default: all active
});
const itemPatch = z.object({
  bonus: z.number().finite().min(0).max(500_000_000).optional(),
  deduction: z.number().finite().min(0).max(500_000_000).optional(),
  notes: z.string().trim().max(300).optional(),
});
const METHOD_ENUM = z.enum(METHODS as any);

const router = Router();
router.use(authenticate);

// GET /api/payroll/runs?year=
router.get('/runs', authorize(['payroll:read', 'payroll:manage']), async (req, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const where: any = { isDeleted: false, ...(year && Number.isInteger(year) ? { year } : {}) };
    const runs = await prisma.payrollRun.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        _count: { select: { items: true } },
        items: { select: { net: true, paid: true, baseSalary: true, bonus: true, deduction: true } },
      },
    });
    const data = runs.map(r => ({
      id: r.id, runNo: r.runNo, year: r.year, month: r.month, status: r.status,
      note: r.note, settledAt: r.settledAt, paymentMethod: r.paymentMethod, version: r.version,
      createdAt: r.createdAt, updatedAt: r.updatedAt, employees: r._count.items,
      gross: r100(r.items.reduce((a, x) => a + x.baseSalary + x.bonus, 0)),
      deductions: r100(r.items.reduce((a, x) => a + x.deduction, 0)),
      net: r100(r.items.reduce((a, x) => a + x.net, 0)),
      paidCount: r.items.filter(x => x.paid).length,
    }));
    res.json({ data });
  } catch (e) { console.error('payroll runs error:', e); res.status(500).json({ error: 'Failed to list runs' }); }
});

// GET /api/payroll/stats - dashboard card + header chips
router.get('/stats', authorize(['payroll:read', 'payroll:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const now = new Date();
    const y = now.getUTCFullYear();
    const [runs, paidAgg, headcount, openRun] = await Promise.all([
      prisma.payrollRun.count({ where: { isDeleted: false } }),
      prisma.payrollItem.aggregate({ where: { paid: true, run: { isDeleted: false, year: y } }, _sum: { net: true }, _count: true }),
      prisma.employee.count({ where: { isDeleted: false, isActive: true, employmentStatus: 'ACTIVE' } }),
      prisma.payrollRun.findFirst({ where: { isDeleted: false, status: { in: ['OPEN', 'APPROVED'] } }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { runNo: true, status: true } }),
    ]);
    res.json({
      runs, headcount,
      paidThisYear: { count: paidAgg._count, amount: paidAgg._sum.net || 0 },
      openRun: openRun || null,
      monthlyBudget: r100((await prisma.employee.aggregate({ where: { isDeleted: false, isActive: true, employmentStatus: 'ACTIVE' }, _sum: { salary: true } }))._sum.salary || 0),
    });
  } catch (e) { console.error('payroll stats error:', e); res.status(500).json({ error: 'Failed to build stats' }); }
});

router.get('/runs/:id', authorize(['payroll:read', 'payroll:manage']), async (req, res) => {
  const run = await prisma.payrollRun.findFirst({
    where: { id: req.params.id, isDeleted: false },
    include: { items: { orderBy: { name: 'asc' } } },
  });
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

// POST /api/payroll/runs - snapshot actives (or a subset) into a new OPEN run
router.post('/runs', authorize(['payroll:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const d = runCreate.parse(req.body);
    const clash = await prisma.payrollRun.findUnique({ where: { runNo: `PR-${d.year}-${String(d.month).padStart(2, '0')}` } });
    if (clash && !clash.isDeleted) return res.status(409).json({ error: `Run ${clash.runNo} already exists`, code: 'RUN_EXISTS', id: clash.id });
    if (clash && clash.isDeleted) await prisma.payrollRun.delete({ where: { id: clash.id } }); // hard-remove tombstone so the unique slot frees
    const emps = await prisma.employee.findMany({
      where: { isDeleted: false, isActive: true, employmentStatus: 'ACTIVE', ...(d.employeeIds?.length ? { id: { in: d.employeeIds } } : {}) },
      select: { id: true, firstName: true, lastName: true, position: true, salary: true },
      orderBy: { lastName: 'asc' },
    });
    if (!emps.length) return res.status(400).json({ error: 'No active employees to pay' });
    const run = await prisma.payrollRun.create({
      data: {
        runNo: `PR-${d.year}-${String(d.month).padStart(2, '0')}`, year: d.year, month: d.month, note: d.note || null,
        items: { create: emps.map(e => ({
          employeeId: e.id, name: `${e.firstName} ${e.lastName}`, position: e.position,
          baseSalary: r100(e.salary), net: r100(e.salary),
        })) },
      },
      include: { items: true },
    });
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'PAYROLL_RUN_CREATE', entityType: 'PayrollRun', entityId: run.id, newData: JSON.stringify({ runNo: run.runNo, employees: run.items.length }) } as any });
    res.status(201).json(run);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', issues: e.issues?.slice(0, 3) });
    console.error('payroll run create error:', e);
    res.status(500).json({ error: 'Failed to create run' });
  }
});

// PUT /api/payroll/runs/:id - status transitions + note (settle/unsettle have their own endpoints)
router.put('/runs/:id', authorize(['payroll:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.payrollRun.findFirst({ where: { id: req.params.id, isDeleted: false }, include: { _count: { select: { items: true } } } });
    if (!existing) return res.status(404).json({ error: 'Run not found' });
    const d = z.object({ status: z.enum(['OPEN', 'APPROVED'] as any), note: z.string().trim().max(300).optional() }).parse(req.body);
    if (existing.status === 'PAID') return res.status(400).json({ error: 'A paid run is history - reopen via unsettle', code: 'RUN_PAID' });
    if (d.status === 'APPROVED' && existing._count.items === 0) return res.status(400).json({ error: 'Nothing to approve' });
    const run = await prisma.payrollRun.update({ where: { id: existing.id }, data: { status: d.status, ...(d.note !== undefined ? { note: d.note } : {}), version: { increment: 1 } } });
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'PAYROLL_UPDATE', entityType: 'PayrollRun', entityId: run.id, oldData: JSON.stringify({ status: existing.status }), newData: JSON.stringify({ status: run.status }) } as any });
    res.json(run);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Only OPEN/APPROVED can be set here', issues: e.issues?.slice(0, 2) });
    console.error('payroll run update error:', e); res.status(500).json({ error: 'Failed to update run' });
  }
});

// POST /api/payroll/runs/:id/settle - pay everyone; only from APPROVED
router.post('/runs/:id/settle', authorize(['payroll:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.payrollRun.findFirst({ where: { id: req.params.id, isDeleted: false }, include: { items: { select: { id: true } } } });
    if (!existing) return res.status(404).json({ error: 'Run not found' });
    if (existing.status === 'PAID') return res.json({ ok: true, unchanged: true, ...existing });
    if (existing.status !== 'APPROVED') return res.status(400).json({ error: 'Approve the run before settling', code: 'RUN_NOT_APPROVED' });
    const method = req.body?.paymentMethod ? METHOD_ENUM.parse(req.body.paymentMethod) : 'BANK_TRANSFER';
    await prisma.payrollItem.updateMany({ where: { runId: existing.id }, data: { paid: true, paidAt: new Date(), paymentMethod: method } });
    const run = await prisma.payrollRun.update({ where: { id: existing.id }, data: { status: 'PAID', settledAt: new Date(), paymentMethod: method, version: { increment: 1 } }, include: { _count: { select: { items: true } } } });
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'PAYROLL_SETTLE', entityType: 'PayrollRun', entityId: run.id, newData: JSON.stringify({ method, employees: run._count.items }) } as any });
    res.json(run);
  } catch (e) { console.error('payroll settle error:', e); res.status(500).json({ error: 'Failed to settle run' }); }
});

// POST /api/payroll/runs/:id/unsettle - PAID -> APPROVED (corrections only; wipes paid flags)
router.post('/runs/:id/unsettle', authorize(['payroll:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.payrollRun.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Run not found' });
    if (existing.status !== 'PAID') return res.status(400).json({ error: 'Only a paid run can be unsettled' });
    await prisma.payrollItem.updateMany({ where: { runId: existing.id }, data: { paid: false, paidAt: null, paymentMethod: null } });
    const run = await prisma.payrollRun.update({ where: { id: existing.id }, data: { status: 'APPROVED', settledAt: null, version: { increment: 1 } } });
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'PAYROLL_UNSETTLE', entityType: 'PayrollRun', entityId: run.id } as any });
    res.json(run);
  } catch (e) { console.error('payroll unsettle error:', e); res.status(500).json({ error: 'Failed to reopen run' }); }
});

// PATCH /api/payroll/items/:id - bonuses/deductions while the run is open/approved
router.patch('/items/:id', authorize(['payroll:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.payrollItem.findFirst({ where: { id: req.params.id }, include: { run: { select: { status: true, isDeleted: true, id: true } } } });
    if (!existing || existing.run.isDeleted) return res.status(404).json({ error: 'Item not found' });
    if (existing.run.status === 'PAID') return res.status(400).json({ error: 'Paid runs are locked', code: 'RUN_LOCKED' });
    const d = itemPatch.parse(req.body);
    const bonus = d.bonus !== undefined ? r100(d.bonus) : existing.bonus;
    const deduction = d.deduction !== undefined ? r100(d.deduction) : existing.deduction;
    if (deduction > existing.baseSalary + bonus) return res.status(400).json({ error: 'Deduction exceeds gross pay', code: 'DEDUCTION_CAPPED' });
    const row = await prisma.payrollItem.update({
      where: { id: existing.id },
      data: { bonus, deduction, net: r100(existing.baseSalary + bonus - deduction), ...(d.notes !== undefined ? { notes: d.notes } : {}) },
    });
    await prisma.payrollRun.update({ where: { id: existing.run.id }, data: { version: { increment: 1 }, status: 'OPEN' } }); // edit pulls run back to OPEN
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'PAYROLL_UPDATE', entityType: 'PayrollItem', entityId: row.id, oldData: JSON.stringify({ bonus: existing.bonus, deduction: existing.deduction }), newData: JSON.stringify({ bonus: row.bonus, deduction: row.deduction }) } as any });
    res.json(row);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', issues: e.issues?.slice(0, 2) });
    console.error('payroll item error:', e); res.status(500).json({ error: 'Failed to update item' });
  }
});

// DELETE /api/payroll/runs/:id - only an OPEN run may be discarded (items go with it)
router.delete('/runs/:id', authorize(['payroll:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.payrollRun.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Run not found' });
    if (existing.status !== 'OPEN') return res.status(400).json({ error: 'Only OPEN runs can be deleted', code: 'RUN_NOT_OPEN' });
    await prisma.payrollItem.deleteMany({ where: { runId: existing.id } });
    await prisma.payrollRun.delete({ where: { id: existing.id } });
    await prisma.auditLog.create({ data: { userId: req.user?.userId, action: 'PAYROLL_DELETE', entityType: 'PayrollRun', entityId: existing.id, oldData: JSON.stringify({ runNo: existing.runNo }) } as any });
    res.json({ message: `${existing.runNo} discarded` });
  } catch (e) { console.error('payroll delete error:', e); res.status(500).json({ error: 'Failed to delete run' }); }
});

export default router;
