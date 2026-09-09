import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, RefreshCw, Cloud, CloudOff, Ban,
  CheckCircle, Clock, AlertTriangle, CreditCard,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';
import type { Payment, Invoice } from '../types';

const METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;

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

const moneyCell = (s: string | number | null | undefined, extra = '') => (
  <span className={`whitespace-nowrap ${extra}`}>{s === null || s === undefined || s === '' ? '—' : s}</span>
);

type PayForm = {
  saleId: string;
  amount: string; // display currency
  paymentMethod: string;
  paymentDate: string;
  reference: string;
  notes: string;
};

export default function PaymentsPage() {
  const { t } = useT();
  const { fmt: fmtMoney, toBif, toDisplay, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission('payments:manage');

  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stats, setStats] = useState({ total: 0, receivedToday: 0, receivedMonth: 0, receivedAll: 0, outstandingAll: 0 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PayForm>({ saleId: '', amount: '', paymentMethod: 'CASH', paymentDate: new Date().toISOString().slice(0, 10), reference: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: Payment[]; pagination: any }>('/payments?limit=200&includeVoid=true');
      for (const pm of res.data) await localDB.payments.put({ ...pm, syncStatus: 'SYNCED', _dirty: false } as any);
      setPayments(res.data);
      setSource('cloud');
      setNotice(n => (n === t('pay.offline') ? '' : n));
      try {
        const inv = await apiClient.get<{ data: Invoice[] }>('/invoices?limit=200');
        setInvoices(inv.data);
        for (const iv of inv.data) await localDB.invoices.put({ ...iv, syncStatus: 'SYNCED', _dirty: false } as any);
        const st = await apiClient.get<any>('/payments/stats');
        setStats(st);
      } catch { /* picker/stats keep previous */ }
    } catch (err: any) {
      const cached = await localDB.payments.toArray();
      setPayments(cached);
      let localInv = await localDB.invoices.toArray();
      if (localInv.length === 0) {
        localInv = (await localDB.sales.filter((s: any) => s.status === 'COMPLETED' && (s.balance ?? 0) > 0).toArray()) as any;
      }
      setInvoices(localInv as any);
      setSource('local');
      if (!String(err.message).includes('OFFLINE')) setNotice(err.message);
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

  const openInvoices = useMemo(() => invoices.filter(i => i.status === 'COMPLETED' && (i.balance ?? 0) > 0), [invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter(pm => {
      if (statusFilter === 'VOID' && pm.status !== 'VOID') return false;
      if (statusFilter === 'COMPLETED' && pm.status !== 'COMPLETED') return false;
      if (!q) return true;
      return (pm.paymentNo || '').toLowerCase().includes(q) ||
        (pm.saleInvoiceNo || '').toLowerCase().includes(q) ||
        (pm.customerName || '').toLowerCase().includes(q) ||
        (pm.reference || '').toLowerCase().includes(q);
    });
  }, [payments, search, statusFilter]);

  const selInvoice = useMemo(() => openInvoices.find(i => i.id === form.saleId) || null, [openInvoices, form.saleId]);

  const field = (key: keyof PayForm) => ({
    value: (form as any)[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const openCreate = () => {
    setForm({ saleId: openInvoices[0]?.id || '', amount: openInvoices[0] ? String(toDisplay(openInvoices[0].balance)) : '', paymentMethod: 'CASH', paymentDate: new Date().toISOString().slice(0, 10), reference: '', notes: '' });
    setFormError('');
    setShowForm(true);
  };

  const savePayment = async () => {
    if (!form.saleId) { setFormError(t('pay.valInvoice')); return; }
    const amountBif = toBif(parseFloat(form.amount || '0') || 0);
    if (amountBif <= 0) { setFormError(t('pay.valAmount')); return; }
    if (selInvoice && amountBif > (selInvoice.balance || 0) + 0.5) { setFormError(t('pay.exceeds')); return; }
    setSaving(true);
    setFormError('');

    const id = crypto.randomUUID();
    const payload: any = {
      id,
      saleId: form.saleId,
      amount: amountBif,
      paymentMethod: form.paymentMethod,
      paymentDate: new Date(form.paymentDate + 'T00:00:00').toISOString(),
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
      deviceId: getDeviceId(),
    };
    const localRow: any = {
      ...payload,
      paymentNo: `TMP-${id.slice(0, 8).toUpperCase()}`,
      saleInvoiceNo: selInvoice?.invoiceNo || null,
      customerName: selInvoice?.customerName || null,
      status: 'COMPLETED',
      version: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING', _dirty: true,
    };
    await localDB.payments.put(localRow);
    await localDB.addToSyncQueue({ entityType: 'Payment', entityId: id, operation: 'CREATE', data: payload, deviceId: getDeviceId() } as any);

    try {
      const saved = await apiClient.post<Payment>('/payments', payload);
      await localDB.payments.put({ ...localRow, ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.status === 'PENDING').toArray();
      await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
      setNotice(t('pay.saved'));
      setShowForm(false);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('pay.offline'));
        setShowForm(false);
        await syncEngine.sync().catch(() => undefined);
      } else if (msg.includes('409') || msg.includes('400') || msg.includes('Exceeds') || msg.includes('exceeds')) {
        await localDB.payments.delete(id);
        const queued = await localDB.syncQueue.where('entityId').equals(id).toArray();
        await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
        setFormError(msg.includes('balance') ? t('pay.exceeds') : msg);
      } else {
        setFormError(msg);
      }
    } finally {
      setSaving(false);
      load();
    }
  };

  const voidPayment = async (pm: Payment) => {
    if (!window.confirm(t('pay.voidConfirm', { no: pm.paymentNo, amt: fmtMoney(pm.amount) }))) return;
    try {
      await apiClient.delete(`/payments/${pm.id}`);
      await localDB.payments.update(pm.id, { status: 'VOID', syncStatus: 'SYNCED' } as any);
      setNotice(t('pay.voidedMsg'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.payments.update(pm.id, { status: 'VOID', _dirty: true, syncStatus: 'PENDING' } as any);
        await localDB.addToSyncQueue({ entityType: 'Payment', entityId: pm.id, operation: 'DELETE', data: { id: pm.id }, deviceId: getDeviceId() } as any);
        setNotice(t('pay.offline'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      load();
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#C1272D]/30 focus:border-[#C1272D] bg-white';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('pay.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('pay.sub')}</p>
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
              <Plus className="w-4 h-4" /> {t('pay.new')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('pay.statsToday')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{fmtMoney(stats.receivedToday)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('pay.statsMonth')}</div>
          <div className="text-lg font-bold text-green-600 mt-1">{fmtMoney(stats.receivedMonth)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('pay.statsAll')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{fmtMoney(stats.receivedAll)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><CreditCard className="w-3.5 h-3.5" /> {t('pay.statsOutstanding')}</div>
          <div className="text-lg font-bold text-[#C1272D] mt-1">{fmtMoney(stats.outstandingAll)}</div>
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('pay.searchPh')} className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['', 'COMPLETED', 'VOID'].map(st => (
            <button key={st || 'all'} onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === st ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {st === '' ? t('po.all') : st === 'VOID' ? t('pay.voided') : t('pay.completed')}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('pay.colReceipt')}</th>
                <th className="px-4 py-3 font-medium">{t('pay.colInvoice')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('pay.colCustomer')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('pay.colMethod')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('pay.colDate')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('pay.colAmount')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">{t('pay.empty')}</td></tr>
              )}
              {filtered.map(pm => (
                <tr key={pm.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/60 ${pm.status === 'VOID' ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-mono font-semibold text-gray-900 text-[13px]">
                    {pm.paymentNo}
                    {pm.status === 'VOID' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{t('pay.voided')}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-700 text-[13px]">{pm.saleInvoiceNo || '—'}</td>
                  <td className="px-4 py-3 text-gray-700 hidden md:table-cell">{pm.customerName || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{t('pay.method.' + pm.paymentMethod)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap hidden md:table-cell">{(pm.paymentDate || '').slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{moneyCell(fmtMoney(pm.amount), pm.status === 'VOID' ? 'line-through' : '')}</td>
                  <td className="px-4 py-3">{syncChip((pm as any).syncStatus || 'SYNCED')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && pm.status !== 'VOID' && (
                        <button onClick={() => voidPayment(pm)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('pay.void')}>
                          <Ban className="w-4 h-4" />
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
          <span>{t('pay.nReceipts', { n: filtered.length })}{source === 'local' ? ' ' + t('sale.localNote') : ''}</span>
          <button onClick={() => syncEngine.sync()} className="flex items-center gap-1 text-[#C1272D] font-medium hover:underline">
            <RefreshCw className="w-3 h-3" /> {t('c.syncNow')}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">{t('pay.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.invoice')}</label>
                <select
                  className={inputCls}
                  value={form.saleId}
                  onChange={e => {
                    const inv = openInvoices.find(i => i.id === e.target.value);
                    setForm(f => ({ ...f, saleId: e.target.value, amount: inv ? String(toDisplay(inv.balance)) : f.amount }));
                  }}
                >
                  <option value="">{t('pay.pickInvoice')}</option>
                  {openInvoices.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.invoiceNo} — {i.customerName} · {t('pay.balanceLabel')} {fmtMoney(i.balance)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.amount', { cur: curLabel })}</label>
                  <input className={inputCls} type="number" min="0" step="any" {...field('amount')} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.date')}</label>
                  <input className={inputCls} type="date" {...field('paymentDate')} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.colMethod')}</label>
                  <select className={inputCls} {...field('paymentMethod')}>
                    {METHODS.map(m => <option key={m} value={m}>{t('pay.method.' + m)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.reference')}</label>
                  <input className={inputCls} {...field('reference')} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('c.notes')}</label>
                <textarea className={inputCls} rows={2} {...field('notes')} placeholder={t('pay.notesPh')} />
              </div>
              {formError && (
                <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={savePayment} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">
                {saving ? t('c.saving') : t('pay.new')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
