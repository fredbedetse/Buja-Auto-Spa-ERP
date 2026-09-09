import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, RefreshCw, Cloud, CloudOff, Edit, Trash2,
  CheckCircle, Clock, AlertTriangle, Truck, Gauge,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';
import type { Vehicle } from '../types';

const VEHICLE_TYPES = ['TRUCK', 'BUS', 'MINIBUS', 'PICKUP', 'CAR', 'OTHER'] as const;
const VEHICLE_STATUSES = ['AVAILABLE', 'IN_USE', 'IN_MAINTENANCE', 'RENTED', 'RETIRED'] as const;

const syncChip = (status?: string) => {
  switch (status) {
    case 'PENDING':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow-50 text-yellow-700 border border-yellow-200"><Clock className="w-3 h-3" /> {tNow('c.pendingSync')}</span>;
    case 'FAILED':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200"><AlertTriangle className="w-3 h-3" /> {tNow('c.syncFailed')}</span>;
    case 'CONFLICT':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-50 text-orange-700 border border-orange-200"><AlertTriangle className="w-3 h-3" /> {tNow('c.conflict')}</span>;
    default:
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700 border border-green-200"><CheckCircle className="w-3 h-3" /> {tNow('c.synced')}</span>;
  }
};

const statusChip = (status: string) => {
  const cls: Record<string, string> = {
    AVAILABLE: 'bg-green-50 text-green-700 border-green-200',
    IN_USE: 'bg-sky-50 text-sky-700 border-sky-200',
    IN_MAINTENANCE: 'bg-amber-50 text-amber-700 border-amber-200',
    RENTED: 'bg-purple-50 text-purple-700 border-purple-200',
    RETIRED: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls[status] || cls.RETIRED}`}>{tNow('veh.status.' + status)}</span>;
};

type FormState = {
  id?: string;
  version?: number;
  plateNumber: string;
  type: string;
  make: string;
  model: string;
  year: string;
  vin: string;
  color: string;
  status: string;
  odometerKm: string;
  driverName: string;
  driverPhone: string;
  purchaseDate: string;
  purchasePrice: string; // in display currency
  notes: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  plateNumber: '', type: 'TRUCK', make: '', model: '', year: '', vin: '', color: '',
  status: 'AVAILABLE', odometerKm: '0', driverName: '', driverPhone: '',
  purchaseDate: '', purchasePrice: '', notes: '', isActive: true,
};

export default function VehiclesPage() {
  const { t } = useT();
  const { fmt: fmtMoney, toBif, toDisplay, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission('vehicles:manage');

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stats, setStats] = useState<{ total: number; available: number; inUse: number; fleetValue: number }>({ total: 0, available: 0, inUse: 0, fleetValue: 0 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadVehicles = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: Vehicle[]; pagination: any }>('/vehicles?limit=200');
      for (const v of res.data) {
        await localDB.vehicles.put({ ...v, syncStatus: 'SYNCED', _dirty: false } as any);
      }
      setVehicles(res.data);
      setSource('cloud');
      try {
        const st = await apiClient.get<any>('/vehicles/stats');
        setStats({
          total: st.total,
          available: st.byStatus?.AVAILABLE ?? 0,
          inUse: st.byStatus?.IN_USE ?? 0,
          fleetValue: st.fleetValue ?? 0,
        });
      } catch { /* keep previous */ }
    } catch (err: any) {
      const cached = await localDB.vehicles.filter(v => !v.isDeleted).toArray();
      setVehicles(cached);
      setSource('local');
      if (!String(err.message).includes('OFFLINE')) setNotice(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVehicles();
    const unsub = syncEngine.subscribe(() => { loadVehicles(); });
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter(v => {
      if (statusFilter && v.status !== statusFilter) return false;
      if (!q) return true;
      return v.plateNumber.toLowerCase().includes(q) || v.make.toLowerCase().includes(q) ||
        (v.model || '').toLowerCase().includes(q) || (v.driverName || '').toLowerCase().includes(q) ||
        (v.vin || '').toLowerCase().includes(q);
    });
  }, [vehicles, search, statusFilter]);

  const field = (key: keyof FormState) => ({
    value: (form as any)[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const openCreate = () => { setForm(emptyForm); setFormError(''); setShowForm(true); };
  const openEdit = (v: Vehicle) => {
    setForm({
      id: v.id, version: v.version,
      plateNumber: v.plateNumber, type: v.type, make: v.make, model: v.model || '',
      year: v.year ? String(v.year) : '', vin: v.vin || '', color: v.color || '',
      status: v.status, odometerKm: String(v.odometerKm ?? 0),
      driverName: v.driverName || '', driverPhone: v.driverPhone || '',
      purchaseDate: v.purchaseDate ? v.purchaseDate.slice(0, 10) : '',
      purchasePrice: v.purchasePrice ? String(toDisplay(v.purchasePrice)) : '',
      notes: v.notes || '', isActive: v.isActive ?? true,
    });
    setFormError('');
    setShowForm(true);
  };

  const validate = (f: FormState) => {
    if (f.plateNumber.trim().length < 4) return t('veh.valPlate');
    if (f.make.trim().length < 2) return t('veh.valMake');
    return '';
  };

  const payloadFrom = (f: FormState) => ({
    plateNumber: f.plateNumber.trim().toUpperCase(),
    type: f.type as Vehicle['type'],
    make: f.make.trim(),
    model: f.model.trim() || null,
    year: f.year ? Math.max(1970, Math.min(2100, parseInt(f.year, 10) || 0)) : null,
    vin: f.vin.trim().toUpperCase() || null,
    color: f.color.trim() || null,
    status: f.status as Vehicle['status'],
    odometerKm: Math.max(0, parseInt(f.odometerKm || '0', 10) || 0),
    driverName: f.driverName.trim() || null,
    driverPhone: f.driverPhone.trim() || null,
    purchaseDate: f.purchaseDate ? new Date(f.purchaseDate + 'T00:00:00').toISOString() : null,
    purchasePrice: f.purchasePrice !== '' ? Math.max(0, toBif(parseFloat(f.purchasePrice) || 0)) : null,
    notes: f.notes.trim() || null,
    isActive: f.isActive,
    deviceId: getDeviceId(),
  });

  const saveVehicle = async () => {
    const err = validate(form);
    if (err) { setFormError(err); return; }
    setSaving(true);
    setFormError('');

    const payload = payloadFrom(form) as any;
    const id = form.id || crypto.randomUUID();
    if (!form.id) payload.id = id;

    const localRow: any = {
      id, ...payload,
      version: (form.version ?? 0) + 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING', _dirty: true,
    };
    await localDB.vehicles.put(localRow);
    await localDB.addToSyncQueue({
      entityType: 'Vehicle',
      entityId: id,
      operation: form.id ? 'UPDATE' : 'CREATE',
      data: { id, ...payload },
      clientVersion: form.version,
      deviceId: getDeviceId(),
    } as any);

    try {
      const saved = form.id
        ? await apiClient.put<Vehicle>(`/vehicles/${form.id}`, payload)
        : await apiClient.post<Vehicle>('/vehicles', payload);
      await localDB.vehicles.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.status === 'PENDING').toArray();
      await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
      setNotice(t('veh.saved'));
      setShowForm(false);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('veh.offline'));
        setShowForm(false);
        await syncEngine.sync().catch(() => undefined);
      } else if (msg.includes('409') || msg.includes('Conflict')) {
        setNotice(msg.includes('already registered') ? t('veh.dupPlate') : msg);
        setShowForm(false);
      } else {
        setFormError(msg);
        setNotice(msg || t('veh.failed'));
      }
    } finally {
      setSaving(false);
      loadVehicles();
    }
  };

  const deleteVehicle = async (v: Vehicle) => {
    if (!window.confirm(t('veh.delConfirm', { plate: v.plateNumber }))) return;
    try {
      await apiClient.delete(`/vehicles/${v.id}`);
      await localDB.vehicles.delete(v.id);
      setNotice(t('veh.deleted'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.vehicles.delete(v.id);
        await localDB.addToSyncQueue({ entityType: 'Vehicle', entityId: v.id, operation: 'DELETE', data: { id: v.id }, deviceId: getDeviceId() } as any);
        setNotice(t('veh.delOffline'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      loadVehicles();
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#C1272D]/30 focus:border-[#C1272D] bg-white';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('veh.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('veh.sub')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${
            source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
          }`}>
            {source === 'cloud' ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
            {source === 'cloud' ? t('c.cloudCache') : t('c.offlineData')}
          </span>
          <button onClick={loadVehicles} className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors" title={t('c.reload')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canManage && (
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t('veh.new')}
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><Truck className="w-3.5 h-3.5" /> {t('veh.statsTotal')}</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{stats.total}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('veh.statsAvailable')}</div>
          <div className="text-xl font-bold text-green-600 mt-0.5">{stats.available}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('veh.statsInUse')}</div>
          <div className="text-xl font-bold text-sky-600 mt-0.5">{stats.inUse}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('veh.statsValue')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{fmtMoney(stats.fleetValue)}</div>
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('veh.searchPh')} className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['', ...VEHICLE_STATUSES].map(st => (
            <button key={st || 'all'} onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === st ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {st === '' ? t('po.all') : t('veh.status.' + st)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('veh.colPlate')}</th>
                <th className="px-4 py-3 font-medium">{t('veh.colVehicle')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('veh.colDriver')}</th>
                <th className="px-4 py-3 font-medium">{t('c.status')}</th>
                <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">{t('veh.colOdometer')}</th>
                <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">{t('veh.colValue')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">{t('sup.emptyA')}{canManage ? ' ' + t('sup.emptyB').toLowerCase() : ''}</td></tr>
              )}
              {filtered.map(v => (
                <tr key={v.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg text-white flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${v.isActive ? 'from-[#1A1A2E] to-[#3a3a5e]' : 'from-gray-400 to-gray-500'}`}>
                        <Truck className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-mono font-semibold text-gray-900 text-[13px]">{v.plateNumber}</div>
                        <div className="text-[11px] text-gray-400">{t('veh.type.' + v.type)}{v.year ? ` · ${v.year}` : ''}{!v.isActive && ' · ' + t('c.inactive')}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{v.make}{v.model ? ` ${v.model}` : ''}</div>
                    {v.color && <div className="text-[11px] text-gray-400">{v.color}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                    {v.driverName || '—'}
                    {v.driverPhone && <div className="text-[11px] text-gray-400">{v.driverPhone}</div>}
                  </td>
                  <td className="px-4 py-3">{statusChip(v.status)}</td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap hidden lg:table-cell">
                    <span className="inline-flex items-center gap-1"><Gauge className="w-3.5 h-3.5 text-gray-400" />{t('veh.km', { n: v.odometerKm.toLocaleString('en-US') })}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap hidden lg:table-cell">{v.purchasePrice ? fmtMoney(v.purchasePrice) : '—'}</td>
                  <td className="px-4 py-3">{syncChip((v as any).syncStatus || 'SYNCED')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && (
                        <>
                          <button onClick={() => openEdit(v)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title={t('c.edit')}>
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteVehicle(v)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('c.delete')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
          <span>{t('veh.nFleet', { n: filtered.length })}{source === 'local' ? ' ' + t('sale.localNote') : ''}</span>
          <button onClick={() => syncEngine.sync()} className="flex items-center gap-1 text-[#C1272D] font-medium hover:underline">
            <RefreshCw className="w-3 h-3" /> {t('c.syncNow')}
          </button>
        </div>
      </div>

      {/* Add/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">{form.id ? t('veh.editTitle') : t('veh.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.plate')}</label>
                <input className={inputCls + ' font-mono uppercase'} {...field('plateNumber')} placeholder={t('veh.platePh')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.type')}</label>
                  <select className={inputCls} {...field('type')}>
                    {VEHICLE_TYPES.map(ty => <option key={ty} value={ty}>{t('veh.type.' + ty)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.year')}</label>
                  <input className={inputCls} type="number" min="1970" max="2100" {...field('year')} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.make')}</label>
                <input className={inputCls} {...field('make')} placeholder={t('veh.makePh')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.model')}</label>
                <input className={inputCls} {...field('model')} placeholder={t('veh.modelPh')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.status')}</label>
                <select className={inputCls} {...field('status')}>
                  {VEHICLE_STATUSES.map(st => <option key={st} value={st}>{t('veh.status.' + st)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.odometer')}</label>
                <input className={inputCls} type="number" min="0" step="1" {...field('odometerKm')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.color')}</label>
                <input className={inputCls} {...field('color')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.vin')}</label>
                <input className={inputCls + ' font-mono'} {...field('vin')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.driver')}</label>
                <input className={inputCls} {...field('driverName')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.driverPhone')}</label>
                <input className={inputCls} {...field('driverPhone')} placeholder="+257 7X XXX XXX" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.purchaseDate')}</label>
                <input className={inputCls} type="date" {...field('purchaseDate')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('veh.purchasePrice', { cur: curLabel })}</label>
                <input className={inputCls} type="number" min="0" step="any" {...field('purchasePrice')} />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 accent-[#C1272D]" />
                  {t('veh.active')}
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('c.notes')}</label>
                <textarea className={inputCls} rows={3} {...field('notes')} placeholder={t('veh.notesPh')} />
              </div>

              {formError && (
                <div className="sm:col-span-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={saveVehicle} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">
                {saving ? t('c.saving') : form.id ? t('c.saveChanges') : t('veh.new')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
