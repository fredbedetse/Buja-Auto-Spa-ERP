import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Download, RefreshCw, Cloud, CloudOff, Wallet, TrendingUp, Users,
  Package, Truck, AlertTriangle, Landmark, Coins,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import { useT } from '../lib/i18n';
import { useMoney } from '../lib/money';

// ---------------------------------------------------------------------------
// Reports (Phase 12) - read-only cross-module analytics for the last window.
// Online: the server aggregates canonical BIF data. Offline (or 403): the same
// math runs in the browser over the Dexie cache. Nothing here is writable, so
// there is no sync surface - the numbers always recompute from source rows.
// ---------------------------------------------------------------------------

const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

interface Summary {
  window: { from: string; to: string; days: number };
  revenue: {
    total: number;
    carwash: { count: number; amount: number };
    maintenance: { count: number; amount: number };
    rentals: { count: number; amount: number; ev: { count: number; amount: number }; truck: { count: number; amount: number } };
    sales: { count: number; amount: number };
  };
  cash: { received: number; byMethod: Record<string, number> };
  daily: { date: string; carwash: number; maintenance: number; rentals: number; sales: number; cash: number; total: number }[];
  topProducts: { name: string; qty: number; amount: number }[];
  purchases: { count: number; amount: number };
  payables: number;
  receivables: number;
  payroll: { headcount: number; monthly: number };
  inventory: { products: number; lowStock: number; stockValue: number };
  fleet: { total: number; inUse: number };
  utilization: { ev: { occupiedDays: number; capacityDays: number; pct: number }; truck: { occupiedDays: number; capacityDays: number; pct: number } };
  generatedAt: string;
}

const MODULE_COLORS: Record<string, string> = {
  carwash: '#0EA5E9', maintenance: '#F59E0B', rentals: '#16A34A', sales: '#65A30D',
};

/** Same definitions as backend/src/routes/reports.ts, over the local cache. */
async function computeLocal(from: Date, to: Date): Promise<Summary> {
  const end = new Date(to.getTime() + DAY);
  const inWin = (d: any, k: string) => { const t = d[k] ? new Date(d[k]).getTime() : 0; return t >= from.getTime() && t < end.getTime(); };
  const sum = (xs: any[], k: string) => xs.reduce((a, x) => a + (Number(x[k]) || 0), 0);

  const [washAll, maintAll, rentalsAll, salesAll, payAll, purchAll, prods, emps, vehicles, units] = await Promise.all([
    localDB.washOrders.toArray(), localDB.maintenanceOrders.toArray(), localDB.rentalBookings.toArray(),
    localDB.sales.toArray(), localDB.payments.toArray(), localDB.purchases.toArray(),
    localDB.inventory.toArray(), localDB.employees.toArray(), localDB.vehicles.toArray(), localDB.rentalUnits.toArray(),
  ]);
  const wash = washAll.filter(o => !(o as any).isDeleted && o.status === 'COMPLETED' && inWin(o, 'completedAt'));
  const maint = maintAll.filter(o => !(o as any).isDeleted && o.status === 'COMPLETED' && inWin(o, 'completedAt'));
  const rentals = rentalsAll.filter(o => !(o as any).isDeleted && o.status === 'RETURNED' && inWin(o, 'returnedAt'));
  const sales = salesAll.filter(o => !(o as any).isDeleted && (o as any).status === 'COMPLETED' && inWin(o, 'saleDate'));
  const pays = payAll.filter(o => !(o as any).isDeleted && (o as any).status === 'COMPLETED' && inWin(o, 'paymentDate'));
  const purch = purchAll.filter(o => !(o as any).isDeleted && (o as any).status === 'RECEIVED' && inWin(o, 'orderDate'));

  const prodMap = new Map<string, { qty: number; amount: number }>();
  const addLine = (name: string, qty: number, amount: number) => {
    if (!name) return;
    const cur = prodMap.get(name) || { qty: 0, amount: 0 };
    cur.qty += qty; cur.amount += amount; prodMap.set(name, cur);
  };
  for (const s of sales) for (const it of (s as any).items || []) addLine(it.productName, it.quantity || 0, it.lineTotal || 0);
  for (const m of maint) {
    const lines: any[] = (m as any).partsLines || (() => { try { return JSON.parse((m as any).partsJson || '[]'); } catch { return []; } })();
    for (const l of lines) addLine(l.name || l.productName || l.sku || 'part', l.qty ?? l.quantity ?? 0, l.lineTotal || 0);
  }
  const daily: Summary['daily'] = [];
  const idx = new Map<string, number>();
  for (let i = 0; i <= Math.round((to.getTime() - from.getTime()) / DAY); i++) {
    const k = ymd(new Date(from.getTime() + i * DAY));
    idx.set(k, i);
    daily.push({ date: k, carwash: 0, maintenance: 0, rentals: 0, sales: 0, cash: 0, total: 0 });
  }
  const bump = (d: any, f: 'carwash' | 'maintenance' | 'rentals' | 'sales' | 'cash', amt: number, key: string) => {
    const slot = daily[idx.get(ymd(new Date(d)))!]; if (!slot) return;
    (slot as any)[f] += amt; if (f !== 'cash') slot.total += amt;
    void key;
  };
  for (const w of wash) bump(w.completedAt, 'carwash', w.totalAmount, 'totalAmount');
  for (const m of maint) bump(m.completedAt, 'maintenance', m.totalAmount, 'totalAmount');
  for (const r of rentals) bump(r.returnedAt, 'rentals', r.totalAmount, 'totalAmount');
  for (const s of sales) bump((s as any).saleDate, 'sales', (s as any).total, 'total');
  for (const p of pays) bump((p as any).paymentDate, 'cash', (p as any).amount, 'amount');

  const byMethod: Record<string, number> = {};
  for (const p of pays) { const k = (p as any).paymentMethod || 'CASH'; byMethod[k] = (byMethod[k] || 0) + (Number((p as any).amount) || 0); }
  const util = (cls: 'EV' | 'TRUCK') => {
    const un = units.filter(u => u.fleetClass === cls && !(u as any).isDeleted).length;
    let occ = 0;
    for (const b of rentalsAll) {
      if ((b as any).fleetClass !== cls || (b as any).isDeleted) continue;
      if (b.status !== 'ACTIVE' && b.status !== 'RETURNED') continue;
      const s = Math.max(from.getTime(), new Date(b.startDate).getTime());
      const e = Math.min(to.getTime(), new Date(b.endDate).getTime());
      if (e >= s) occ += Math.round((e - s) / DAY) + 1;
    }
    const cap = un * daily.length;
    return { occupiedDays: occ, capacityDays: cap, pct: cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0 };
  };
  const rev = { carwash: { count: wash.length, amount: sum(wash, 'totalAmount') }, maintenance: { count: maint.length, amount: sum(maint, 'totalAmount') } };
  const salesAmt = sum(sales, 'total');
  const rentAmt = sum(rentals, 'totalAmount');
  const open = rentalsAll.filter(b => (b.status === 'ACTIVE' || b.status === 'RETURNED') && new Date(b.startDate).getTime() < end.getTime() && new Date(b.endDate).getTime() >= from.getTime());
  void open;
  return {
    window: { from: ymd(from), to: ymd(to), days: daily.length },
    revenue: {
      total: rev.carwash.amount + rev.maintenance.amount + rentAmt + salesAmt,
      carwash: rev.carwash, maintenance: rev.maintenance,
      rentals: {
        count: rentals.length, amount: rentAmt,
        ev: { count: rentals.filter(r => r.fleetClass === 'EV').length, amount: sum(rentals.filter(r => r.fleetClass === 'EV'), 'totalAmount') },
        truck: { count: rentals.filter(r => r.fleetClass === 'TRUCK').length, amount: sum(rentals.filter(r => r.fleetClass === 'TRUCK'), 'totalAmount') },
      },
      sales: { count: sales.length, amount: salesAmt },
    },
    cash: { received: sum(pays, 'amount'), byMethod },
    daily,
    topProducts: [...prodMap.entries()].map(([name, v]) => ({ name, qty: v.qty, amount: v.amount })).sort((a, b) => b.amount - a.amount).slice(0, 8),
    purchases: { count: purch.length, amount: sum(purch, 'total') },
    payables: sum(purchAll.filter(o => !(o as any).isDeleted && (o as any).status === 'RECEIVED' && (o as any).balance > 0), 'balance'),
    receivables: sum(salesAll.filter(o => !(o as any).isDeleted && (o as any).status === 'COMPLETED' && (o as any).balance > 0), 'balance'),
    payroll: { headcount: emps.filter(e => !(e as any).isDeleted && e.isActive).length, monthly: sum(emps.filter(e => !(e as any).isDeleted && e.isActive), 'salary') },
    inventory: { products: prods.filter(p => p.isActive && !(p as any).isDeleted).length, lowStock: prods.filter(p => p.isActive && !(p as any).isDeleted && p.stockQuantity <= p.reorderLevel).length, stockValue: prods.filter(p => p.isActive && !(p as any).isDeleted).reduce((a, p) => a + p.stockQuantity * p.purchasePrice, 0) },
    fleet: { total: vehicles.filter(v => !(v as any).isDeleted).length, inUse: vehicles.filter(v => !(v as any).isDeleted && v.status === 'IN_USE').length },
    utilization: { ev: util('EV'), truck: util('TRUCK') },
    generatedAt: new Date().toISOString(),
  };
}

export default function ReportsPage() {
  const { t } = useT();
  const money = useMoney();
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 29 * DAY)));
  const [to, setTo] = useState(ymd(new Date()));
  const [R, setR] = useState<Summary | null>(null);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const load = async (f = from, to2 = to) => {
    setLoading(true);
    try {
      const s = await apiClient.get<Summary>(`/reports/summary?from=${f}&to=${to2}`);
      setR(s); setSource('cloud');
      setNotice(n => (n === t('rep.offline') ? '' : n));
    } catch {
      const s = await computeLocal(new Date(f + 'T00:00:00Z'), new Date(to2 + 'T00:00:00Z'));
      setR(s); setSource('local');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const applyWindow = (f: string, to2: string) => { setFrom(f); setTo(to2); load(f, to2); };
  const preset = (kind: '7' | '30' | '90' | 'ytd') => {
    const now = new Date();
    const to2 = ymd(now);
    if (kind === 'ytd') return applyWindow(`${now.getUTCFullYear()}-01-01`, to2);
    applyWindow(ymd(new Date(now.getTime() - (Number(kind) - 1) * DAY)), to2);
  };

  const exportCsv = () => {
    if (!R) return;
    const rows: (string | number)[][] = [];
    rows.push([`Buja Auto Spa ERP report`, `${R.window.from}..${R.window.to}`, `(${R.window.days} days)`, source === 'cloud' ? 'server' : 'local-cache']);
    rows.push([]);
    rows.push(['BILLED REVENUE', 'Count', 'Amount BIF', 'Share']);
    for (const [k, o] of Object.entries(R.revenue) as any) {
      if (k === 'total') continue;
      rows.push([k, o.count, o.amount, R.revenue.total ? Math.round((o.amount / R.revenue.total) * 100) + '%' : '0%']);
    }
    rows.push(['TOTAL', '', R.revenue.total, '100%']);
    rows.push([]);
    rows.push(['CASH RECEIVED', R.cash.received]);
    for (const [m, v] of Object.entries(R.cash.byMethod)) rows.push([' ' + m, v]);
    rows.push([]);
    rows.push(['DATE', 'CARWASH', 'MAINTENANCE', 'RENTALS', 'SALES', 'BILLED', 'CASH']);
    for (const d of R.daily) rows.push([d.date, d.carwash, d.maintenance, d.rentals, d.sales, d.total, d.cash]);
    rows.push([]);
    rows.push(['TOP PRODUCTS', 'QTY', 'AMOUNT BIF']);
    for (const p of R.topProducts) rows.push([p.name, p.qty, p.amount]);
    rows.push([]);
    rows.push(['Receivables', R.receivables]);
    rows.push(['Payables', R.payables]);
    rows.push(['Payroll/month', R.payroll.monthly, R.payroll.headcount + ' staff']);
    rows.push(['Stock value', R.inventory.stockValue, R.inventory.products + ' SKUs', R.inventory.lowStock + ' low']);
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `report_${R.window.from}_${R.window.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // ---- chart geometry
  const chart = useMemo(() => {
    if (!R || !R.daily.length) return null;
    const W = 920, H = 190, PAD = 26;
    const max = Math.max(1, ...R.daily.map(d => d.total));
    const bw = Math.max(4, Math.min(42, Math.floor((W - PAD * 2) / R.daily.length) - 4));
    const bars = R.daily.map((d, i) => {
      const x = PAD + i * ((W - PAD * 2) / R.daily.length);
      let yb = H - PAD;
      const segs = (['sales', 'rentals', 'maintenance', 'carwash'] as const).map(k => {
        const h = Math.round((d[k] / max) * (H - PAD * 2));
        yb -= h;
        return { k, y: yb, h };
      }).filter(s => s.h > 0);
      return { d, x, segs };
    });
    const labelEvery = Math.ceil(R.daily.length / 8);
    return { W, H, PAD, max, bw, bars, labelEvery };
  }, [R]);

  const share = (n: number) => (R && R.revenue.total ? Math.round((n / R.revenue.total) * 100) : 0);

  const KPI = ({ icon: Icon, k, v, sub, tone }: any) => (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-medium"><Icon size={12} />{t(k)}</div>
      <div className={`text-lg font-bold mt-0.5 ${tone === 'green' ? 'text-[#16A34A]' : tone === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{v}</div>
      {sub ? <div className="text-[11px] text-gray-500">{sub}</div> : null}
    </div>
  );

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      {/* header + window picker */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm bg-gradient-to-br from-[#16A34A] to-lime-600"><BarChart3 size={20} /></div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-bold text-gray-900">{t('nav.reports')}</h1>
          <p className="text-xs text-gray-500">{t('rep.sub')}</p>
        </div>
        <span className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium ${source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
          {source === 'cloud' ? <Cloud size={12} /> : <CloudOff size={12} />}{t(source === 'cloud' ? 'c.cloudCache' : 'c.offlineData')}
        </span>
        <button onClick={() => load()} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />{t('c.reload')}</button>
        <button onClick={exportCsv} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#16A34A] text-white font-semibold hover:bg-[#128a3e] shadow-sm"><Download size={14} />{t('rep.export')}</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2.5 shadow-sm">
        {(['7', '30', '90', 'ytd'] as const).map(p => (
          <button key={p} onClick={() => preset(p)} className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${from === (p === 'ytd' ? `${new Date().getUTCFullYear()}-01-01` : ymd(new Date(Date.now() - (Number(p) - 1) * DAY))) && to === ymd(new Date()) ? 'bg-green-50 border-green-300 text-[#16A34A]' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {t('rep.preset.' + p)}
          </button>
        ))}
        <span className="text-[11px] text-gray-400 ml-2">{t('rep.from')}</span>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1" />
        <span className="text-[11px] text-gray-400">{t('rep.to')}</span>
        <input type="date" value={to} min={from} max={ymd(new Date())} onChange={e => setTo(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1" />
        <button onClick={() => applyWindow(from, to)} className="text-[11px] px-3 py-1 rounded-lg border border-green-300 text-[#16A34A] font-semibold hover:bg-green-50">{t('rep.apply')}</button>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-2 text-xs bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2">
          <span>{notice}</span><button onClick={() => setNotice('')} className="text-green-600">×</button>
        </div>
      )}
      {source === 'local' && <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 flex items-center gap-1.5"><AlertTriangle size={12} />{t('rep.localNote')}</div>}

      {R && (<>
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KPI icon={TrendingUp} k="rep.kpi.billed" v={money.fmt(R.revenue.total)} sub={t('rep.kpi.across', { n: '4' })} tone="green" />
          <KPI icon={Wallet} k="rep.kpi.cash" v={money.fmt(R.cash.received)} sub={t('rep.kpi.ofBilled', { p: R.revenue.total ? String(Math.round((R.cash.received / R.revenue.total) * 100)) : '0' })} />
          <KPI icon={Coins} k="rep.kpi.ar" v={money.fmt(R.receivables)} sub={t('rep.kpi.arSub')} tone={R.receivables > 0 ? 'red' : undefined} />
          <KPI icon={Landmark} k="rep.kpi.ap" v={money.fmt(R.payables)} sub={t('rep.kpi.apSub')} />
          <KPI icon={Users} k="rep.kpi.payroll" v={money.fmt(R.payroll.monthly)} sub={t('rep.kpi.staff', { n: String(R.payroll.headcount) })} />
          <KPI icon={Package} k="rep.kpi.stock" v={money.fmt(R.inventory.stockValue)} sub={R.inventory.lowStock > 0 ? t('rep.kpi.low', { n: String(R.inventory.lowStock) }) : t('rep.kpi.skus', { n: String(R.inventory.products) })} tone={R.inventory.lowStock > 0 ? 'red' : undefined} />
        </div>

        {/* chart */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h2 className="text-sm font-bold text-gray-800">{t('rep.chart.title', { from: R.window.from, to: R.window.to })}</h2>
            <span className="ml-auto flex items-center gap-3 text-[10px] text-gray-500">
              {(['carwash', 'maintenance', 'rentals', 'sales'] as const).map(k => (
                <span key={k} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: MODULE_COLORS[k] }} />{t('rep.mod.' + k)}</span>
              ))}
            </span>
          </div>
          {chart && (
            <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full" role="img">
              {[0.25, 0.5, 0.75, 1].map(f => (
                <g key={f}>
                  <line x1={chart.PAD} x2={chart.W - chart.PAD} y1={chart.H - chart.PAD - f * (chart.H - chart.PAD * 2)} y2={chart.H - chart.PAD - f * (chart.H - chart.PAD * 2)} stroke="#E5E7EB" strokeWidth="1" strokeDasharray="3 3" />
                  <text x={2} y={chart.H - chart.PAD - f * (chart.H - chart.PAD * 2) + 3} fontSize="8" fill="#9CA3AF">{Math.round((chart.max * f) / 1000)}k</text>
                </g>
              ))}
              {chart.bars.map(({ d, x, segs }) => (
                <g key={d.date}>
                  {segs.map(s => <rect key={s.k} x={x} y={s.y} width={chart.bw} height={s.h} fill={MODULE_COLORS[s.k]} rx="1.5"><title>{`${d.date} · ${t('rep.mod.' + s.k)} ${money.fmt(d[s.k])}`}</title></rect>)}
                  {d.total === 0 && <rect x={x} y={chart.H - chart.PAD - 1.5} width={chart.bw} height={1.5} fill="#E5E7EB"><title>{`${d.date} · —`}</title></rect>}
                  <title>{d.date}</title>
                  {Number(String(d.date).slice(8)) % chart.labelEvery === 0 && (
                    <text x={x + chart.bw / 2} y={chart.H - 8} fontSize="8" fill="#9CA3AF" textAnchor="middle">{String(d.date).slice(5)}</text>
                  )}
                </g>
              ))}
              <line x1={chart.PAD} x2={chart.W - chart.PAD} y1={chart.H - chart.PAD} y2={chart.H - chart.PAD} stroke="#D1D5DB" />
            </svg>
          )}
          <div className="text-[10px] text-gray-400 mt-1">{t('rep.chart.peak', { money: money.fmt(chart ? chart.max : 0) })}</div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* modules table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-2">{t('rep.byModule')}</h2>
            <table className="w-full text-xs">
              <tbody>
                {(['sales', 'rentals', 'maintenance', 'carwash'] as const).map(k => (
                  <tr key={k} className="border-b border-gray-50 last:border-0">
                    <td className="py-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style={{ background: MODULE_COLORS[k] }} />
                      <span className="font-medium text-gray-700">{t('rep.mod.' + k)}</span>
                      <div className="text-[10px] text-gray-400 ml-4">{t('rep.jobs', { n: String(R.revenue[k].count) })}{k === 'rentals' ? ` · EV ${money.fmt(R.revenue.rentals.ev.amount)} / ${money.fmt(R.revenue.rentals.truck.amount)}` : ''}</div>
                    </td>
                    <td className="py-2 text-right font-semibold text-gray-900 whitespace-nowrap">{money.fmt(R.revenue[k].amount)}</td>
                    <td className="py-2 w-28">
                      <div className="h-1.5 rounded bg-gray-100"><div className="h-1.5 rounded" style={{ width: `${share(R.revenue[k].amount)}%`, background: MODULE_COLORS[k] }} /></div>
                      <div className="text-[10px] text-gray-400 text-right">{share(R.revenue[k].amount)}%</div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 font-bold text-gray-800">{t('rep.total')}</td>
                  <td className="py-2 text-right font-bold text-[#16A34A]">{money.fmt(R.revenue.total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {/* cash by method + purchases */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-bold text-gray-800">{t('rep.cashTitle', { money: money.fmt(R.cash.received) })}</h2>
            {Object.keys(R.cash.byMethod).length === 0 && <p className="text-[11px] text-gray-400">{t('rep.noCash')}</p>}
            {Object.entries(R.cash.byMethod).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
              <div key={m} className="flex items-center gap-2 text-xs">
                <span className="w-28 text-gray-600">{t('pay.method.' + m) !== 'pay.method.' + m ? t('pay.method.' + m) : m}</span>
                <div className="flex-1 h-2 rounded bg-gray-100"><div className="h-2 rounded bg-[#16A34A]" style={{ width: `${R.cash.received ? Math.round((v / R.cash.received) * 100) : 0}%` }} /></div>
                <span className="font-semibold text-gray-800 whitespace-nowrap">{money.fmt(v)}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-3 flex items-center gap-2 text-xs text-gray-600">
              <Truck size={13} className="text-gray-400" />
              <span>{t('rep.purchasesLine', { n: String(R.purchases.count), money: money.fmt(R.purchases.amount) })}</span>
            </div>
            <div className="text-[10px] text-gray-400">{t('rep.generated', { at: new Date(R.generatedAt).toLocaleString() })} · {source === 'cloud' ? t('rep.srcServer') : t('rep.srcLocal')}</div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* top products */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-2">{t('rep.topTitle')}</h2>
            {R.topProducts.length === 0 ? <p className="text-[11px] text-gray-400">{t('rep.topEmpty')}</p> : (
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] uppercase text-gray-400 text-left"><th className="py-1 font-medium">#</th><th className="font-medium">{t('rep.col.product')}</th><th className="font-medium text-right">{t('rep.col.qty')}</th><th className="font-medium text-right">{t('rep.col.amount')}</th></tr></thead>
                <tbody>
                  {R.topProducts.map((p, i) => (
                    <tr key={p.name} className="border-b border-gray-50 last:border-0">
                      <td className="py-1.5 text-gray-400">{i + 1}</td>
                      <td className="py-1.5 text-gray-700 font-medium">{p.name}</td>
                      <td className="py-1.5 text-right text-gray-600">{p.qty}</td>
                      <td className="py-1.5 text-right font-semibold text-gray-900 whitespace-nowrap">{money.fmt(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* fleet + rentals utilization */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
            <h2 className="text-sm font-bold text-gray-800">{t('rep.fleetTitle')}</h2>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="text-[10px] uppercase text-gray-400">{t('rep.fleet.owned')}</div>
                <div className="font-bold text-gray-900 text-sm">{R.fleet.total}</div>
                <div className="text-[10px] text-gray-500">{t('rep.fleet.inUse', { n: String(R.fleet.inUse) })}</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="text-[10px] uppercase text-gray-400">{t('rep.fleet.window')}</div>
                <div className="font-bold text-gray-900 text-sm">{t('rep.daysN', { n: String(R.window.days) })}</div>
              </div>
            </div>
            {(['ev', 'truck'] as const).map(c => (
              <div key={c}>
                <div className="flex items-center justify-between text-[11px] text-gray-600 mb-1">
                  <span className="font-medium">{t('rep.util.' + c)}</span>
                  <span className="text-gray-400">{R.utilization[c].occupiedDays}/{R.utilization[c].capacityDays} {t('rep.fleetDays')} · <b className={R.utilization[c].pct >= 40 ? 'text-[#16A34A]' : 'text-gray-600'}>{R.utilization[c].pct}%</b></span>
                </div>
                <div className="h-2 rounded bg-gray-100"><div className="h-2 rounded bg-gradient-to-r from-[#16A34A] to-lime-500" style={{ width: `${R.utilization[c].pct}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </>)}
      {!R && !loading && <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">{t('rep.empty')}</div>}
    </div>
  );
}
