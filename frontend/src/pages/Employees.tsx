import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, RefreshCw, Cloud, CloudOff, Edit, Trash2,
  CheckCircle, Clock, AlertTriangle, UserCog, Banknote,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';
import type { Employee } from '../types';

const POSITIONS = ['DRIVER', 'MECHANIC', 'CASHIER', 'WASHER', 'SALESPERSON', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'OTHER'] as const;
const EMP_STATUSES = ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] as const;

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
    ACTIVE: 'bg-green-50 text-green-700 border-green-200',
    ON_LEAVE: 'bg-amber-50 text-amber-700 border-amber-200',
    TERMINATED: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls[status] || cls.TERMINATED}`}>{tNow('emp.st.' + status)}</span>;
};

type FormState = {
  id?: string;
  version?: number;
  firstName: string;
  lastName: string;
  position: string;
  phone: string;
  email: string;
  nationalId: string;
  city: string;
  hireDate: string;
  salary: string; // in display currency
  employmentStatus: string;
  notes: string;
  isActive: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm: FormState = {
  firstName: '', lastName: '', position: 'DRIVER', phone: '', email: '', nationalId: '',
  city: '', hireDate: today(), salary: '', employmentStatus: 'ACTIVE', notes: '', isActive: true,
};

export default function EmployeesPage() {
  const { t } = useT();
  const { fmt: fmtMoney, toBif, toDisplay, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission('employees:manage');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stats, setStats] = useState<{ total: number; active: number; onLeave: number; payrollMonth: number }>({ total: 0, active: 0, onLeave: 0, payrollMonth: 0 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadEmployees = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: Employee[]; pagination: any }>('/employees?limit=200');
      for (const em of res.data) {
        await localDB.employees.put({ ...em, syncStatus: 'SYNCED', _dirty: false } as any);
      }
      setEmployees(res.data);
      setSource('cloud');
      try {
        const st = await apiClient.get<any>('/employees/stats');
        setStats({
          total: st.total,
          active: st.active ?? 0,
          onLeave: st.onLeave ?? 0,
          payrollMonth: st.payrollMonth ?? 0,
        });
      } catch { /* keep previous */ }
    } catch (err: any) {
      const cached = await localDB.employees.filter(em => !em.isDeleted).toArray();
      setEmployees(cached);
      setSource('local');
      if (!String(err.message).includes('OFFLINE')) setNotice(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
    const unsub = syncEngine.subscribe(() => { loadEmployees(); });
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(em => {
      if (statusFilter && em.employmentStatus !== statusFilter) return false;
      if (!q) return true;
      return `${em.firstName} ${em.lastName}`.toLowerCase().includes(q) ||
        (em.phone || '').toLowerCase().includes(q) ||
        (em.email || '').toLowerCase().includes(q) ||
        (em.nationalId || '').toLowerCase().includes(q) ||
        tNow('emp.pos.' + em.position).toLowerCase().includes(q);
    });
  }, [employees, search, statusFilter]);

  const field = (key: keyof FormState) => ({
    value: (form as any)[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const openCreate = () => { setForm({ ...emptyForm, hireDate: today() }); setFormError(''); setShowForm(true); };
  const openEdit = (em: Employee) => {
    setForm({
      id: em.id, version: em.version,
      firstName: em.firstName, lastName: em.lastName, position: em.position,
      phone: em.phone || '', email: em.email || '', nationalId: em.nationalId || '',
      city: em.city || '', hireDate: em.hireDate ? em.hireDate.slice(0, 10) : today(),
      salary: em.salary ? String(toDisplay(em.salary)) : '0',
      employmentStatus: em.employmentStatus, notes: em.notes || '', isActive: em.isActive ?? true,
    });
    setFormError('');
    setShowForm(true);
  };

  const validate = (f: FormState) => {
    if (f.firstName.trim().length < 2) return t('emp.valFirst');
    if (f.lastName.trim().length < 2) return t('emp.valLast');
    return '';
  };

  const payloadFrom = (f: FormState) => ({
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    position: f.position as Employee['position'],
    phone: f.phone.trim() || null,
    email: f.email.trim() || null,
    nationalId: f.nationalId.trim().toUpperCase() || null,
    city: f.city.trim() || null,
    hireDate: new Date((f.hireDate || today()) + 'T00:00:00').toISOString(),
    salary: Math.max(0, toBif(parseFloat(f.salary || '0') || 0)),
    employmentStatus: f.employmentStatus as Employee['employmentStatus'],
    notes: f.notes.trim() || null,
    isActive: f.isActive,
    deviceId: getDeviceId(),
  });

  const saveEmployee = async () => {
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
    await localDB.employees.put(localRow);
    await localDB.addToSyncQueue({
      entityType: 'Employee',
      entityId: id,
      operation: form.id ? 'UPDATE' : 'CREATE',
      data: { id, ...payload },
      clientVersion: form.version,
      deviceId: getDeviceId(),
    } as any);

    try {
      const saved = form.id
        ? await apiClient.put<Employee>(`/employees/${form.id}`, payload)
        : await apiClient.post<Employee>('/employees', payload);
      await localDB.employees.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.status === 'PENDING').toArray();
      await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
      setNotice(t('emp.saved'));
      setShowForm(false);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('emp.offline'));
        setShowForm(false);
        await syncEngine.sync().catch(() => undefined);
      } else if (msg.includes('409') || msg.includes('Conflict')) {
        setNotice(msg.includes('already exists') ? t('emp.failed') : msg);
        setShowForm(false);
      } else {
        setFormError(msg);
        setNotice(msg || t('emp.failed'));
      }
    } finally {
      setSaving(false);
      loadEmployees();
    }
  };

  const deleteEmployee = async (em: Employee) => {
    if (!window.confirm(t('emp.delConfirm', { name: `${em.firstName} ${em.lastName}` }))) return;
    try {
      await apiClient.delete(`/employees/${em.id}`);
      await localDB.employees.delete(em.id);
      setNotice(t('emp.deleted'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.employees.delete(em.id);
        await localDB.addToSyncQueue({ entityType: 'Employee', entityId: em.id, operation: 'DELETE', data: { id: em.id }, deviceId: getDeviceId() } as any);
        setNotice(t('emp.delOffline'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      loadEmployees();
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#C1272D]/30 focus:border-[#C1272D] bg-white';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('emp.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('emp.sub')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${
            source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
          }`}>
            {source === 'cloud' ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
            {source === 'cloud' ? t('c.cloudCache') : t('c.offlineData')}
          </span>
          <button onClick={loadEmployees} className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors" title={t('c.reload')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canManage && (
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t('emp.new')}
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><UserCog className="w-3.5 h-3.5" /> {t('emp.statsTotal')}</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{stats.total}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('emp.statsActive')}</div>
          <div className="text-xl font-bold text-green-600 mt-0.5">{stats.active}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('emp.statsLeave')}</div>
          <div className="text-xl font-bold text-amber-600 mt-0.5">{stats.onLeave}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('emp.statsPayroll')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{fmtMoney(stats.payrollMonth)}</div>
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('emp.searchPh')} className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['', ...EMP_STATUSES].map(st => (
            <button key={st || 'all'} onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === st ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {st === '' ? t('po.all') : t('emp.st.' + st)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('emp.colName')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('emp.colPosition')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('emp.colContact')}</th>
                <th className="px-4 py-3 font-medium">{t('c.status')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('emp.colHire')}</th>
                <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">{t('emp.colSalary')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">{t('sup.emptyA')}{canManage ? ' ' + t('sup.emptyB').toLowerCase() : ''}</td></tr>
              )}
              {filtered.map(em => (
                <tr key={em.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center flex-shrink-0 text-xs font-bold bg-gradient-to-br ${em.isActive ? 'from-[#1A1A2E] to-[#3a3a5e]' : 'from-gray-400 to-gray-500'}`}>
                        {(em.firstName[0] || '')}{(em.lastName[0] || '')}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{em.firstName} {em.lastName}</div>
                        <div className="text-[11px] text-gray-400">{em.city || '—'}{!em.isActive && ' · ' + t('c.inactive')}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 hidden md:table-cell">{t('emp.pos.' + em.position)}</td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {em.phone || '—'}
                    {em.email && <div className="text-[11px] text-gray-400">{em.email}</div>}
                  </td>
                  <td className="px-4 py-3">{statusChip(em.employmentStatus)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap hidden md:table-cell">{(em.hireDate || '').slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap hidden lg:table-cell">
                    <span className="inline-flex items-center gap-1"><Banknote className="w-3.5 h-3.5 text-gray-400" />{fmtMoney(em.salary)}</span>
                  </td>
                  <td className="px-4 py-3">{syncChip((em as any).syncStatus || 'SYNCED')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && (
                        <>
                          <button onClick={() => openEdit(em)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title={t('c.edit')}>
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteEmployee(em)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('c.delete')}>
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
          <span>{t('emp.nStaff', { n: filtered.length })}{source === 'local' ? ' ' + t('sale.localNote') : ''}</span>
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
              <h2 className="font-bold text-gray-900">{form.id ? t('emp.editTitle') : t('emp.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.firstName')}</label>
                <input className={inputCls} {...field('firstName')} placeholder="Dieudonné" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.lastName')}</label>
                <input className={inputCls} {...field('lastName')} placeholder="Havyarimana" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.position')}</label>
                <select className={inputCls} {...field('position')}>
                  {POSITIONS.map(p => <option key={p} value={p}>{t('emp.pos.' + p)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.status')}</label>
                <select className={inputCls} {...field('employmentStatus')}>
                  {EMP_STATUSES.map(st => <option key={st} value={st}>{t('emp.st.' + st)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.phone')}</label>
                <input className={inputCls} {...field('phone')} placeholder="+257 7X XXX XXX" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.email')}</label>
                <input className={inputCls} type="email" {...field('email')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.nationalId')}</label>
                <input className={inputCls + ' font-mono uppercase'} {...field('nationalId')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.city')}</label>
                <input className={inputCls} {...field('city')} placeholder="Gitega" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.hireDate')}</label>
                <input className={inputCls} type="date" {...field('hireDate')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('emp.salary', { cur: curLabel })}</label>
                <input className={inputCls} type="number" min="0" step="any" {...field('salary')} />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 accent-[#C1272D]" />
                  {t('emp.active')}
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('c.notes')}</label>
                <textarea className={inputCls} rows={3} {...field('notes')} placeholder={t('emp.notesPh')} />
              </div>

              {formError && (
                <div className="sm:col-span-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={saveEmployee} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">
                {saving ? t('c.saving') : form.id ? t('c.saveChanges') : t('emp.new')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
