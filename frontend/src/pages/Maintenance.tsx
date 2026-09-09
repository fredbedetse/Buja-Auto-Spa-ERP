import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, RefreshCw, Cloud, CloudOff, Play, CheckCircle2, Trash2, Pencil,
  Clock, CheckCircle, AlertTriangle, Wrench, Package,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';
import type { MaintenanceOrder, MaintPartLine, Product, Vehicle } from '../types';

const SERVICES = ['OIL', 'FULL', 'BRAKES', 'TIRES', 'DIAG', 'AC', 'COOLANT', 'BELT'] as const;
const PRIORITIES = ['NORMAL', 'URGENT'] as const;
const METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;
// Mirrors backend src/lib/maintCatalog.ts (BIF; labor = hours x 20,000/h, rounded to 100)
const LABOR: Record<string, number> = { OIL: 20000, FULL: 80000, BRAKES: 40000, TIRES: 30000, DIAG: 20000, AC: 50000, COOLANT: 25000, BELT: 120000 };

function catalogPriceMaint(service: string, partsBif = 0, discountBif = 0) {
  const labor = LABOR[service] ?? 20000;
  const parts = Math.max(0, Math.round(partsBif));
  const gross = labor + parts;
  const disc = Math.min(Math.max(0, Math.round(discountBif)), gross);
  return { labor, parts, gross, discount: disc, total: gross - disc };
}

const statusChip = (st: string) => {
  const cls: Record<string, string> = {
    WAITING: 'bg-amber-50 text-amber-700 border-amber-200',
    IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200',
    COMPLETED: 'bg-green-50 text-green-700 border-green-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200 line-through',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls[st] || cls.WAITING}`}>{tNow('maint.status.' + st)}</span>;
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

type MForm = {
  vehiclePlate: string; customerName: string; customerPhone: string; serviceType: string;
  priority: string; scheduledFor: string; mechanicName: string; discount: string; notes: string; findings: string;
};
const emptyForm = (): MForm => ({
  vehiclePlate: '', customerName: '', customerPhone: '', serviceType: 'OIL', priority: 'NORMAL',
  scheduledFor: '', mechanicName: '', discount: '', notes: '', findings: '',
});

type EditLine = { productId: string; sku: string; name: string; qty: number; stock: number; unitPrice: number };

export default function MaintenancePage() {
  const { t } = useT();
  const { fmt: fmtMoney, toBif, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission('maintenance:manage');

  const [orders, setOrders] = useState<MaintenanceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stats, setStats] = useState({ total: 0, waiting: 0, active: 0, urgent: 0, overdue: 0, dueSoon: 0, completedToday: 0, revenueToday: 0, revenueAll: 0 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<MForm>(emptyForm());
  const [editTarget, setEditTarget] = useState<MaintenanceOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  const [pickProduct, setPickProduct] = useState('');
  const [pickQty, setPickQty] = useState('1');
  const [lines, setLines] = useState<EditLine[]>([]);

  const [completeTarget, setCompleteTarget] = useState<MaintenanceOrder | null>(null);
  const [payMethod, setPayMethod] = useState('CASH');
  const [findingsDraft, setFindingsDraft] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: MaintenanceOrder[]; pagination: any }>('/maintenance?limit=200');
      for (const m of res.data) await localDB.maintenanceOrders.put({ ...m, syncStatus: 'SYNCED', _dirty: false } as any);
      setOrders(res.data);
      setSource('cloud');
      setNotice(n => (n === t('maint.offline') || n === t('maint.offlineUpdated') ? '' : n));
      try {
        const st = await apiClient.get<any>('/maintenance/stats');
        setStats(st);
      } catch { /* keep */ }
    } catch {
      const cached = await localDB.maintenanceOrders.toArray();
      setOrders(cached as any);
      setSource('local');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    (async () => {
      // prime picker data: server first (fresh devices have an empty Dexie), local as fallback
      try {
        const pr = await apiClient.get<{ data: any[] }>('/inventory?limit=200');
        for (const p of pr.data) await localDB.inventory.put({ ...p, syncStatus: 'SYNCED', _dirty: false } as any);
      } catch { /* offline - keep local cache */ }
      try {
        const vr = await apiClient.get<{ data: any[] }>('/vehicles?limit=100');
        for (const v of vr.data) await localDB.vehicles.put({ ...v, syncStatus: 'SYNCED', _dirty: false } as any);
      } catch { /* offline */ }
      const p = await localDB.inventory.toArray();
      setProducts(p.filter(x => x.isActive && !(x as any).isDeleted) as any);
      const v = await localDB.vehicles.toArray();
      setFleet(v.filter(x => (x as any).isActive !== false && !(x as any).isDeleted && x.status !== 'RETIRED') as any);
    })();
    const unsub = syncEngine.subscribe(() => { load(); });
    return () => { unsub; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(m => {
      if (statusFilter && m.status !== statusFilter) return false;
      if (!q) return true;
      return (m.orderNo || '').toLowerCase().includes(q) ||
        (m.vehiclePlate || '').toLowerCase().includes(q) ||
        (m.customerName || '').toLowerCase().includes(q) ||
        (m.mechanicName || '').toLowerCase().includes(q);
    });
  }, [orders, search, statusFilter]);

  const partsBif = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const preview = catalogPriceMaint(form.serviceType, partsBif, toBif(parseFloat(form.discount || '0') || 0));

  const field = (key: keyof MForm) => ({
    value: (form as any)[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const queueOffline = async (entityId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', data: any) => {
    await localDB.addToSyncQueue({ entityType: 'MaintenanceOrder', entityId, operation, data, deviceId: getDeviceId() } as any);
  };

  const openCreate = () => {
    setEditTarget(null); setForm(emptyForm()); setLines([]); setPickProduct(''); setPickQty('1'); setFormError(''); setShowForm(true);
  };

  const openEdit = async (m: MaintenanceOrder) => {
    setEditTarget(m);
    setForm({
      vehiclePlate: m.vehiclePlate, customerName: m.customerName || '', customerPhone: m.customerPhone || '',
      serviceType: m.serviceType, priority: m.priority, scheduledFor: m.scheduledFor ? String(m.scheduledFor).slice(0, 10) : '',
      mechanicName: m.mechanicName || '', discount: m.discount ? String(m.discount) : '', notes: m.notes || '', findings: m.findings || '',
    });
    setLines((m.partsLines || []).map(l => ({
      productId: l.productId, sku: l.sku, name: l.name, qty: l.qty, unitPrice: l.unitPrice,
      stock: products.find(p => p.id === l.productId)?.stockQuantity ?? l.qty,
    })));
    setFormError(''); setShowForm(true);
  };

  const addLine = () => {
    const p = products.find(x => x.id === pickProduct);
    const q = Math.max(1, parseInt(pickQty || '1', 10) || 1);
    if (!p) return;
    setLines(ls => {
      const hit = ls.findIndex(l => l.productId === p.id);
      if (hit >= 0) return ls.map((l, i) => (i === hit ? { ...l, qty: l.qty + q } : l));
      return [...ls, { productId: p.id, sku: p.sku, name: p.name, qty: q, unitPrice: p.sellingPrice, stock: p.stockQuantity }];
    });
    setPickProduct(''); setPickQty('1');
  };

  const buildPayload = () => ({
    vehiclePlate: form.vehiclePlate.trim().toUpperCase(),
    customerName: form.customerName.trim() || null,
    customerPhone: form.customerPhone.trim() || null,
    serviceType: form.serviceType,
    priority: form.priority,
    scheduledFor: form.scheduledFor ? new Date(form.scheduledFor + 'T09:00:00.000Z').toISOString() : null,
    mechanicName: form.mechanicName.trim() || null,
    discount: preview.discount,
    notes: form.notes.trim() || null,
    findings: form.findings.trim() || null,
    partsLines: lines.map(l => ({ productId: l.productId, qty: l.qty })),
    deviceId: getDeviceId(),
  });

  const localRowFromForm = (id: string, orderNo: string) => {
    const storedLines: MaintPartLine[] = lines.map(l => ({ productId: l.productId, sku: l.sku, name: l.name, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.qty * l.unitPrice }));
    return {
      ...buildPayload(),
      id, orderNo,
      partsLines: storedLines,
      laborHours: 0, laborTotal: preview.labor, partsTotal: partsBif,
      totalAmount: preview.total, paidAmount: 0, paymentMethod: null,
      status: editTarget?.status || 'WAITING',
      startedAt: editTarget?.startedAt || null, completedAt: null,
      version: editTarget?.version || 1,
      createdAt: editTarget?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any;
  };

  const saveOrder = async () => {
    if (!form.vehiclePlate.trim()) { setFormError(t('maint.valPlate')); return; }
    setSaving(true); setFormError('');
    const id = editTarget?.id || crypto.randomUUID();
    const payload: any = buildPayload();
    if (editTarget) payload.version = editTarget.version;
    try {
      if (editTarget) {
        const saved = await apiClient.put<MaintenanceOrder>(`/maintenance/${editTarget.id}`, payload);
        await localDB.maintenanceOrders.put({ ...saved, partsLines: (saved as any).partsLines || [], syncStatus: 'SYNCED', _dirty: false } as any);
        setNotice(t('maint.saved'));
      } else {
        const localRow = localRowFromForm(id, `TMP-WO-${id.slice(0, 8).toUpperCase()}`);
        localRow.syncStatus = 'PENDING'; localRow._dirty = true;
        await localDB.maintenanceOrders.put(localRow);
        await queueOffline(id, 'CREATE', { id, ...payload });
        const saved = await apiClient.post<MaintenanceOrder>('/maintenance', { id, ...payload });
        await localDB.maintenanceOrders.put({ ...localRow, ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
        const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.status === 'PENDING').toArray();
        await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
        setNotice(t('maint.created'));
      }
      setShowForm(false); setEditTarget(null); setForm(emptyForm()); setLines([]);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        const localRow = localRowFromForm(id, `TMP-WO-${id.slice(0, 8).toUpperCase()}`);
        localRow.syncStatus = 'PENDING'; localRow._dirty = true;
        await localDB.maintenanceOrders.put(localRow);
        await queueOffline(id, editTarget ? 'UPDATE' : 'CREATE', { id, ...payload });
        setNotice(t('maint.offline'));
        setShowForm(false); setEditTarget(null);
        await syncEngine.sync().catch(() => undefined);
      } else {
        setFormError(msg);
      }
    } finally {
      setSaving(false);
      load();
    }
  };

  const transition = async (m: MaintenanceOrder, status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED', extra: any = {}) => {
    const payload: any = { status, version: m.version, ...extra };
    try {
      const saved = await apiClient.put<MaintenanceOrder>(`/maintenance/${m.id}`, payload);
      await localDB.maintenanceOrders.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        const localPatch: any = { ...payload, syncStatus: 'PENDING', _dirty: true, updatedAt: new Date().toISOString() };
        if (status === 'COMPLETED') { localPatch.completedAt = new Date().toISOString(); localPatch.paidAmount = m.totalAmount; }
        if (status === 'IN_PROGRESS') localPatch.startedAt = new Date().toISOString();
        await localDB.maintenanceOrders.update(m.id, localPatch);
        await queueOffline(m.id, 'UPDATE', { id: m.id, ...payload });
        setNotice(t('maint.offlineUpdated'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      load();
    }
  };

  const removeOrder = async (m: MaintenanceOrder) => {
    if (!window.confirm(t('maint.removeConfirm', { no: m.orderNo }))) return;
    try {
      await apiClient.delete(`/maintenance/${m.id}`);
      await localDB.maintenanceOrders.delete(m.id);
      setNotice(t('maint.removed', { no: m.orderNo }));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.maintenanceOrders.update(m.id, { status: 'CANCELLED', syncStatus: 'PENDING', _dirty: true } as any);
        await queueOffline(m.id, 'DELETE', { id: m.id });
        setNotice(t('maint.offlineUpdated'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      load();
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#16A34A]/30 focus:border-[#16A34A] bg-white';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('maint.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('maint.sub')}</p>
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
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t('maint.new')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('maint.statsToday')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{stats.completedToday}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><Wrench className="w-3.5 h-3.5" /> {t('maint.statsRevenue')}</div>
          <div className="text-lg font-bold text-green-600 mt-1">{fmtMoney(stats.revenueToday)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('maint.statsActive')}</div>
          <div className="text-lg font-bold text-sky-600 mt-1">{stats.active}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('maint.statsSched')}</div>
          <div className="text-lg font-bold text-amber-600 mt-1">{t('maint.schedFmt', { due: stats.dueSoon, over: stats.overdue })}</div>
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('maint.searchPh')} className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(st => (
            <button key={st || 'all'} onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === st ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {st === '' ? t('po.all') : t('maint.status.' + st)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('maint.colOrder')}</th>
                <th className="px-4 py-3 font-medium">{t('maint.colVehicle')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('maint.colCustomer')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('maint.colService')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('maint.colSched')}</th>
                <th className="px-4 py-3 font-medium">{t('maint.colParts')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('maint.colAmount')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('maint.colPaid')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                {canManage && <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">{t('maint.nWO', { n: 0 })}</td></tr>
              )}
              {filtered.map(m => {
                const overdue = m.scheduledFor && String(m.scheduledFor).slice(0, 10) < today && (m.status === 'WAITING' || m.status === 'IN_PROGRESS');
                return (
                <tr key={m.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-gray-900 text-[13px]">
                      {m.orderNo}
                      {m.priority === 'URGENT' && m.status !== 'COMPLETED' && (
                        <span className="ml-2 align-middle px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-[#C1272D] border border-red-200">!</span>
                      )}
                    </div>
                    <div className="mt-0.5">{statusChip(m.status)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-gray-800 text-[13px]">{m.vehiclePlate}</div>
                    {m.vehicleLabel && <div className="text-xs text-gray-400">{m.vehicleLabel}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700 hidden md:table-cell">
                    {m.customerName || '—'}
                    {m.customerPhone && <div className="text-xs text-gray-400">{m.customerPhone}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                    {t('maint.svc.' + m.serviceType)}
                    {m.mechanicName && <div className="text-xs text-gray-400">{m.mechanicName}</div>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className={`text-xs ${overdue ? 'text-[#C1272D] font-semibold' : 'text-gray-500'}`}>
                      {m.scheduledFor ? String(m.scheduledFor).slice(0, 10) : '—'}{overdue ? ' ⚠' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {(m.partsLines || []).length > 0 ? (
                      <span title={(m.partsLines || []).map(l => `${l.name} ×${l.qty}`).join('\n')}>
                        <Package className="w-3.5 h-3.5 inline text-gray-400 mr-1" />{(m.partsLines || []).length} · {fmtMoney(m.partsTotal)}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-semibold text-gray-900">{fmtMoney(m.totalAmount)}</div>
                    {m.discount > 0 && <div className="text-[11px] text-green-600 line-through">{fmtMoney(m.totalAmount + m.discount)}</div>}
                    {m.laborTotal > 0 && <div className="text-[11px] text-gray-400">{t('maint.labor')} {fmtMoney(m.laborTotal)}</div>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-600">
                    {m.status === 'COMPLETED' ? (m.paymentMethod ? t('pay.method.' + m.paymentMethod) : t('maint.colPaid')) : m.paidAmount > 0 ? fmtMoney(m.paidAmount) : '—'}
                  </td>
                  <td className="px-4 py-3">{syncChip((m as any).syncStatus || 'SYNCED')}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {m.status === 'WAITING' && (
                          <button onClick={() => transition(m, 'IN_PROGRESS')} className="p-2 rounded-lg hover:bg-sky-50 text-gray-500 hover:text-sky-600" title={t('maint.start')}>
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {(m.status === 'WAITING' || m.status === 'IN_PROGRESS') && (
                          <>
                            <button onClick={() => { setCompleteTarget(m); setPayMethod('CASH'); setFindingsDraft(m.findings || ''); }} className="p-2 rounded-lg hover:bg-green-50 text-gray-500 hover:text-green-600" title={t('maint.complete')}>
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => openEdit(m)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700" title={t('maint.edit')}>
                              <Pencil className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {m.status !== 'COMPLETED' && (
                          <button onClick={() => removeOrder(m)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('maint.remove')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
          <span>{t('maint.nWO', { n: filtered.length })} · {t('maint.statsRevenue')} — {fmtMoney(stats.revenueAll)}{source === 'local' ? ' ' + t('sale.localNote') : ''}</span>
          <button onClick={() => syncEngine.sync()} className="flex items-center gap-1 text-[#16A34A] font-medium hover:underline">
            <RefreshCw className="w-3 h-3" /> {t('c.syncNow')}
          </button>
        </div>
      </div>

      {/* Create / edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-900">{editTarget ? t('maint.editTitle') : t('maint.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.plate')}</label>
                  <input className={inputCls} {...field('vehiclePlate')} placeholder="1AB-2345" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.linkVehicle')}</label>
                  <select className={inputCls} defaultValue="" onChange={e => {
                    const v = (e.target as HTMLSelectElement).selectedOptions[0]?.dataset;
                    if (v) setForm(f => ({ ...f, vehiclePlate: v.plate || f.vehiclePlate, customerName: f.customerName || v.driver || '' }));
                  }}>
                    <option value="">—</option>
                    {fleet.map(v => (
                      <option key={v.id} value={v.id} data-plate={v.plateNumber} data-driver={v.driverName || ''}>
                        {v.plateNumber} · {v.make} {v.model || ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.customer')}</label>
                  <input className={inputCls} {...field('customerName')} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.phone')}</label>
                  <input className={inputCls} {...field('customerPhone')} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.service')}</label>
                  <select className={inputCls} {...field('serviceType')}>
                    {SERVICES.map(sv => <option key={sv} value={sv}>{t('maint.svc.' + sv)} · {fmtMoney(LABOR[sv])}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.priority')}</label>
                    <select className={inputCls} {...field('priority')}>
                      {PRIORITIES.map(p => <option key={p} value={p}>{t('maint.pr.' + p)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.scheduled')}</label>
                    <input className={inputCls} type="date" {...field('scheduledFor')} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.mech')}</label>
                  <input className={inputCls} {...field('mechanicName')} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.discount', { cur: curLabel })}</label>
                  <input className={inputCls} type="number" min="0" step="any" {...field('discount')} />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('maint.partsTitle')}</div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-400 block mb-1">{t('maint.pickPart')}</label>
                    <select className={inputCls} value={pickProduct} onChange={e => setPickProduct(e.target.value)}>
                      <option value="">—</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name} ({t('maint.stockOf', { n: p.stockQuantity })})</option>)}
                    </select>
                  </div>
                  <div className="w-20">
                    <label className="text-[11px] text-gray-400 block mb-1">{t('maint.qty')}</label>
                    <input className={inputCls} type="number" min="1" value={pickQty} onChange={e => setPickQty(e.target.value)} />
                  </div>
                  <button onClick={addLine} disabled={!pickProduct} className="px-3 py-2 rounded-xl bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-50 text-white text-sm font-medium">
                    {t('maint.addPart')}
                  </button>
                </div>
                {lines.length === 0 && <div className="text-xs text-gray-400 py-1">{t('maint.noParts')}</div>}
                {lines.map((l, i) => (
                  <div key={l.productId} className="flex items-center justify-between text-sm px-2 py-1.5 rounded-lg bg-gray-50">
                    <span className="truncate">
                      <span className="font-mono text-[11px] text-gray-400 mr-2">{l.sku}</span>{l.name}
                      <span className="text-gray-400 text-xs"> · {l.qty} × {fmtMoney(l.unitPrice)}</span>
                      {l.stock < l.qty && <span className="ml-2 text-[11px] text-amber-600">{t('maint.overStock', { n: l.stock })}</span>}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="font-medium">{fmtMoney(l.qty * l.unitPrice)}</span>
                      <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.notes')}</label>
                <textarea className={inputCls} rows={2} {...field('notes')} />
              </div>

              <div className="px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-sm space-y-1">
                <div className="flex justify-between text-gray-500"><span>{t('maint.labor')}</span><span>{fmtMoney(preview.labor)}</span></div>
                <div className="flex justify-between text-gray-500"><span>{t('maint.partsLabel')}</span><span>{fmtMoney(preview.parts)}</span></div>
                {preview.discount > 0 && <div className="flex justify-between text-green-600"><span>−{t('maint.discount', { cur: curLabel })}</span><span>−{fmtMoney(preview.discount)}</span></div>}
                <div className="flex justify-between font-bold text-gray-900 border-t border-green-200 pt-1.5 mt-1">
                  <span>Total</span><span>{fmtMoney(preview.total)}</span>
                </div>
                <div className="text-[11px] text-gray-400">{t('maint.preview')}</div>
              </div>
              {formError && <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={saveOrder} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">
                {saving ? t('c.saving') : (editTarget ? t('c.save') : t('maint.new'))}
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
              <h2 className="font-bold text-gray-900">{t('maint.complete')} · {completeTarget.orderNo}</h2>
              <button onClick={() => setCompleteTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">{t('maint.colAmount')}</span>
              <span className="font-bold">{fmtMoney(completeTarget.totalAmount)}</span>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.payMethod')}</label>
              <select className={inputCls} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                {METHODS.map(mth => <option key={mth} value={mth}>{t('pay.method.' + mth)}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1.5">{t('maint.paidFull')}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">{t('maint.findings')}</label>
              <textarea className={inputCls} rows={2} value={findingsDraft} onChange={e => setFindingsDraft(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCompleteTarget(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button
                onClick={async () => {
                  const target = completeTarget;
                  const findings = findingsDraft.trim();
                  setCompleteTarget(null);
                  await transition(target, 'COMPLETED', { paymentMethod: payMethod, ...(findings ? { findings } : {}) });
                }}
                className="px-5 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
              >
                {t('maint.complete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
