import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, RefreshCw, Cloud, CloudOff, Play, Undo2, Trash2, Pencil,
  Zap, Truck, KeyRound, Fuel, AlertTriangle, CalendarDays,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';

// ---------------------------------------------------------------------------
// Rentals (Phase 11) - one board used by both /ev-rentals and /truck-rentals.
// Units are a server-managed catalogue (cached locally); bookings are fully
// offline-first (TMP-RNT-xxx numbers self-heal to EVR-/TRR- on sync).
// Money lives in BIF; pricing is re-derived server-side - the mirror below is
// display-only and matches backend src/lib/rentalCatalog.ts.
// ---------------------------------------------------------------------------

const DAY = 86400000;
const INSURANCE_PER_DAY = 15000;
const WEEKLY_FACTOR = 0.85;
const TYPE_RATE: Record<string, { rate: number; deposit: number }> = {
  CITY_CAR: { rate: 90000, deposit: 150000 },
  VAN_EV: { rate: 120000, deposit: 200000 },
  TRUCK_EV: { rate: 260000, deposit: 400000 },
  TRUCK_3T: { rate: 150000, deposit: 250000 },
  TRUCK_8T: { rate: 280000, deposit: 500000 },
  TRAILER_HEAD: { rate: 350000, deposit: 600000 },
  BUS_CHARTER: { rate: 420000, deposit: 700000 },
};

function priceLocal(unitType: string | undefined, startISO: string, endISO: string, insurance: boolean) {
  const rate = TYPE_RATE[unitType || 'CITY_CAR']?.rate ?? 0;
  const deposit = TYPE_RATE[unitType || 'CITY_CAR']?.deposit ?? 0;
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  if (!rate || isNaN(s) || isNaN(e) || e < s) return { days: 0, dailyRate: rate, rentAmount: 0, discount: 0, insuranceTotal: 0, deposit, total: 0 };
  const days = Math.floor((e - s) / DAY) + 1; // inclusive window, same as the server
  const weeks = Math.floor(days / 7);
  const rentAmount = Math.round(weeks * 7 * rate * WEEKLY_FACTOR) + (days - weeks * 7) * rate;
  const list = days * rate;
  const insuranceTotal = insurance ? days * INSURANCE_PER_DAY : 0;
  return { days, dailyRate: rate, rentAmount, discount: list - rentAmount, insuranceTotal, deposit, total: rentAmount + insuranceTotal };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

const statusChip = (st: string) => {
  const cls: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
    ACTIVE: 'bg-sky-50 text-sky-700 border-sky-200',
    RETURNED: 'bg-green-50 text-green-700 border-green-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200 line-through',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls[st] || cls.PENDING}`}>{tNow('rental.st.' + st)}</span>;
};

const syncChip = (status?: string) => {
  if (status === 'PENDING') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{tNow('c.pendingSync')}</span>;
  if (status === 'FAILED') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 flex items-center gap-1 w-fit"><AlertTriangle size={10} />{tNow('c.syncFailed')}</span>;
  if (status === 'CONFLICT') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1 w-fit"><AlertTriangle size={10} />{tNow('c.conflict')}</span>;
  return null;
};

interface RentalStats { units: number; unitsTotal: number; maintUnits: number; active: number; pending7: number; dueBack: number; returnedToday: number; revenueToday: number; revenueAll: number }
interface TimelineRow { unitId: string; name: string; plate: string | null; status: string; cells: string[] }

type BForm = { id: string; customerName: string; customerPhone: string; unitId: string; startDate: string; endDate: string; insurance: boolean; notes: string };

export default function RentalsPage({ fleetClass }: { fleetClass: 'EV' | 'TRUCK' }) {
  const { t } = useT();
  const money = useMoney();
  const isEV = fleetClass === 'EV';
  const TitleIcon = isEV ? Zap : Truck;

  const [bookings, setBookings] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<{ start: string; days: number; units: TimelineRow[] } | null>(null);
  const [stats, setStats] = useState<RentalStats>({ units: 0, unitsTotal: 0, maintUnits: 0, active: 0, pending7: 0, dueBack: 0, returnedToday: 0, revenueToday: 0, revenueAll: 0 });
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('ALL');

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<BForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [startTarget, setStartTarget] = useState<any | null>(null);
  const [mileageOut, setMileageOut] = useState('');
  const [startMethod, setStartMethod] = useState('CASH');
  const [returnTarget, setReturnTarget] = useState<any | null>(null);
  const [mileageIn, setMileageIn] = useState('');
  const [level, setLevel] = useState('100');
  const [damage, setDamage] = useState('');
  const [refund, setRefund] = useState(true);

  function emptyForm(): BForm {
    return { id: '', customerName: '', customerPhone: '', unitId: '', startDate: ymd(new Date()), endDate: ymd(new Date(Date.now() + DAY)), insurance: false, notes: '' };
  }

  const load = async () => {
    setLoading(true);
    try {
      const [bs, us] = await Promise.all([
        apiClient.get<{ data: any[] }>(`/rentals/bookings?class=${fleetClass}&limit=200`),
        apiClient.get<{ data: any[] }>(`/rentals/units?class=${fleetClass}`),
      ]);
      for (const b of bs.data) await localDB.rentalBookings.put({ ...b, syncStatus: 'SYNCED', _dirty: false });
      for (const u of us.data) await localDB.rentalUnits.put(u);
      setBookings(bs.data); setUnits(us.data);
      setSource('cloud');
      setNotice(n => (n === t('rental.offline') || n === t('rental.offlineUpdated') ? '' : n));
      try {
        const [tl, st] = await Promise.all([
          apiClient.get<any>(`/rentals/timeline?class=${fleetClass}&days=14`),
          apiClient.get<RentalStats>(`/rentals/stats?class=${fleetClass}`),
        ]);
        setTimeline(tl); setStats(st);
      } catch { /* stats/timeline stay stale - list still fresh */ }
    } catch {
      const [bc, uc] = await Promise.all([localDB.rentalBookings.toArray(), localDB.rentalUnits.toArray()]);
      const cached = bc.filter(b => b.fleetClass === fleetClass && !(b as any).isDeleted).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      setBookings(cached as any); setUnits(uc.filter(u => !(u as any).isDeleted) as any);
      setSource('local');
      const now = Date.now();
      setStats({
        units: uc.filter(u => u.status === 'ACTIVE').length, unitsTotal: uc.length, maintUnits: uc.filter(u => u.status === 'MAINTENANCE').length,
        active: cached.filter(b => b.status === 'ACTIVE').length,
        pending7: cached.filter(b => b.status === 'PENDING' && new Date(b.startDate).getTime() >= now - DAY && new Date(b.startDate).getTime() <= now + 7 * DAY).length,
        dueBack: cached.filter(b => b.status === 'ACTIVE' && new Date(b.endDate).getTime() + DAY <= now).length,
        returnedToday: cached.filter(b => b.status === 'RETURNED' && b.returnedAt && ymd(new Date(b.returnedAt)) === ymd(new Date())).length,
        revenueToday: cached.filter(b => b.status === 'RETURNED' && b.returnedAt && ymd(new Date(b.returnedAt)) === ymd(new Date())).reduce((s, b) => s + (b.totalAmount || 0), 0),
        revenueAll: cached.filter(b => b.status === 'RETURNED' || b.status === 'ACTIVE').reduce((s, b) => s + (b.totalAmount || 0), 0),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = syncEngine.subscribe(() => { load(); });
    return () => { void unsub; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetClass]);

  const queueOffline = async (entityId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', data: any) => {
    await localDB.addToSyncQueue({ entityType: 'RentalBooking', entityId, operation, data, deviceId: getDeviceId() } as any);
  };

  const unitById = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);
  const preview = useMemo(() => priceLocal(unitById.get(form.unitId)?.unitType, form.startDate, form.endDate, form.insurance), [form, unitById]);
  const isWeek = preview.days >= 7;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return bookings.filter(b =>
      (fStatus === 'ALL' || b.status === fStatus) &&
      (!needle || [b.bookingNo, b.customerName, b.unitName, b.unitPlate].some(v => String(v || '').toLowerCase().includes(needle))));
  }, [bookings, q, fStatus]);

  const openCreate = () => {
    const free = units.filter(u => u.status === 'ACTIVE');
    setEditId(null); setForm({ ...emptyForm(), unitId: free[0]?.id || '' }); setFormError(''); setShowForm(true);
  };
  const openEdit = (b: any) => {
    setEditId(b.id);
    setForm({ id: b.id, customerName: b.customerName || '', customerPhone: b.customerPhone || '', unitId: b.unitId, startDate: ymd(new Date(b.startDate)), endDate: ymd(new Date(b.endDate)), insurance: !!b.insurance, notes: b.notes || '' });
    setFormError(''); setShowForm(true);
  };

  const buildPayload = () => ({
    fleetClass, unitId: form.unitId, customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim() || undefined,
    startDate: form.startDate, endDate: form.endDate, insurance: form.insurance, notes: form.notes.trim() || undefined,
  });

  const localRow = (id: string, payload: any, extra: any = {}) => ({
    id, bookingNo: `TMP-RNT-${id.slice(0, 8).toUpperCase()}`, fleetClass,
    unitId: payload.unitId, unitName: unitById.get(payload.unitId)?.name || '', unitPlate: unitById.get(payload.unitId)?.plate || null,
    customerName: payload.customerName, customerPhone: payload.customerPhone || null,
    startDate: payload.startDate, endDate: payload.endDate, status: 'PENDING',
    insurance: !!payload.insurance,
    dailyRate: preview.dailyRate, days: preview.days, rentAmount: preview.rentAmount, discount: preview.discount,
    insuranceTotal: preview.insuranceTotal, depositAmount: preview.deposit, totalAmount: preview.total,
    overtimeFee: 0, paidAmount: 0,
    depositRefunded: false, notes: payload.notes || null,
    version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...extra,
  } as any);

  const saveBooking = async () => {
    if (!form.customerName.trim()) { setFormError(t('rental.valCustomer')); return; }
    if (!form.unitId) { setFormError(t('rental.valUnit')); return; }
    if (new Date(form.endDate) < new Date(form.startDate)) { setFormError(t('rental.valDates')); return; }
    setSaving(true); setFormError('');
    const id = editId || crypto.randomUUID();
    const payload: any = buildPayload();
    const putPath = `/rentals/bookings/${id}`;
    try {
      if (editId) {
        const cur = bookings.find(b => b.id === editId);
        const saved = await apiClient.put<any>(putPath, { ...payload, version: cur?.version || 1 });
        await localDB.rentalBookings.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
        setNotice(t('rental.saved'));
      } else {
        if (unitById.get(payload.unitId)?.status !== 'ACTIVE') { setFormError(t('rental.blockedMaint')); setSaving(false); return; }
        const row = localRow(id, payload); row.syncStatus = 'PENDING'; row._dirty = true;
        await localDB.rentalBookings.put(row);
        await queueOffline(id, 'CREATE', { id, ...payload });
        const saved = await apiClient.post<any>('/rentals/bookings', { id, ...payload });
        await localDB.rentalBookings.put({ ...row, ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
        const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.status === 'PENDING').toArray();
        await localDB.syncQueue.bulkDelete(queued.map(x => x.id));
        setNotice(t('rental.created'));
      }
      setShowForm(false); setEditId(null); setForm(emptyForm());
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        const row = localRow(id, payload); row.syncStatus = 'PENDING'; row._dirty = true;
        await localDB.rentalBookings.put(row);
        await queueOffline(id, editId ? 'UPDATE' : 'CREATE', { id, ...payload, version: bookings.find(b => b.id === editId)?.version });
        setNotice(t('rental.offline'));
        setShowForm(false); setEditId(null);
        await syncEngine.sync().catch(() => undefined);
      } else {
        setFormError(msg.replace(/^Request failed.*?:\s*/, ''));
      }
    } finally {
      setSaving(false);
      load();
    }
  };

  const doTransition = async (b: any, patch: any, okKey: string) => {
    try {
      const saved = await apiClient.put<any>(`/rentals/bookings/${b.id}`, { ...patch, version: b.version });
      await localDB.rentalBookings.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      setNotice(t(okKey));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.rentalBookings.update(b.id, { ...patch, syncStatus: 'PENDING', _dirty: true, updatedAt: new Date().toISOString() } as any);
        await queueOffline(b.id, 'UPDATE', { id: b.id, ...patch, version: b.version });
        setNotice(t('rental.offlineUpdated'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      setStartTarget(null); setReturnTarget(null);
      load();
    }
  };

  const startRental = () => {
    if (!startTarget) return;
    doTransition(startTarget, {
      status: 'ACTIVE', paymentMethod: startMethod,
      ...(mileageOut.trim() ? { mileageOut: Math.max(0, Math.round(Number(mileageOut))) } : {}),
    }, 'rental.started');
  };

  const returnRental = () => {
    if (!returnTarget) return;
    doTransition(returnTarget, {
      status: 'RETURNED', refundDeposit: refund,
      ...(mileageIn.trim() ? { mileageReturn: Math.max(0, Math.round(Number(mileageIn))) } : {}),
      ...(level.trim() !== '' ? { returnLevel: Math.min(100, Math.max(0, Math.round(Number(level)))) } : {}),
      ...(damage.trim() ? { damageNotes: damage.trim() } : {}),
    }, 'rental.returned');
  };

  const cancelBooking = async (b: any) => {
    if (!window.confirm(t('rental.cancelConfirm', { no: b.bookingNo }))) return;
    try {
      await apiClient.delete(`/rentals/bookings/${b.id}`);
      await localDB.rentalBookings.delete(b.id);
      setNotice(t('rental.cancelled', { no: b.bookingNo }));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.rentalBookings.update(b.id, { status: 'CANCELLED', syncStatus: 'PENDING', _dirty: true } as any);
        await queueOffline(b.id, 'DELETE', { id: b.id });
        setNotice(t('rental.offlineUpdated'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      load();
    }
  };

  // timeline date headers
  const dayHeaders = useMemo(() => {
    if (!timeline) return [];
    const base = new Date(timeline.start).getTime();
    return Array.from({ length: timeline.days }, (_, i) => new Date(base + i * DAY));
  }, [timeline]);

  const cellCls: Record<string, string> = {
    free: 'bg-green-50 hover:bg-green-100',
    pending: 'bg-amber-200 hover:bg-amber-300',
    active: 'bg-sky-400 hover:bg-sky-500',
    maint: 'bg-gray-300 hover:bg-gray-400',
  };

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm ${isEV ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-slate-600 to-[#16A34A]'}`}>
          <TitleIcon size={20} />
        </div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-bold text-gray-900">{t(isEV ? 'nav.evRentals' : 'nav.truckRentals')}</h1>
          <p className="text-xs text-gray-500">{t(isEV ? 'rental.sub.ev' : 'rental.sub.truck')}</p>
        </div>
        <span className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium ${source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
          {source === 'cloud' ? <Cloud size={12} /> : <CloudOff size={12} />}{t(source === 'cloud' ? 'c.cloudCache' : 'c.offlineData')}
        </span>
        <button onClick={() => syncEngine.sync()} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-green-200 text-[#16A34A] font-medium hover:bg-green-50">
          <RefreshCw size={13} />{t('c.syncNow')}
        </button>
        <button onClick={openCreate} className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-[#16A34A] text-white font-semibold hover:bg-[#128a3e] shadow-sm">
          <Plus size={14} />{t('rental.new')}
        </button>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-2 text-xs bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-green-600 hover:text-green-800"><X size={13} /></button>
        </div>
      )}

      {/* stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { k: 'rental.stat.units', v: `${stats.units}/${stats.unitsTotal}`, sub: stats.maintUnits > 0 ? t('rental.stat.maintN', { n: stats.maintUnits }) : undefined },
          { k: 'rental.stat.active', v: String(stats.active) },
          { k: 'rental.stat.pending7', v: String(stats.pending7) },
          { k: 'rental.stat.dueBack', v: String(stats.dueBack), warn: stats.dueBack > 0 },
          { k: 'rental.stat.returnedToday', v: String(stats.returnedToday) },
          { k: 'rental.stat.revenueToday', v: money.fmt(stats.revenueToday), money: true },
        ].map((c, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{t(c.k)}</div>
            <div className={`text-lg font-bold mt-0.5 ${c.warn ? 'text-red-600' : c.money ? 'text-[#16A34A]' : 'text-gray-900'}`}>{c.v}</div>
            {c.sub && <div className="text-[11px] text-gray-500">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* timeline */}
      {timeline && timeline.units.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <div className="px-4 pt-3 pb-1 flex items-center gap-2 text-xs font-semibold text-gray-700">
            <CalendarDays size={14} className="text-[#16A34A]" />{t('rental.timeline')}
            <span className="font-normal text-gray-400">· {t('rental.timelineHint')}</span>
            <span className="ml-auto flex items-center gap-3 font-normal text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400 inline-block" />{t('rental.leg.active')}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-200 inline-block" />{t('rental.leg.pending')}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-50 border border-green-200 inline-block" />{t('rental.leg.free')}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300 inline-block" />{t('rental.leg.maint')}</span>
            </span>
          </div>
          <table className="w-full text-[11px] border-collapse min-w-[760px]">
            <thead>
              <tr>
                <th className="text-left font-medium text-gray-400 px-4 py-1.5 sticky left-0 bg-white min-w-[170px]">{t('rental.col.unit')}</th>
                {dayHeaders.map((d, i) => (
                  <th key={i} className={`px-0.5 py-1.5 text-center font-normal w-7 ${i === 0 ? 'text-[#16A34A] font-semibold' : 'text-gray-400'}`}>{d.getUTCDate()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeline.units.map(u => (
                <tr key={u.unitId} className="border-t border-gray-100">
                  <td className="px-4 py-1.5 sticky left-0 bg-white">
                    <div className="font-medium text-gray-800 leading-tight">{u.name}</div>
                    <div className="text-[10px] text-gray-400">{u.plate || '—'}</div>
                  </td>
                  {u.cells.map((c, i) => (
                    <td key={i} className="p-0.5">
                      <div className={`h-5 rounded-sm ${cellCls[c] || cellCls.free}`} title={`${ymd(dayHeaders[i])} · ${t('rental.leg.' + c)}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('rental.searchPh')} className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 w-56 focus:outline-none focus:ring-2 focus:ring-green-200" />
        </div>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="text-xs py-1.5 px-2 rounded-lg border border-gray-200 bg-white">
          {['ALL', 'PENDING', 'ACTIVE', 'RETURNED'].map(s => <option key={s} value={s}>{s === 'ALL' ? t('rental.allStatuses') : t('rental.st.' + s)}</option>)}
        </select>
        <span className="text-[11px] text-gray-400 ml-auto">{t('rental.rowsShown', { n: visible.length })}{loading ? ' · …' : ''}</span>
      </div>

      {/* bookings table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              {[t('rental.col.booking'), t('rental.col.unit'), t('rental.col.customer'), t('rental.col.window'), t('rental.col.days'), t('rental.col.total'), t('rental.col.status'), t('rental.col.actions')].map((h, i) => (
                <th key={i} className={`px-4 py-2.5 font-medium ${i === 7 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{t('rental.empty')}</td></tr>
            )}
            {visible.map(b => {
              const late = b.status === 'ACTIVE' && new Date(b.endDate).getTime() + DAY <= Date.now();
              return (
                <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50/60 align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-mono font-semibold text-gray-800">{b.bookingNo}</div>
                    {b.syncStatus && b.syncStatus !== 'SYNCED' ? syncChip(b.syncStatus) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-800">{b.unitName}</div>
                    <div className="text-[10px] text-gray-400">{b.unitPlate || '—'}{b.overtimeFee ? ` · ${t('rental.overtimePaid', { money: money.fmt(b.overtimeFee) })}` : ''}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-gray-800">{b.customerName}</div>
                    {b.customerPhone && <div className="text-[10px] text-gray-400">{b.customerPhone}</div>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={late ? 'text-red-600 font-semibold' : 'text-gray-700'}>{ymd(new Date(b.startDate))} → {ymd(new Date(b.endDate))}</span>
                    {late && <div className="text-[10px] text-red-500">{t('rental.overdue')}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{b.days}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-gray-900 whitespace-nowrap">{money.fmt(b.totalAmount)}</div>
                    <div className="text-[10px] text-gray-400 whitespace-nowrap">
                      {b.discount > 0 && <span className="text-green-700">−{money.fmt(b.discount)} </span>}
                      {b.insuranceTotal > 0 && <span>{t('rental.insBadge', { money: money.fmt(b.insuranceTotal) })} </span>}
                      {b.status !== 'PENDING' ? (b.paidAmount >= b.totalAmount ? t('rental.paidFull') : `${t('rental.paidPart')} ${money.fmt(b.paidAmount)}`) : t('rental.depHeld', { money: money.fmt(b.depositAmount) })}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">{statusChip(b.status)}{b.status === 'RETURNED' && b.depositRefunded ? <div className="text-[10px] text-gray-400 mt-0.5">{t('rental.depositBack')}</div> : null}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {b.status === 'PENDING' && (
                        <>
                          <button title={t('rental.doStart')} onClick={() => { setStartTarget(b); setMileageOut(String(unitById.get(b.unitId)?.odometerKm ?? '')); setStartMethod(b.paymentMethod || 'CASH'); }} className="p-1.5 rounded-lg border border-green-200 text-[#16A34A] hover:bg-green-50"><Play size={13} /></button>
                          <button title={t('rental.edit')} onClick={() => openEdit(b)} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><Pencil size={13} /></button>
                          <button title={t('rental.cancel')} onClick={() => cancelBooking(b)} className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                        </>
                      )}
                      {b.status === 'ACTIVE' && (
                        <button title={t('rental.doReturn')} onClick={() => { setReturnTarget(b); setMileageIn(String(unitById.get(b.unitId)?.odometerKm ?? '')); setLevel('100'); setDamage(''); setRefund(true); }} className="px-2 py-1 rounded-lg bg-[#16A34A] text-white text-[11px] font-semibold hover:bg-[#128a3e] flex items-center gap-1"><Undo2 size={12} />{t('rental.doReturn')}</button>
                      )}
                      {b.status === 'RETURNED' && <span className="text-[11px] text-gray-400">{money.fmt(b.paidAmount)} ✓</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* booking modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm">{editId ? t('rental.editTitle') : t('rental.newTitle')}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            {formError && <div className="text-[11px] bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-[11px] font-medium text-gray-500">{t('rental.f.customer')}
                <input value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-200" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('rental.f.phone')}
                <input value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('rental.f.unit')}
                <select value={form.unitId} onChange={e => setForm({ ...form, unitId: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
                  <option value="">—</option>
                  {units.map(u => <option key={u.id} value={u.id} disabled={u.status !== 'ACTIVE' && !editId}>{u.name} · {u.plate}{u.status !== 'ACTIVE' ? ` (${t('rental.unitMaintShort')})` : ''}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('rental.f.start')}
                <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('rental.f.end')}
                <input type="date" value={form.endDate} min={form.startDate} onChange={e => setForm({ ...form, endDate: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-[11px] text-gray-600 font-normal">
                <input type="checkbox" checked={form.insurance} onChange={e => setForm({ ...form, insurance: e.target.checked })} className="accent-[#16A34A]" />
                {t('rental.f.insurance', { money: money.fmt(INSURANCE_PER_DAY) })}
              </label>
              <label className="col-span-2 text-[11px] font-medium text-gray-500">{t('rental.f.notes')}
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50/50 px-3 py-2.5 text-[11px] space-y-1">
              <div className="flex justify-between text-gray-600"><span>{t('rental.pv.rate')}</span><span>{money.fmt(preview.dailyRate)} / {t('rental.perDay')}</span></div>
              <div className="flex justify-between text-gray-600"><span>{t('rental.pv.days', { n: preview.days })}</span><span>{money.fmt(preview.days * preview.dailyRate)}</span></div>
              {isWeek && <div className="flex justify-between text-green-700 font-medium"><span>{t('rental.pv.weeks', { n: Math.floor(preview.days / 7) })}</span><span>−{money.fmt(preview.discount)}</span></div>}
              {form.insurance && <div className="flex justify-between text-gray-600"><span>{t('rental.pv.insurance')}</span><span>+{money.fmt(preview.insuranceTotal)}</span></div>}
              <div className="flex justify-between font-bold text-gray-900 border-t border-green-200 pt-1.5 mt-1"><span>{t('rental.pv.total')}</span><span>{money.fmt(preview.total)}</span></div>
              <div className="flex justify-between text-gray-500"><span>{t('rental.pv.deposit')}</span><span>{money.fmt(preview.deposit)}</span></div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowForm(false)} className="text-xs px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={saveBooking} disabled={saving || !preview.days} className="text-xs px-4 py-2 rounded-lg bg-[#16A34A] text-white font-semibold hover:bg-[#128a3e] disabled:opacity-50">{saving ? t('c.saving') : t('c.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* start modal */}
      {startTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setStartTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center gap-2 font-bold text-sm text-gray-900"><KeyRound size={15} className="text-[#16A34A]" />{t('rental.startTitle', { no: startTarget.bookingNo })}</div>
            <div className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              {startTarget.unitName} · {startTarget.customerName} — {t('rental.startDue', { money: money.fmt(startTarget.totalAmount) })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] font-medium text-gray-500">{t('rental.f.mileageOut')}
                <input type="number" min={0} value={mileageOut} onChange={e => setMileageOut(e.target.value)} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('rental.f.payMethod')}
                <select value={startMethod} onChange={e => setStartMethod(e.target.value)} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
                  {['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'].map(m => <option key={m} value={m}>{t('pay.method.' + m)}</option>)}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setStartTarget(null)} className="text-xs px-3 py-2 rounded-lg border border-gray-200 text-gray-600">{t('c.cancel')}</button>
              <button onClick={startRental} className="text-xs px-4 py-2 rounded-lg bg-[#16A34A] text-white font-semibold hover:bg-[#128a3e]">{t('rental.doStart')}</button>
            </div>
          </div>
        </div>
      )}

      {/* return modal */}
      {returnTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setReturnTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center gap-2 font-bold text-sm text-gray-900"><Fuel size={15} className="text-[#16A34A]" />{t('rental.returnTitle', { no: returnTarget.bookingNo })}</div>
            <div className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{t('rental.returnLate')}</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] font-medium text-gray-500">{t('rental.f.mileageIn')}
                <input type="number" min={0} value={mileageIn} onChange={e => setMileageIn(e.target.value)} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t(isEV ? 'rental.f.charge' : 'rental.f.fuel')}
                <input type="number" min={0} max={100} value={level} onChange={e => setLevel(e.target.value)} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="col-span-2 text-[11px] font-medium text-gray-500">{t('rental.f.damage')}
                <textarea value={damage} onChange={e => setDamage(e.target.value)} rows={2} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-[11px] text-gray-600 font-normal">
                <input type="checkbox" checked={refund} onChange={e => setRefund(e.target.checked)} className="accent-[#16A34A]" />
                {t('rental.f.refund', { money: money.fmt(returnTarget.depositAmount) })}
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setReturnTarget(null)} className="text-xs px-3 py-2 rounded-lg border border-gray-200 text-gray-600">{t('c.cancel')}</button>
              <button onClick={returnRental} className="text-xs px-4 py-2 rounded-lg bg-[#16A34A] text-white font-semibold hover:bg-[#128a3e]">{t('rental.doReturnSave')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
