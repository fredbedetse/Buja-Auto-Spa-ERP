import { useEffect, useMemo, useState } from 'react';
import {
  Search, X, RefreshCw, Cloud, CloudOff, Eye, FileText,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';
import type { Invoice, Payment } from '../types';

const billingChip = (st: string) => {
  const cls: Record<string, string> = {
    PAID: 'bg-green-50 text-green-700 border-green-200',
    PARTIAL: 'bg-sky-50 text-sky-700 border-sky-200',
    UNPAID: 'bg-amber-50 text-amber-700 border-amber-200',
    OVERDUE: 'bg-red-50 text-red-700 border-red-200',
    DRAFT: 'bg-gray-100 text-gray-500 border-gray-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200 line-through',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls[st] || cls.DRAFT}`}>{tNow('bill.billing.' + st)}</span>;
};

type PayForm = { amount: string; paymentMethod: string; paymentDate: string; reference: string };

export default function InvoicesPage() {
  const { t } = useT();
  const { fmt: fmtMoney, toBif, toDisplay, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canCollect = hasPermission('payments:manage');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [billing, setBilling] = useState('');
  const [stats, setStats] = useState({ total: 0, outstanding: 0, overdue: 0, open: 0 });

  const [detail, setDetail] = useState<Invoice | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [payForm, setPayForm] = useState<PayForm>({ amount: '', paymentMethod: 'CASH', paymentDate: new Date().toISOString().slice(0, 10), reference: '' });
  const [payError, setPayError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: Invoice[]; pagination: any }>('/invoices?limit=200');
      setInvoices(res.data);
      setNotice(n => (n === t('pay.offline') ? '' : n));
      for (const iv of res.data) await localDB.invoices.put({ ...iv, syncStatus: 'SYNCED', _dirty: false } as any);
      setSource('cloud');
      try {
        const st = await apiClient.get<any>('/invoices/stats');
        setStats({
          total: st.total ?? 0,
          outstanding: st.outstanding ?? 0,
          overdue: st.byBilling?.OVERDUE ?? 0,
          open: (st.byBilling?.UNPAID ?? 0) + (st.byBilling?.PARTIAL ?? 0) + (st.byBilling?.OVERDUE ?? 0),
        });
      } catch { /* keep previous */ }
      if (detail) {
        try {
          const fresh = await apiClient.get<Invoice>(`/invoices/${detail.id}`);
          setDetail(fresh);
        } catch { /* offline: keep */ }
      }
    } catch (err: any) {
      const cachedInv = await localDB.invoices.toArray();
      if (cachedInv.length > 0) {
        setInvoices(cachedInv as any);
      } else {
        const cached = (await localDB.sales.filter((s: any) => !s.isDeleted).toArray()) as any[];
        setInvoices(cached.map(s => ({ ...s, billingStatus: s.status === 'CANCELLED' ? 'CANCELLED' : s.status === 'DRAFT' ? 'DRAFT' : (s.balance ?? 0) <= 0 ? 'PAID' : (s.paidAmount || 0) > 0 ? 'PARTIAL' : 'UNPAID' })));
      }
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter(iv => {
      if (billing && iv.billingStatus !== billing) return false;
      if (!q) return true;
      return iv.invoiceNo.toLowerCase().includes(q) || (iv.customerName || '').toLowerCase().includes(q);
    });
  }, [invoices, search, billing]);

  const openDetail = async (iv: Invoice) => {
    setDetail(iv);
    try {
      const fresh = await apiClient.get<Invoice>(`/invoices/${iv.id}`);
      setDetail(fresh);
    } catch { /* show cached row */ }
  };

  const startPay = () => {
    if (!detail) return;
    setPayForm({ amount: String(toDisplay(detail.balance || 0)), paymentMethod: detail.paymentMethod || 'CASH', paymentDate: new Date().toISOString().slice(0, 10), reference: '' });
    setPayError('');
    setShowPay(true);
  };

  const submitPay = async () => {
    if (!detail) return;
    const amountBif = toBif(parseFloat(payForm.amount || '0') || 0);
    if (amountBif <= 0) { setPayError(t('pay.valAmount')); return; }
    if (amountBif > (detail.balance || 0) + 0.5) { setPayError(t('pay.exceeds')); return; }
    setSaving(true);
    setPayError('');

    const id = crypto.randomUUID();
    const payload: any = {
      id,
      saleId: detail.id,
      amount: amountBif,
      paymentMethod: payForm.paymentMethod,
      paymentDate: new Date(payForm.paymentDate + 'T00:00:00').toISOString(),
      reference: payForm.reference.trim() || null,
      deviceId: getDeviceId(),
    };
    const localRow: any = {
      ...payload,
      paymentNo: `TMP-${id.slice(0, 8).toUpperCase()}`,
      saleInvoiceNo: detail.invoiceNo,
      customerName: detail.customerName,
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
      setShowPay(false);
      // modal stays open; load() refetches it so the new receipt is visible inside
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('pay.offline'));
        setShowPay(false);
        await syncEngine.sync().catch(() => undefined);
      } else if (msg.includes('409') || msg.includes('400') || msg.toLowerCase().includes('exceed')) {
        await localDB.payments.delete(id);
        const queued = await localDB.syncQueue.where('entityId').equals(id).toArray();
        await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
        setPayError(msg.toLowerCase().includes('balance') || msg.toLowerCase().includes('exceed') ? t('pay.exceeds') : msg);
      } else {
        setPayError(msg);
      }
    } finally {
      setSaving(false);
      load();
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#C1272D]/30 focus:border-[#C1272D] bg-white';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('bill.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('bill.sub')}</p>
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
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><FileText className="w-3.5 h-3.5" /> {t('bill.statsTotal')}</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{stats.total}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('bill.statsOpen')}</div>
          <div className="text-xl font-bold text-sky-600 mt-0.5">{stats.open}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('bill.statsOverdue')}</div>
          <div className="text-xl font-bold text-red-600 mt-0.5">{stats.overdue}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('bill.statsOutstanding')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{fmtMoney(stats.outstanding)}</div>
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('bill.searchPh')} className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['', 'UNPAID', 'PARTIAL', 'OVERDUE', 'PAID'].map(b => (
            <button key={b || 'all'} onClick={() => setBilling(b)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${billing === b ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {b === '' ? t('po.all') : t('bill.billing.' + b)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('bill.colInvoice')}</th>
                <th className="px-4 py-3 font-medium">{t('bill.colCustomer')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('bill.colDate')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('bill.colTotal')}</th>
                <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">{t('bill.colPaid')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('bill.colBalance')}</th>
                <th className="px-4 py-3 font-medium">{t('bill.colBilling')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">{t('bill.empty')}</td></tr>
              )}
              {filtered.map(iv => (
                <tr key={iv.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-mono font-semibold text-gray-900 text-[13px]">{iv.invoiceNo}</td>
                  <td className="px-4 py-3 text-gray-700">{iv.customerName || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap hidden md:table-cell">{(iv.saleDate || '').slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right text-gray-900 font-medium">{fmtMoney(iv.total)}</td>
                  <td className="px-4 py-3 text-right text-gray-600 hidden lg:table-cell">{fmtMoney(iv.paidAmount)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${iv.balance > 0.001 ? 'text-[#C1272D]' : 'text-gray-400'}`}>{fmtMoney(iv.balance)}</td>
                  <td className="px-4 py-3">{billingChip(iv.billingStatus)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openDetail(iv)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title={t('bill.view')}>
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
          <span>{t('bill.nInvoices', { n: filtered.length })}{source === 'local' ? ' ' + t('sale.localNote') : ''}</span>
          <button onClick={() => syncEngine.sync()} className="flex items-center gap-1 text-[#C1272D] font-medium hover:underline">
            <RefreshCw className="w-3 h-3" /> {t('c.syncNow')}
          </button>
        </div>
      </div>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setDetail(null); setShowPay(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">{t('bill.detailTitle', { no: detail.invoiceNo })}</h2>
              <button onClick={() => { setDetail(null); setShowPay(false); }} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div><div className="text-xs text-gray-400">{t('bill.colCustomer')}</div><div className="font-medium text-gray-900">{detail.customerName || '—'}</div></div>
                <div><div className="text-xs text-gray-400">{t('bill.colDate')}</div><div className="font-medium text-gray-900">{(detail.saleDate || '').slice(0, 10)}</div></div>
                <div><div className="text-xs text-gray-400">{t('bill.colBilling')}</div>{billingChip(detail.billingStatus)}</div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">{t('bill.lines')}</div>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead><tr className="bg-gray-50 text-left text-xs text-gray-400">
                      <th className="px-3 py-2">{t('sale.colItem')}</th>
                      <th className="px-3 py-2 text-right">{t('sale.colQty')}</th>
                      <th className="px-3 py-2 text-right">{t('c.total')}</th>
                    </tr></thead>
                    <tbody>
                      {(detail.items || []).map(li => (
                        <tr key={li.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-800">{li.productName}{li.sku ? <span className="text-gray-400"> · {li.sku}</span> : ''}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{li.quantity}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmtMoney(li.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-sm space-y-1">
                <div className="flex justify-between text-gray-600"><span>{t('bill.colTotal')}</span><span className="font-semibold text-gray-900">{fmtMoney(detail.total)}</span></div>
                <div className="flex justify-between text-gray-600"><span>{t('bill.colPaid')}</span><span>{fmtMoney(detail.paidAmount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">{t('bill.colBalance')}</span><span className={`font-bold ${detail.balance > 0.001 ? 'text-[#C1272D]' : 'text-green-600'}`}>{fmtMoney(detail.balance)}</span></div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">{t('bill.receipts')}</div>
                {(detail.payments || []).length === 0 && <div className="text-sm text-gray-400">{t('bill.noReceipts')}</div>}
                <div className="space-y-1">
                  {(detail.payments || []).map(pm => (
                    <div key={pm.id} className="flex items-center justify-between text-[13px] border border-gray-100 rounded-lg px-3 py-2">
                      <span className="font-mono text-gray-700">{pm.paymentNo}{pm.status === 'VOID' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{t('pay.voided')}</span>}</span>
                      <span className="text-gray-500">{t('pay.method.' + pm.paymentMethod)} · {(pm.paymentDate || '').slice(0, 10)}</span>
                      <span className={`font-semibold ${pm.status === 'VOID' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{fmtMoney(pm.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {canCollect && detail.billingStatus !== 'PAID' && detail.billingStatus !== 'CANCELLED' && detail.billingStatus !== 'DRAFT' && (
                <div className="flex justify-end">
                  <button onClick={startPay} className="px-4 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium">{t('bill.recordPayment')}</button>
                </div>
              )}

              {showPay && (
                <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.amount', { cur: curLabel })}</label>
                      <input className={inputCls} type="number" min="0" step="any" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.date')}</label>
                      <input className={inputCls} type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.colMethod')}</label>
                      <select className={inputCls} value={payForm.paymentMethod} onChange={e => setPayForm(f => ({ ...f, paymentMethod: e.target.value }))}>
                        {['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'].map(m => <option key={m} value={m}>{t('pay.method.' + m)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">{t('pay.reference')}</label>
                      <input className={inputCls} value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} />
                    </div>
                  </div>
                  {payError && <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{payError}</div>}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowPay(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium bg-white hover:bg-gray-50">{t('c.cancel')}</button>
                    <button onClick={submitPay} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">{saving ? t('c.saving') : t('bill.recordPayment')}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
