import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, RefreshCw, Cloud, CloudOff, Play, CheckCircle2, Trash2,
  Clock, CheckCircle, AlertTriangle, Droplets,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';
import type { WashOrder } from '../types';

const SERVICES = ['EXPRESS', 'CLASSIC', 'PREMIUM', 'INTERIOR', 'ENGINE', 'FULL', 'WAX'] as const;
const VEHICLES = ['SEDAN', 'SUV', 'VAN', 'PICKUP', 'TRUCK', 'BUS'] as const;
const METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;
// Mirrors backend src/lib/washCatalog.ts (BIF)
const BASE: Record<string, number> = { EXPRESS: 5000, CLASSIC: 10000, PREMIUM: 18000, INTERIOR: 12000, ENGINE: 15000, FULL: 25000, WAX: 20000 };
const MULT: Record<string, number> = { SEDAN: 1.0, SUV: 1.25, VAN: 1.3, PICKUP: 1.2, TRUCK: 1.6, BUS: 2.0 };

function catalogPrice(service: string, vehicle: string, discountBif = 0) {
  const gross = Math.round(((BASE[service] ?? 10000) * (MULT[vehicle] ?? 1)) / 100) * 100;
  const disc = Math.min(Math.max(0, Math.round(discountBif)), gross);
  return { gross, discount: disc, total: gross - disc };
}

const statusChip = (st: string) => {
  const cls: Record<string, string> = {
    WAITING: 'bg-amber-50 text-amber-700 border-amber-200',
    IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200',
    COMPLETED: 'bg-green-50 text-green-700 border-green-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200 line-through',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls[st] || cls.WAITING}`}>{tNow('wash.status.' + st)}</span>;
};

const syncChip = (status?: string) => {
  switch (status) {
    case 'PENDING':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow-50 text-yellow-700 border border-yellow-200"><Clock className="w-3 h-3" /> {tNow('c.pendingSync')}</span>;
    case 'FAILED':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200"><AlertTriangle className="w-3 h-3" /> {tNow('c.syncFailed')}</span>;
    case 'CONFLICT':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200"><AlertTriangle className="w-3 h-3" /> {tNow('c.conflict')}</span>;
    default:
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700 border border-green-200"><CheckCircle className="w-3 h-3" /> {tNow('c.synced')}</span>;
  }
};

type WForm = {
  customerName: string; customerPhone: string; vehiclePlate: string; vehicleType: string;
  serviceType: string; bay: string; washerName: string; discount: string; notes: string;
};
const emptyForm = (): WForm => ({ customerName: '', customerPhone: '', vehiclePlate: '', vehicleType: 'SEDAN', serviceType: 'CLASSIC', bay: '1', washerName: '', discount: '', notes: '' });

export default function CarWashPage() {
  const { t } = useT();
  const { fmt: fmtMoney, toBif, toDisplay, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission('carwash:manage');

  const [orders, setOrders] = useState<WashOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stats, setStats] = useState({ total: 0, waiting: 0, active: 0, completedToday: 0, revenueToday: 0, revenueAll: 0 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [completeTarget, setCompleteTarget] = useState<WashOrder | null>(null);
  const [payMethod, setPayMethod] = useState('CASH');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: WashOrder[]; pagination: any }>('/carwash?limit=200');
      for (const w of res.data) await localDB.washOrders.put({ ...w, syncStatus: 'SYNCED', _dirty: false } as any);
      setOrders(res.data);
      setSource('cloud');
      setNotice(n => (n === t('wash.offline') || n === t('wash.offlineUpdated') ? '' : n));
      try {
        const st = await apiClient.get<any>('/carwash/stats');
        setStats(st);
      } catch { /* keep */ }
    } catch {
      const cached = await localDB.washOrders.toArray();
      setOrders(cached as any);
      setSource('local');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = syncEngine.subscribe(() => { load(); });
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(w => {
      if (statusFilter && w.status !== statusFilter) return false;
      if (!q) return true;
      return (w.orderNo || '').toLowerCase().includes(q) ||
        (w.vehiclePlate || '').toLowerCase().includes(q) ||
        (w.customerName || '').toLowerCase().includes(q) ||
        (w.washerName || '').toLowerCase().includes(q);
    });
  }, [orders, search, statusFilter]);

  const preview = catalogPrice(form.serviceType, form.vehicleType, toBif(parseFloat(form.discount || '0') || 0));

  const field = (key: keyof WForm) => ({
    value: (form as any)[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const queueOffline = async (entityId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', data: any) => {
    await localDB.addToSyncQueue({ entityType: 'CarWashOrder', entityId, operation, data, deviceId: getDeviceId() } as any);
  };

  const createOrder = async () => {
    if (!form.vehiclePlate.trim()) { setFormError(t('wash.valPlate')); return; }
    setSaving(true); setFormError('');
    const id = crypto.randomUUID();
    const price = catalogPrice(form.serviceType, form.vehicleType, toBif(parseFloat(form.discount || '0') || 0));
    const payload: any = {
      id,
      customerName: form.customerName.trim() || null,
      customerPhone: form.customerPhone.trim() || null,
      vehiclePlate: form.vehiclePlate.trim().toUpperCase(),
      vehicleType: form.vehicleType,
      serviceType: form.serviceType,
      discount: price.discount,
      bay: parseInt(form.bay) || 1,
      washerName: form.washerName.trim() || null,
      notes: form.notes.trim() || null,
      status: 'WAITING',
      deviceId: getDeviceId(),
    };
    const localRow: any = {
      ...payload,
      orderNo: `TMP-WSH-${id.slice(0, 8).toUpperCase()}`,
      basePrice: BASE[form.serviceType], surcharge: price.gross - (BASE[form.serviceType] ?? 0),
      totalAmount: price.total, paidAmount: 0, paymentMethod: null,
      startedAt: null, completedAt: null,
      version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING', _dirty: true,
    };
    await localDB.washOrders.put(localRow);
    await queueOffline(id, 'CREATE', payload);
    try {
      const saved = await apiClient.post<WashOrder>('/carwash', payload);
      await localDB.washOrders.put({ ...localRow, ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.status === 'PENDING').toArray();
      await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
      setNotice(t('wash.created'));
      setShowForm(false);
      setForm(emptyForm());
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('wash.offline'));
        setShowForm(false);
        await syncEngine.sync().catch(() => undefined);
      } else {
        setFormError(msg);
      }
    } finally {
      setSaving(false);
      load();
    }
  };

  const transition = async (w: WashOrder, status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED', extra: any = {}) => {
    const payload: any = { status, version: w.version, ...extra };
    try {
      const saved = await apiClient.put<WashOrder>(`/carwash/${w.id}`, payload);
      await localDB.washOrders.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        const localPatch: any = { ...payload, syncStatus: 'PENDING', _dirty: true, updatedAt: new Date().toISOString() };
        if (status === 'COMPLETED') { localPatch.completedAt = new Date().toISOString(); localPatch.paidAmount = w.totalAmount; }
        if (status === 'IN_PROGRESS') localPatch.startedAt = new Date().toISOString();
        await localDB.washOrders.update(w.id, localPatch);
        await queueOffline(w.id, 'UPDATE', { id: w.id, ...payload });
        setNotice(t('wash.offlineUpdated'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      load();
    }
  };

  const removeOrder = async (w: WashOrder) => {
    if (!window.confirm(t('wash.removeConfirm', { no: w.orderNo }))) return;
    try {
      await apiClient.delete(`/carwash/${w.id}`);
      await localDB.washOrders.delete(w.id);
      setNotice(t('wash.removed'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.washOrders.update(w.id, { status: 'CANCELLED', syncStatus: 'PENDING', _dirty: true } as any);
        await queueOffline(w.id, 'DELETE', { id: w.id });
        setNotice(t('wash.offlineUpdated'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      load();
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#16A34A]/30 focus:border-[#16A34A] bg-white';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('wash.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('wash.sub')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${
            source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
          }`}>
            {source === 'cloud' ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
            {source === 'cloud' ? t('c.cloudCache') : t('c.offlineData')}
          </span>
          <button onClick={load} className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors" title={t('c.reload')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canManage && (
            <button onClick={() => { setForm(emptyForm()); setFormError(''); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t('wash.new')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('wash.statsToday')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{stats.completedToday}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><Droplets className="w-3.5 h-3.5" /> {t('wash.statsRevenue')}</div>
          <div className="text-lg font-bold text-green-600 mt-1">{fmtMoney(stats.revenueToday)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('wash.statsWaiting')}</div>
          <div className="text-lg font-bold text-amber-600 mt-1">{stats.waiting}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('wash.statsActive')}</div>
          <div className="text-lg font-bold text-sky-600 mt-1">{stats.active}</div>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-400 hover:text-blue-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('wash.searchPh')} className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(st => (
            <button key={st || 'all'} onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === st ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {st === '' ? t('po.all') : t('wash.status.' + st)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('wash.colOrder')}</th>
                <th className="px-4 py-3 font-medium">{t('wash.colCustomer')}</th>
                <th className="px-4 py-3 font-medium">{t('wash.colVehicle')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('wash.colService')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('wash.colBay')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('wash.colPrice')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('wash.colPaid')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                {canManage && <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">{t('wash.nOrders', { n: 0 })}</td></tr>
              )}
              {filtered.map(w => (
                <tr key={w.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-gray-900 text-[13px]">{w.orderNo}</div>
                    <div className="mt-0.5">{statusChip(w.status)}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {w.customerName || '—'}
                    {w.customerPhone && <div className="text-xs text-gray-400">{w.customerPhone}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-gray-800 text-[13px]">{w.vehiclePlate}</div>
                    <div className="text-xs text-gray-400">{t('wash.vt.' + w.vehicleType)}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                    {t('wash.svc.' + w.serviceType)}
                    {w.washerName && <div className="text-xs text-gray-400">{w.washerName}</div>}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-gray-700">{w.bay}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-semibold text-gray-900">{fmtMoney(w.totalAmount)}</div>
                    {w.discount > 0 && <div className="text-[11px] text-green-600 line-through">{fmtMoney(w.totalAmount + w.discount)}</div>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-600">
                    {w.status === 'COMPLETED' ? (w.paymentMethod ? t('pay.method.' + w.paymentMethod) : t('wash.colPaid')) : w.paidAmount > 0 ? fmtMoney(w.paidAmount) : '—'}
                  </td>
                  <td className="px-4 py-3">{syncChip((w as any).syncStatus || 'SYNCED')}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {w.status === 'WAITING' && (
                          <button onClick={() => transition(w, 'IN_PROGRESS')} className="p-2 rounded-lg hover:bg-sky-50 text-gray-500 hover:text-sky-600" title={t('wash.start')}>
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {(w.status === 'WAITING' || w.status === 'IN_PROGRESS') && (
                          <button onClick={() => { setCompleteTarget(w); setPayMethod('CASH'); }} className="p-2 rounded-lg hover:bg-green-50 text-gray-500 hover:text-green-600" title={t('wash.complete')}>
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        {w.status !== 'COMPLETED' && (
                          <button onClick={() => removeOrder(w)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('wash.remove')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
          <span>{t('wash.nOrders', { n: filtered.length })} · {t('wash.statsAll')} {fmtMoney(stats.revenueAll)}{source === 'local' ? ' ' + t('sale.localNote') : ''}</span>
          <button onClick={() => syncEngine.sync()} className="flex items-center gap-1 text-[#16A34A] font-medium hover:underline">
            <RefreshCw className="w-3 h-3" /> {t('c.syncNow')}
          </button>
        </div>
      </div>

      {/* Create modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">{t('wash.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.plate')}</label>
                  <input className={inputCls} {...field('vehiclePlate')} placeholder="1AB-2345" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.customer')}</label>
                  <input className={inputCls} {...field('customerName')} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.phone')}</label>
                  <input className={inputCls} {...field('customerPhone')} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.vehicleType')}</label>
                  <select className={inputCls} {...field('vehicleType')}>
                    {VEHICLES.map(v => <option key={v} value={v}>{t('wash.vt.' + v)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.service')}</label>
                  <select className={inputCls} {...field('serviceType')}>
                    {SERVICES.map(sv => <option key={sv} value={sv}>{t('wash.svc.' + sv)} · {fmtMoney(BASE[sv])}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.bay')}</label>
                    <select className={inputCls} {...field('bay')}>
                      {[1, 2, 3, 4, 5, 6].map(b => <option key={b} value={String(b)}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.washer')}</label>
                    <input className={inputCls} {...field('washerName')} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.discount', { cur: curLabel })}</label>
                  <input className={inputCls} type="number" min="0" step="any" {...field('discount')} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('c.notes')}</label>
                <textarea className={inputCls} rows={2} {...field('notes')} />
              </div>
              <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-sm">
                <span className="text-gray-600">{t('wash.preview')}</span>
                <span className="font-bold text-gray-900">
                  {preview.discount > 0 && <span className="mr-2 text-gray-400 line-through font-normal">{fmtMoney(preview.gross)}</span>}
                  {fmtMoney(preview.total)}
                </span>
              </div>
              {formError && <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={createOrder} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">
                {saving ? t('c.saving') : t('wash.new')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete modal */}
      {completeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCompleteTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{t('wash.complete')} · {completeTarget.orderNo}</h2>
              <button onClick={() => setCompleteTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">{t('wash.colPrice')}</span>
              <span className="font-bold">{fmtMoney(completeTarget.totalAmount)}</span>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">{t('wash.payMethod')}</label>
              <select className={inputCls} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                {METHODS.map(m => <option key={m} value={m}>{t('pay.method.' + m)}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1.5">{t('wash.paidFull')}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCompleteTarget(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button
                onClick={async () => {
                  const target = completeTarget;
                  setCompleteTarget(null);
                  await transition(target, 'COMPLETED', { paymentMethod: payMethod });
                }}
                className="px-5 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
              >
                {t('wash.complete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
