import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, Edit, Trash2, AlertTriangle, CheckCircle, Clock,
  RefreshCw, Cloud, CloudOff, X, Building2, User, Phone,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useAuthStore } from '../stores/authStore';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import type { Customer } from '../types';

type FormState = {
  id?: string;
  version?: number;
  name: string;
  contactName: string;
  phone: string;
  altPhone: string;
  email: string;
  customerType: 'INDIVIDUAL' | 'COMPANY';
  address: string;
  city: string;
  notes: string;
  creditLimit: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  name: '', contactName: '', phone: '', altPhone: '', email: '',
  customerType: 'INDIVIDUAL', address: '', city: '', notes: '',
  creditLimit: '0', isActive: true,
};

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

export default function CustomersPage() {  const { t } = useT();
  const { toDisplay, toBif, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canCreate = hasPermission('customers:create') || hasPermission('customers:manage');
  const canUpdate = hasPermission('customers:update') || hasPermission('customers:manage');
  const canDelete = hasPermission('customers:delete') || hasPermission('customers:manage');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCustomers = async () => {
    setLoading(true);
    setFormError('');
    try {
      // Online-first: fetch cloud and refresh local cache
      const data = await apiClient.get<{ data: Customer[] }>(`/customers?limit=200${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      const localPending = await localDB.customers.filter(c => (c as any)._dirty).toArray();
      const pendingIds = new Set(localPending.map(c => c.id));
      const merged = [
        ...data.data.filter(c => !pendingIds.has(c.id)).map(c => ({ ...c, syncStatus: 'SYNCED' as const })),
        ...localPending,
      ].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      for (const c of data.data) {
        if (!pendingIds.has(c.id)) await localDB.customers.put({ ...c, syncStatus: 'SYNCED', _dirty: false } as any);
      }
      setCustomers(merged);
      setSource('cloud');
    } catch (err: any) {
      // Offline fallback: read from IndexedDB
      const cached = await localDB.customers.filter(c => !c.isDeleted).toArray();
      setCustomers(cached.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
      setSource('local');
      if (!String(err.message).includes('OFFLINE')) setNotice(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
    const unsub = syncEngine.subscribe(() => { loadCustomers(); });
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.contactName || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.city || '').toLowerCase().includes(q)
    );
  }, [customers, search]);

  const openCreate = () => { setForm(emptyForm); setFormError(''); setShowForm(true); };
  const openEdit = (c: Customer) => {
    setForm({
      id: c.id, version: c.version,
      name: c.name || '', contactName: c.contactName || '', phone: c.phone || '',
      altPhone: c.altPhone || '', email: c.email || '', customerType: c.customerType || 'INDIVIDUAL',
      address: c.address || '', city: c.city || '', notes: c.notes || '',
      creditLimit: String(toDisplay(c.creditLimit ?? 0)), isActive: c.isActive ?? true,
    });
    setFormError('');
    setShowForm(true);
  };

  const queueForSync = async (operation: 'CREATE' | 'UPDATE' | 'DELETE', entityId: string, data: any, clientVersion?: number) => {
    await localDB.addToSyncQueue({
      entityType: 'Customer',
      entityId,
      operation,
      data,
      clientVersion,
      deviceId: getDeviceId(),
    } as any);
  };

  const payloadFrom = (f: FormState) => ({
    name: f.name.trim(),
    contactName: f.contactName.trim() || null,
    phone: f.phone.trim(),
    altPhone: f.altPhone.trim() || null,
    email: f.email.trim() || null,
    customerType: f.customerType,
    address: f.address.trim() || null,
    city: f.city.trim() || null,
    notes: f.notes.trim() || null,
    creditLimit: toBif(parseFloat(f.creditLimit || '0') || 0),
    isActive: f.isActive,
  });

  const validate = (f: FormState) => {
    if (f.name.trim().length < 2) return t('cust.valName');
    if (f.phone.trim().length < 6) return t('cust.valPhone');
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) return t('cust.valEmail');
    return '';
  };

  const saveCustomer = async () => {
    const err = validate(form);
    if (err) { setFormError(err); return; }
    setSaving(true);
    setFormError('');

    const payload = payloadFrom(form);
    const isEdit = !!form.id;
    const id = form.id || crypto.randomUUID();

    // Persist locally first so the record always exists (offline-first guarantee)
    const localRecord: any = {
      id, ...payload,
      version: form.version ?? 1,
      createdAt: (customers.find(c => c.id === id)?.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
      _dirty: true,
    };
    await localDB.customers.put(localRecord);
    await queueForSync(isEdit ? 'UPDATE' : 'CREATE', id, { id, ...payload }, form.version);

    try {
      if (isEdit) {
        const saved = await apiClient.put<Customer>(`/customers/${id}`, { ...payload, version: form.version, deviceId: getDeviceId() });
        await localDB.customers.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      } else {
        const saved = await apiClient.post<Customer>('/customers', { id, ...payload, deviceId: getDeviceId() });
        await localDB.customers.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      }
      // Online write succeeded - the queued item is no longer needed
      const queued = await localDB.syncQueue
        .where('entityId').equals(id)
        .filter(i => i.entityType === 'Customer' && i.status === 'PENDING')
        .toArray();
      await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
      setNotice(t('cust.saved'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('409') || msg.includes('already exists') || msg.includes('Conflict')) {
        setNotice(t('cust.conflict'));
      } else if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('cust.offline'));
      } else {
        setFormError(msg || 'Save failed');
        setNotice(msg || t('cust.failed'));
      }
      await syncEngine.sync().catch(() => undefined);
    } finally {
      setSaving(false);
      setShowForm(false);
      loadCustomers();
    }
  };

  const deleteCustomer = async (c: Customer) => {
    if (!window.confirm(t('cust.delConfirm', { name: c.name }))) return;
    try {
      await apiClient.delete(`/customers/${c.id}`);
      await localDB.customers.delete(c.id);
      setNotice(t('cust.deleted'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        // Remove locally + queue the delete for later sync
        await localDB.customers.delete(c.id);
        await queueForSync('DELETE', c.id, { id: c.id }, c.version);
        setNotice(t('cust.delOffline'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      loadCustomers();
    }
  };

  const field = (key: keyof FormState) => ({
    value: form[key] as any,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [key]: (e.target as HTMLInputElement).type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })),
  });

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#C1272D]/30 focus:border-[#C1272D]';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('cust.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('cust.sub')}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${
            source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
          }`}>
            {source === 'cloud' ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
            {source === 'cloud' ? t('c.cloudCache') : t('c.offlineData')}
          </span>
          <button onClick={loadCustomers} className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors" title={t('c.reload')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canCreate && (
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t('cust.new')}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-400 hover:text-blue-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('cust.searchPh')}
          className="w-full sm:max-w-md pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white"
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('cust.colCustomer')}</th>
                <th className="px-4 py-3 font-medium">{t('cust.colContact')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('cust.colLocation')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('cust.colType')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">{t('cust.emptyA')}{canCreate ? t('cust.emptyB') : ''}</td></tr>
              )}
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 ${c.customerType === 'COMPANY' ? 'bg-indigo-500' : 'bg-[#FF6B00]'}`}>
                        {c.customerType === 'COMPANY' ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{c.name}</div>
                        {c.contactName && <div className="text-xs text-gray-400">{c.contactName}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-700 flex items-center gap-1.5"><Phone className="w-3 h-3 text-gray-400" />{c.phone}</div>
                    {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{c.city || '—'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${c.customerType === 'COMPANY' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
                      {c.customerType === 'COMPANY' ? t('cust.company') : t('cust.individual')}
                    </span>
                  </td>
                  <td className="px-4 py-3">{syncChip((c as any).syncStatus || 'SYNCED')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canUpdate && (
                        <button onClick={() => openEdit(c)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title={t('c.edit')}>
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => deleteCustomer(c)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('c.delete')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
          <span>{filtered.length} customer{filtered.length === 1 ? '' : 's'} {source === 'local' ? '(local cache)' : ''}</span>
          <button onClick={() => syncEngine.sync()} className="flex items-center gap-1 text-[#C1272D] font-medium hover:underline">
            <RefreshCw className="w-3 h-3" /> {t('c.syncNow')}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">{form.id ? t('cust.editTitle') : t('cust.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.name')}</label>
                <input className={inputCls} {...field('name')} placeholder={t('cust.namePh')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.type')}</label>
                <select className={inputCls} {...field('customerType')}>
                  <option value="INDIVIDUAL">{t('cust.individual')}</option>
                  <option value="COMPANY">{t('cust.company')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.contact')}</label>
                <input className={inputCls} {...field('contactName')} placeholder={t('cust.contactPh')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.phone')}</label>
                <input className={inputCls} {...field('phone')} placeholder="+257 7X XXX XXX" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.altPhone')}</label>
                <input className={inputCls} {...field('altPhone')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.email')}</label>
                <input className={inputCls} type="email" {...field('email')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.city')}</label>
                <input className={inputCls} {...field('city')} placeholder="Gitega, Bujumbura, ..." />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.address')}</label>
                <input className={inputCls} {...field('address')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('cust.credit', { cur: curLabel })}</label>
                <input className={inputCls} type="number" min="0" step="1000" {...field('creditLimit')} />
              </div>
              <div className="flex items-center mt-6">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-[#C1272D]" {...field('isActive')} />
                  {t('cust.activeLabel')}
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('c.notes')}</label>
                <textarea className={inputCls} rows={3} {...field('notes')} placeholder={t('cust.notesPh')} />
              </div>

              {formError && (
                <div className="sm:col-span-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={saveCustomer} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">
                {saving ? t('c.saving') : form.id ? t('c.saveChanges') : t('cust.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
