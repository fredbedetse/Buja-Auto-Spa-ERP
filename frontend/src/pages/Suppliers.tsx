import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, RefreshCw, Cloud, CloudOff, Edit, Trash2,
  CheckCircle, Clock, AlertTriangle, Building2, Phone,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';
import type { Supplier } from '../types';

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

type FormState = {
  id?: string;
  version?: number;
  name: string;
  contactName: string;
  phone: string;
  altPhone: string;
  email: string;
  address: string;
  city: string;
  taxId: string;
  notes: string;
  leadTimeDays: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  name: '', contactName: '', phone: '', altPhone: '', email: '',
  address: '', city: '', taxId: '', notes: '', leadTimeDays: '7', isActive: true,
};

export default function SuppliersPage() {
  const { t } = useT();
  const { fmt: fmtMoney } = useMoney();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission('suppliers:manage');

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<{ total: number; active: number; spendAll: number; owed: number }>({ total: 0, active: 0, spendAll: 0, owed: 0 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadSuppliers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: Supplier[]; pagination: any }>('/suppliers?limit=200');
      for (const s of res.data) {
        await localDB.suppliers.put({ ...s, syncStatus: 'SYNCED', _dirty: false } as any);
      }
      setSuppliers(res.data);
      setSource('cloud');
      try {
        const st = await apiClient.get<any>('/suppliers/stats');
        setStats({ total: st.total, active: st.active, spendAll: st.spendAll, owed: st.owedToSuppliers });
      } catch { /* keep previous */ }
    } catch (err: any) {
      const cached = await localDB.suppliers.filter(s => !s.isDeleted).toArray();
      setSuppliers(cached);
      setSource('local');
      if (!String(err.message).includes('OFFLINE')) setNotice(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
    const unsub = syncEngine.subscribe(() => { loadSuppliers(); });
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(q) || s.phone.includes(q) ||
      (s.city || '').toLowerCase().includes(q) || (s.contactName || '').toLowerCase().includes(q)
    );
  }, [suppliers, search]);

  const field = (key: keyof FormState) => ({
    value: (form as any)[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const openCreate = () => { setForm(emptyForm); setFormError(''); setShowForm(true); };
  const openEdit = (s: Supplier) => {
    setForm({
      id: s.id, version: s.version,
      name: s.name, contactName: s.contactName || '', phone: s.phone,
      altPhone: s.altPhone || '', email: s.email || '', address: s.address || '',
      city: s.city || '', taxId: s.taxId || '', notes: s.notes || '',
      leadTimeDays: String(s.leadTimeDays ?? 7), isActive: s.isActive ?? true,
    });
    setFormError('');
    setShowForm(true);
  };

  const validate = (f: FormState) => {
    if (f.name.trim().length < 2) return t('sup.valName');
    if (f.phone.trim().length < 6) return t('sup.valPhone');
    return '';
  };

  const payloadFrom = (f: FormState) => ({
    name: f.name.trim(),
    contactName: f.contactName.trim() || null,
    phone: f.phone.trim(),
    altPhone: f.altPhone.trim() || null,
    email: f.email.trim() || null,
    address: f.address.trim() || null,
    city: f.city.trim() || null,
    taxId: f.taxId.trim() || null,
    notes: f.notes.trim() || null,
    leadTimeDays: Math.max(0, parseInt(f.leadTimeDays || '7', 10) || 7),
    isActive: f.isActive,
    deviceId: getDeviceId(),
  });

  const saveSupplier = async () => {
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
    await localDB.suppliers.put(localRow);
    await localDB.addToSyncQueue({
      entityType: 'Supplier',
      entityId: id,
      operation: form.id ? 'UPDATE' : 'CREATE',
      data: { id, ...payload },
      clientVersion: form.version,
      deviceId: getDeviceId(),
    } as any);

    try {
      const saved = form.id
        ? await apiClient.put<Supplier>(`/suppliers/${form.id}`, payload)
        : await apiClient.post<Supplier>('/suppliers', payload);
      await localDB.suppliers.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.status === 'PENDING').toArray();
      await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
      setNotice(t('sup.saved'));
      setShowForm(false);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('sup.offline'));
        setShowForm(false);
        await syncEngine.sync().catch(() => undefined);
      } else if (msg.includes('409') || msg.includes('Conflict')) {
        setNotice(t('sup.conflict'));
        setShowForm(false);
      } else {
        setFormError(msg);
        setNotice(msg || t('sup.failed'));
      }
    } finally {
      setSaving(false);
      loadSuppliers();
    }
  };

  const deleteSupplier = async (s: Supplier) => {
    if (!window.confirm(t('sup.delConfirm', { name: s.name }))) return;
    try {
      await apiClient.delete(`/suppliers/${s.id}`);
      await localDB.suppliers.delete(s.id);
      setNotice(t('sup.deleted'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.suppliers.delete(s.id);
        await localDB.addToSyncQueue({ entityType: 'Supplier', entityId: s.id, operation: 'DELETE', data: { id: s.id }, deviceId: getDeviceId() } as any);
        setNotice(t('sup.delOffline'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      loadSuppliers();
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#C1272D]/30 focus:border-[#C1272D] bg-white';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('sup.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('sup.sub')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${
            source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
          }`}>
            {source === 'cloud' ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
            {source === 'cloud' ? t('c.cloudCache') : t('c.offlineData')}
          </span>
          <button onClick={loadSuppliers} className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors" title={t('c.reload')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canManage && (
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t('sup.new')}
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><Building2 className="w-3.5 h-3.5" /> {t('sup.statsTotal')}</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{stats.total}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('sup.statsActive')}</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{stats.active}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('sup.statsSpend')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{fmtMoney(stats.spendAll)}</div>
        </div>
        <div className={`bg-white rounded-2xl border px-4 py-3 ${stats.owed > 0 ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><AlertTriangle className="w-3.5 h-3.5 text-red-500" /> {t('sup.statsOwed')}</div>
          <div className="text-lg font-bold text-red-600 mt-1">{fmtMoney(stats.owed)}</div>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-400 hover:text-blue-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('sup.searchPh')} className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('sup.colSupplier')}</th>
                <th className="px-4 py-3 font-medium">{t('sup.colContact')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('sup.colCity')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('sup.colLead')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">{t('sup.emptyA')}{canManage ? t('sup.emptyB') : ''}</td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {s.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{s.name}</div>
                        <div className="text-[11px] text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" />{s.phone}{!s.isActive && ' · ' + t('c.inactive')}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.contactName || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{s.city || '—'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.leadTimeDays <= 7 ? 'bg-green-50 text-green-700 border-green-200' : s.leadTimeDays <= 14 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                      {t('sup.leadDays', { n: s.leadTimeDays })}
                    </span>
                  </td>
                  <td className="px-4 py-3">{syncChip((s as any).syncStatus || 'SYNCED')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && (
                        <>
                          <button onClick={() => openEdit(s)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title={t('c.edit')}>
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteSupplier(s)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('c.delete')}>
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
          <span>{filtered.length} {t('sup.heading').toLowerCase()}{source === 'local' ? ' ' + t('sale.localNote') : ''}</span>
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
              <h2 className="font-bold text-gray-900">{form.id ? t('sup.editTitle') : t('sup.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.name')}</label>
                <input className={inputCls} {...field('name')} placeholder={t('sup.namePh')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.contact')}</label>
                <input className={inputCls} {...field('contactName')} placeholder={t('sup.contactPh')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.phone')}</label>
                <input className={inputCls} {...field('phone')} placeholder="+257 7X XXX XXX" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.altPhone')}</label>
                <input className={inputCls} {...field('altPhone')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.email')}</label>
                <input className={inputCls} type="email" {...field('email')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.city')}</label>
                <input className={inputCls} {...field('city')} placeholder={t('sup.cityPh')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.taxId')}</label>
                <input className={inputCls} {...field('taxId')} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.address')}</label>
                <input className={inputCls} {...field('address')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('sup.lead')}</label>
                <input className={inputCls} type="number" min="0" max="365" {...field('leadTimeDays')} />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 accent-[#C1272D]" />
                  {t('sup.activeLabel')}
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('c.notes')}</label>
                <textarea className={inputCls} rows={3} {...field('notes')} placeholder={t('sup.notesPh')} />
              </div>

              {formError && (
                <div className="sm:col-span-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={saveSupplier} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">
                {saving ? t('c.saving') : form.id ? t('c.saveChanges') : t('sup.new')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
