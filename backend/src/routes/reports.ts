import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Reports (Phase 12) - read-only cross-module aggregation.
// Everything is derived server-side from canonical BIF amounts; the window is
// inclusive on both ends, capped at 366 days. The client re-computes the same
// shape from its Dexie cache when offline (no sync surface - nothing to write).
// ---------------------------------------------------------------------------

const router = Router();
router.use(authenticate);

const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (v: string): Date | null => {
  const t = Date.parse(`${v}T00:00:00Z`);
  return isNaN(t) ? null : new Date(t);
};
const r100 = (n: number) => Math.round(n); // storage is already whole BIF; guard float noise

router.get('/summary', authorize(['reports:read', 'reports:manage']), async (req, res) => {
  try {
    const now = new Date();
    let to: Date, from: Date;
    if (req.query.to) { to = parseDay(String(req.query.to))!; if (!to) return res.status(400).json({ error: 'to must be YYYY-MM-DD' }); }
    else to = new Date(new Date(now).setUTCHours(0, 0, 0, 0));
    if (req.query.from) { from = parseDay(String(req.query.from))!; if (!from) return res.status(400).json({ error: 'from must be YYYY-MM-DD' }); }
    else from = new Date(to.getTime() - 29 * DAY);
    from = new Date(new Date(from).setUTCHours(0, 0, 0, 0));
    if (to < from) return res.status(400).json({ error: 'to date precedes from date' });
    const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    if (days > 366) return res.status(400).json({ error: 'Window is capped at 366 days' });
    const end = new Date(to.getTime() + DAY); // exclusive

    // ---- revenue sources (completed/returned jobs bill; sales bill at saleDate; cash = payments)
    const [washRows, maintRows, rentalRows, saleRows, payRows, purchaseRows, expenseRows] = await Promise.all([
      prisma.carWashOrder.findMany({ where: { isDeleted: false, status: 'COMPLETED', completedAt: { gte: from, lt: end } }, select: { totalAmount: true, paymentMethod: true, completedAt: true } }),
      prisma.maintenanceOrder.findMany({ where: { isDeleted: false, status: 'COMPLETED', completedAt: { gte: from, lt: end } }, select: { totalAmount: true, paymentMethod: true, completedAt: true, partsJson: true } }),
      prisma.rentalBooking.findMany({ where: { isDeleted: false, status: 'RETURNED', returnedAt: { gte: from, lt: end } }, select: { fleetClass: true, totalAmount: true, paymentMethod: true, returnedAt: true } }),
      prisma.sale.findMany({ where: { isDeleted: false, status: 'COMPLETED', saleDate: { gte: from, lt: end } }, select: { total: true, paymentMethod: true, saleDate: true, items: { select: { productName: true, quantity: true, lineTotal: true } } } }),
      prisma.payment.findMany({ where: { isDeleted: false, status: 'COMPLETED', paymentDate: { gte: from, lt: end } }, select: { amount: true, paymentMethod: true, paymentDate: true } }),
      prisma.purchase.findMany({ where: { isDeleted: false, status: 'RECEIVED', orderDate: { gte: from, lt: end } }, select: { total: true, balance: true } }),
      prisma.expense.findMany({ where: { isDeleted: false, date: { gte: from, lt: end } }, select: { amount: true, category: true } }),
    ]);

    const sum = (xs: any[], k: string) => xs.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    const washAmt = r100(sum(washRows, 'totalAmount'));
    const maintAmt = r100(sum(maintRows, 'totalAmount'));
    const rentalEv = rentalRows.filter(r => r.fleetClass === 'EV');
    const rentalTr = rentalRows.filter(r => r.fleetClass === 'TRUCK');
    const rentalAmt = r100(sum(rentalRows, 'totalAmount'));
    const salesAmt = r100(sum(saleRows, 'total'));
    const billed = washAmt + maintAmt + rentalAmt + salesAmt;

    // ---- cash received (customer payments) with method split
    const cashReceived = r100(sum(payRows, 'amount'));
    const byMethod: Record<string, number> = {};
    for (const p of payRows) {
      const m = p.paymentMethod || 'CASH';
      byMethod[m] = (byMethod[m] || 0) + r100(p.amount);
    }

    // ---- daily buckets for the chart
    const daily: { date: string; carwash: number; maintenance: number; rentals: number; sales: number; cash: number; total: number }[] = [];
    const idx = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const key = ymd(new Date(from.getTime() + i * DAY));
      idx.set(key, i);
      daily.push({ date: key, carwash: 0, maintenance: 0, rentals: 0, sales: 0, cash: 0, total: 0 });
    }
    const bump = (d: Date | null | undefined, field: 'carwash' | 'maintenance' | 'rentals' | 'sales' | 'cash', amt: number) => {
      if (!d) return;
      const slot = daily[idx.get(ymd(new Date(d)))!];
      if (!slot) return;
      (slot as any)[field] = r100((slot as any)[field] + amt);
      if (field !== 'cash') slot.total = r100(slot.total + amt); // 'total' is billed revenue; cash is a separate series
    };
    for (const w of washRows) bump(w.completedAt, 'carwash', w.totalAmount);
    for (const m of maintRows) bump(m.completedAt, 'maintenance', m.totalAmount);
    for (const r of rentalRows) bump(r.returnedAt, 'rentals', r.totalAmount);
    for (const s of saleRows) bump(s.saleDate, 'sales', s.total);
    for (const p of payRows) bump(p.paymentDate, 'cash', p.amount);

    // ---- top products: POS lines + maintenance parts consumed in the window
    const prodMap = new Map<string, { qty: number; amount: number }>();
    const addLine = (name: string, qty: number, amount: number) => {
      if (!name) return;
      const cur = prodMap.get(name) || { qty: 0, amount: 0 };
      cur.qty += qty; cur.amount += amount;
      prodMap.set(name, cur);
    };
    for (const s of saleRows) for (const it of (s as any).items || []) addLine(it.productName, it.quantity || 0, it.lineTotal || 0);
    for (const m of maintRows) {
      try { for (const l of JSON.parse(String(m.partsJson || '[]'))) addLine(l.name || l.sku || 'part', l.qty || 0, l.lineTotal || 0); } catch { /* tolerate bad json */ }
    }
    const topProducts = [...prodMap.entries()]
      .map(([name, v]) => ({ name, qty: v.qty, amount: r100(v.amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    // ---- balances (all-time, independent of window) + cost side of the window
    const [arAgg, apAgg, emps, products, vehTotal, vehInUse, evUnits, trUnits, openBookings] = await Promise.all([
      prisma.sale.aggregate({ where: { isDeleted: false, status: 'COMPLETED', balance: { gt: 0 } }, _sum: { balance: true } }),
      prisma.purchase.aggregate({ where: { isDeleted: false, status: 'RECEIVED', balance: { gt: 0 } }, _sum: { balance: true } }),
      prisma.employee.findMany({ where: { isDeleted: false, isActive: true }, select: { salary: true } }),
      prisma.product.findMany({ where: { isDeleted: false, isActive: true }, select: { stockQuantity: true, reorderLevel: true, purchasePrice: true } }),
      prisma.vehicle.count({ where: { isDeleted: false } }),
      prisma.vehicle.count({ where: { isDeleted: false, status: 'IN_USE' } }),
      prisma.rentalUnit.count({ where: { isDeleted: false, fleetClass: 'EV' } }),
      prisma.rentalUnit.count({ where: { isDeleted: false, fleetClass: 'TRUCK' } }),
      prisma.rentalBooking.findMany({
        where: { isDeleted: false, status: { in: ['ACTIVE', 'RETURNED'] }, startDate: { lt: end }, endDate: { gte: from } },
        select: { fleetClass: true, startDate: true, endDate: true },
      }),
    ]);

    const occupancy = (cls: 'EV' | 'TRUCK') => {
      let occ = 0;
      for (const b of openBookings) {
        if (b.fleetClass !== cls) continue;
        const s = Math.max(from.getTime(), new Date(b.startDate).getTime());
        const e = Math.min(to.getTime(), new Date(b.endDate).getTime()); // inclusive-day window clamped to period
        if (e >= s) occ += Math.round((e - s) / DAY) + 1;
      }
      const cap = (cls === 'EV' ? evUnits : trUnits) * days;
      return { occupiedDays: occ, capacityDays: cap, pct: cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0 };
    };

    const stockValue = products.reduce((a, p) => a + (p.stockQuantity || 0) * (p.purchasePrice || 0), 0);
    const payroll = emps.reduce((a, e) => a + (e.salary || 0), 0);

    res.json({
      window: { from: ymd(from), to: ymd(to), days },
      revenue: {
        total: billed,
        carwash: { count: washRows.length, amount: washAmt },
        maintenance: { count: maintRows.length, amount: maintAmt },
        rentals: { count: rentalRows.length, amount: rentalAmt, ev: { count: rentalEv.length, amount: r100(sum(rentalEv, 'totalAmount')) }, truck: { count: rentalTr.length, amount: r100(sum(rentalTr, 'totalAmount')) } },
        sales: { count: saleRows.length, amount: salesAmt },
      },
      cash: { received: cashReceived, byMethod },
      daily,
      topProducts,
      expenses: (() => {
        const byCat: Record<string, number> = {};
        for (const x of expenseRows) byCat[x.category] = (byCat[x.category] || 0) + r100(x.amount);
        return { count: expenseRows.length, amount: r100(sum(expenseRows, 'amount')), byCategory: byCat, net: billed - r100(sum(expenseRows, 'amount')) };
      })(),
      purchases: { count: purchaseRows.length, amount: r100(sum(purchaseRows, 'total')) },
      payables: r100(apAgg._sum.balance || 0),
      receivables: r100(arAgg._sum.balance || 0),
      payroll: { headcount: emps.length, monthly: r100(payroll) },
      inventory: { products: products.length, lowStock: products.filter(p => p.stockQuantity <= p.reorderLevel).length, stockValue: r100(stockValue) },
      fleet: { total: vehTotal, inUse: vehInUse },
      utilization: { ev: occupancy('EV'), truck: occupancy('TRUCK') },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('reports summary error:', e);
    res.status(500).json({ error: 'Failed to build report' });
  }
});

export default router;
