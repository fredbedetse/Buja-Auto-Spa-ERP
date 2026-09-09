import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, RefreshCw, Cloud, CloudOff, Eye, Trash2,
  CheckCircle, Clock, AlertTriangle, Minus, PackageCheck,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import type { Purchase, Supplier, Product } from '../types';

const fmtDate = (d: string) => new Date(d).toLocaleDateString(useUiStore.getState().language === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const statusChip = (status: string) => {
  if (status === 'DRAFT') return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">{tNow('po.draft')}</span>;
  if (status === 'CANCELLED') return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">{tNow('po.cancelled')}</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700 border border-green-200">{tNow('po.received')}</span>;
};

const syncChip = (status?: string) => {
  switch (status) {
    case 'PENDING':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow-50 text-yellow-700 border border-yellow-200"><Clock className="w-3 h-3" /> {tNow('c.pending')}</span>;
    case 'FAILED':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200"><AlertTriangle className="w-3 h-3" /> {tNow('c.failed')}</span>;
    case 'CONFLICT':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-50 text-orange-700 border border-orange-200"><AlertTriangle className="w-3 h-3" /> {tNow('c.conflict')}</span>;
    default:
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700 border border-green-200"><CheckCircle className="w-3 h-3" /> {tNow('c.synced')}</span>;
  }
};

type LineDraft = { productId: string; productName: string; sku: string; unitPrice: number; quantity: number; lineTotal: number; lastBuy: number };

export default function PurchasesPage() {
  const { t } = useT();
  const { fmt: fmtBif, toBif, toDisplay, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canCreate = hasPermission('purchases:read') || hasPermission('purchases:manage');
  const canManage = hasPermission('purchases:manage');

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierQuery, setSupplierQuery] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [receivedNow, setReceivedNow] = useState(true);
  const [discount, setDiscount] = useState('0');
  const [payment, setPayment] = useState<'CASH' | 'CARD' | 'MOBILE_MONEY' | 'LOAN' | 'CREDIT_30'>('CASH');
  const [paid, setPaid] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [notes, setNotes] = useState('');
  const [viewing, setViewing] = useState<Purchase | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [poRes, supRes, prodRes] = await Promise.allSettled([
        apiClient.get<{ data: Purchase[] }>('/purchases?limit=200'),
        apiClient.get<{ data: Supplier[] }>('/suppliers?limit=300'),
        apiClient.get<{ data: Product[] }>('/inventory?limit=300'),
      ]);

      if (poRes.status === 'fulfilled') {
        const dirty = await localDB.purchases.filter(p => (p as any)._dirty).toArray();
        const dirtyIds = new Set(dirty.map(p => p.id));
        for (const p of poRes.value.data) {
          if (!dirtyIds.has(p.id)) await localDB.purchases.put({ ...p, syncStatus: 'SYNCED', _dirty: false } as any);
        }
        setPurchases([...poRes.value.data.filter(p => !dirtyIds.has(p.id)), ...dirty].sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || '')));
        setSource('cloud');
      } else {
        throw poRes.reason;
      }

      if (supRes.status === 'fulfilled') {
        for (const s of supRes.value.data) await localDB.suppliers.put({ ...s, syncStatus: 'SYNCED' } as any);
        setSuppliers(supRes.value.data);
      } else {
        setSuppliers(await localDB.suppliers.filter(s => !s.isDeleted).toArray());
      }

      if (prodRes.status === 'fulfilled') {
        for (const p of prodRes.value.data) await localDB.inventory.put({ ...p, syncStatus: 'SYNCED' } as any);
        setProducts(prodRes.value.data);
      } else {
        setProducts(await localDB.inventory.filter(p => !p.isDeleted).toArray());
      }
    } catch (err: any) {
      const cached = await localDB.purchases.filter(p => !p.isDeleted).toArray();
      setPurchases(cached.sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || '')));
      setSuppliers(await localDB.suppliers.filter(s => !s.isDeleted).toArray());
      setProducts(await localDB.inventory.filter(p => !p.isDeleted).toArray());
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
    return purchases.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (!q) return true;
      return p.poNumber.toLowerCase().includes(q) || p.supplierName.toLowerCase().includes(q) || (p.invoiceRef || '').toLowerCase().includes(q);
    });
  }, [purchases, search, statusFilter]);

  const stats = useMemo(() => {
    const received = purchases.filter(p => p.status === 'RECEIVED');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      count: purchases.length,
      spendToday: received.filter(p => new Date(p.orderDate) >= today).reduce((s, p) => s + (p.total || 0), 0),
      spendMonth: received.filter(p => new Date(p.orderDate) >= monthStart).reduce((s, p) => s + (p.total || 0), 0),
      owed: received.reduce((s, p) => s + (p.balance || 0), 0),
    };
  }, [purchases]);

  // ---- New purchase helpers ----
  const resetForm = () => {
    setSupplierId(''); setSupplierQuery(''); setLines([]); setProductQuery('');
    setReceivedNow(true); setDiscount('0'); setPayment('CASH'); setPaid('');
    setInvoiceRef(''); setNotes(''); setFormError('');
  };
  const openNew = () => { resetForm(); setShowForm(true); };

  const supplierMatches = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase();
    if (!supplierId) {
      const list = q ? suppliers.filter(s => s.name.toLowerCase().includes(q) || s.phone.includes(q)) : suppliers;
      return list.slice(0, 6);
    }
    return [];
  }, [supplierQuery, suppliers, supplierId]);

  const productMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(p => p.isActive && (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [productQuery, products]);

  const addProduct = (p: Product) => {
    setLines(prev => {
      const idx = prev.findIndex(l => l.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1, lineTotal: (next[idx].quantity + 1) * next[idx].unitPrice };
        return next;
      }
      return [...prev, { productId: p.id, productName: p.name, sku: p.sku, unitPrice: p.purchasePrice, quantity: 1, lineTotal: p.purchasePrice, lastBuy: p.purchasePrice }];
    });
    setProductQuery('');
  };

  const changeQty = (productId: string, delta: number) => {
    setLines(prev => prev.map(l => (l.productId === productId ? { ...l, quantity: Math.max(1, l.quantity + delta), lineTotal: Math.max(1, l.quantity + delta) * l.unitPrice } : l)));
  };

  const changeCost = (productId: string, displayValue: string) => {
    const num = Math.max(0, parseFloat(displayValue || '0') || 0);
    const bif = toBif(num);
    setLines(prev => prev.map(l => (l.productId === productId ? { ...l, unitPrice: bif, lineTotal: bif * l.quantity } : l)));
  };

  const removeLine = (productId: string) => setLines(prev => prev.filter(l => l.productId !== productId));

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const disc = Math.min(Math.max(0, toBif(parseFloat(discount || '0') || 0)), subtotal);
  const total = subtotal - disc;
  const paidNum = payment === 'CREDIT_30' && paid === '' ? 0 : paid === '' ? total : Math.max(0, toBif(parseFloat(paid) || 0));
  const balance = Math.max(0, total - Math.min(paidNum, total));

  const savePurchase = async () => {
    setFormError('');
    if (!supplierId) { setFormError(t('po.selectSup')); return; }
    if (!lines.length) { setFormError(t('sale.addLine')); return; }

    setSaving(true);
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const payload = {
      id,
      poNumber: `TMP-${id.slice(0, 8).toUpperCase()}`,
      supplierId,
      orderDate: nowIso,
      status: receivedNow ? 'RECEIVED' : 'DRAFT',
      paymentMethod: payment,
      invoiceRef: invoiceRef.trim() || null,
      discount: disc,
      taxRate: 0,
      paidAmount: payment === 'CREDIT_30' && paid === '' ? 0 : paid === '' ? total : paidNum,
      notes: notes.trim() || null,
      deviceId: getDeviceId(),
      items: lines.map(l => ({ productId: l.productId, productName: l.productName, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice })),
    };

    const supplier = suppliers.find(s => s.id === supplierId);
    const localPurchase: any = {
      id,
      poNumber: payload.poNumber,
      supplierId,
      supplierName: supplier?.name || 'Supplier',
      orderDate: nowIso,
      status: payload.status,
      paymentMethod: payment,
      invoiceRef: payload.invoiceRef,
      subtotal, discount: disc, taxRate: 0, taxAmount: 0, total,
      paidAmount: Math.min(paidNum, total),
      balance,
      notes: payload.notes,
      version: 1,
      createdAt: nowIso, updatedAt: nowIso,
      items: lines.map((l, i) => ({ id: `${id}-l${i}`, productId: l.productId, productName: l.productName, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.unitPrice * l.quantity })),
      syncStatus: 'PENDING',
      _dirty: true,
    };

    try {
      await localDB.purchases.put(localPurchase);
      await localDB.addToSyncQueue({ entityType: 'Purchase', entityId: id, operation: 'CREATE', data: payload, deviceId: getDeviceId() } as any);

      const saved = await apiClient.post<Purchase>('/purchases', payload);
      await localDB.purchases.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.entityType === 'Purchase' && i.status === 'PENDING').toArray();
      await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
      setNotice(t('po.recorded', { po: saved.poNumber }));
      setShowForm(false);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('po.offline'));
        setShowForm(false);
      } else if (msg.includes('409') || msg.toLowerCase().includes('supplier')) {
        setNotice(t('po.conflictNote', { msg }));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setFormError(msg || t('sale.keptLocal'));
        setNotice(msg || t('sale.keptLocal'));
      }
    } finally {
      setSaving(false);
      load();
    }
  };

  const cancelPurchase = async (p: Purchase) => {
    if (!window.confirm(t('po.cancelConfirm', { po: p.poNumber }))) return;
    try {
      await apiClient.delete(`/purchases/${p.id}`);
      await localDB.purchases.delete(p.id);
      setNotice(t('po.cancelledOk'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.purchases.delete(p.id);
        await localDB.addToSyncQueue({ entityType: 'Purchase', entityId: p.id, operation: 'DELETE', data: { id: p.id }, deviceId: getDeviceId() } as any);
        setNotice(t('po.delOffline'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg); // includes 409 CANCEL_WOULD_NEGATE_STOCK message from the server
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
          <h1 className="text-2xl font-bold text-gray-900">{t('po.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('po.sub')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${
            source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
          }`}>
            {source === 'cloud' ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
            {source === 'cloud' ? t('sale.cloudLocal') : t('sale.localData')}
          </span>
          <button onClick={load} className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50" title={t('c.reload')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canCreate && (
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t('po.new')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('po.spendToday')}</div>
          <div className="text-lg font-bold text-gray-900 mt-0.5">{fmtBif(stats.spendToday)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('po.spendMonth')}</div>
          <div className="text-lg font-bold text-gray-900 mt-0.5">{fmtBif(stats.spendMonth)}</div>
        </div>
        <div className={`bg-white rounded-2xl border px-4 py-3 ${stats.owed > 0 ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><AlertTriangle className="w-3.5 h-3.5 text-red-500" /> {t('po.owed')}</div>
          <div className="text-lg font-bold text-red-600 mt-0.5">{fmtBif(stats.owed)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><PackageCheck className="w-3.5 h-3.5" /> {t('po.count')}</div>
          <div className="text-lg font-bold text-gray-900 mt-0.5">{stats.count}</div>
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('po.searchPh')} className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white" />
        </div>
        <div className="flex gap-1.5">
          {['', 'RECEIVED', 'DRAFT'].map(st => (
            <button key={st || 'all'} onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === st ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {st === '' ? t('po.all') : st === 'RECEIVED' ? t('po.received') : t('po.draft')}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('po.colPo')}</th>
                <th className="px-4 py-3 font-medium">{t('po.colSupplier')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('sale.colDate')}</th>
                <th className="px-4 py-3 font-medium">{t('c.status')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.total')}</th>
                <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">{t('po.colBalance')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">{t('po.empty')}{canCreate ? t('po.start') : ''}</td></tr>
              )}
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.poNumber}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{p.supplierName}</td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{fmtDate(p.orderDate)}</td>
                  <td className="px-4 py-3">{statusChip(p.status)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtBif(p.total)}</td>
                  <td className={`px-4 py-3 text-right whitespace-nowrap hidden lg:table-cell ${p.balance > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                    {p.balance > 0 ? fmtBif(p.balance) : '—'}
                  </td>
                  <td className="px-4 py-3">{syncChip((p as any).syncStatus || 'SYNCED')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setViewing(p)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title={t('po.view')}>
                        <Eye className="w-4 h-4" />
                      </button>
                      {canManage && (
                        <button onClick={() => cancelPurchase(p)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('po.cancelBtn')}>
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
          <span>{t('po.nOrders', { n: filtered.length })}{source === 'local' ? ' ' + t('sale.localNote') : ''}</span>
          <button onClick={() => syncEngine.sync()} className="flex items-center gap-1 text-[#C1272D] font-medium hover:underline">
            <RefreshCw className="w-3 h-3" /> {t('sale.syncNow')}
          </button>
        </div>
      </div>

      {/* New purchase modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-900">{t('po.title')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-5">
              {/* Supplier */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('po.supplier')}</label>
                {supplierId ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#C1272D]/5 border border-[#C1272D]/30 text-sm">
                    <span className="font-medium text-gray-900">{suppliers.find(s => s.id === supplierId)?.name}</span>
                    <button onClick={() => setSupplierId('')} className="text-gray-400 hover:text-gray-600 text-xs">{t('sale.change')}</button>
                  </div>
                ) : (
                  <div className="relative">
                    <input className={inputCls} value={supplierQuery} onChange={e => setSupplierQuery(e.target.value)} placeholder={t('po.supPh')} />
                    {supplierMatches.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {supplierMatches.map(s => (
                          <button key={s.id} onClick={() => { setSupplierId(s.id); setSupplierQuery(''); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
                            <span className="font-medium text-gray-900">{s.name}</span> <span className="text-gray-400 text-xs">{s.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Product picker */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('po.addProducts')}</label>
                <div className="relative">
                  <input className={inputCls} value={productQuery} onChange={e => setProductQuery(e.target.value)} placeholder={t('po.prodPh')} />
                  {productMatches.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                      {productMatches.map(p => (
                        <button key={p.id} onClick={() => addProduct(p)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm flex items-center justify-between">
                          <span>
                            <span className="font-medium text-gray-900">{p.name}</span>
                            <span className="text-gray-400 text-xs ml-2">{p.sku}</span>
                          </span>
                          <span className="text-xs text-gray-500">{t('po.buyPrice', { price: fmtBif(p.purchasePrice) })}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Lines with editable unit cost */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                      <th className="px-3 py-2 font-medium">{t('sale.colItem')}</th>
                      <th className="px-3 py-2 font-medium w-32">{t('sale.colQty')}</th>
                      <th className="px-3 py-2 font-medium w-32">{t('po.colCost')} ({curLabel})</th>
                      <th className="px-3 py-2 font-medium text-right w-28">{t('c.total')}</th>
                      <th className="px-2 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-xs">{t('po.noLines')}</td></tr>}
                    {lines.map(l => (
                      <tr key={l.productId} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 text-sm leading-tight">{l.productName}</div>
                          <div className="text-[11px] text-gray-400">{l.sku}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => changeQty(l.productId, -1)} className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50"><Minus className="w-3 h-3" /></button>
                            <span className="w-6 text-center font-medium">{l.quantity}</span>
                            <button onClick={() => changeQty(l.productId, 1)} className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50"><Plus className="w-3 h-3" /></button>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="any"
                            defaultValue={toDisplay(l.unitPrice)}
                            key={`cost-${l.productId}`}
                            onChange={e => changeCost(l.productId, e.target.value)}
                            className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#C1272D]/30"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{fmtBif(l.unitPrice * l.quantity)}</td>
                        <td className="px-2 py-2 text-right">
                          <button onClick={() => removeLine(l.productId)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Status + payment */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setReceivedNow(true); if (payment === 'CREDIT_30') setPaid(''); }}
                  className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${receivedNow ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  <PackageCheck className="w-4 h-4 inline mr-1.5 -mt-0.5" />{t('po.receivedNow')}
                </button>
                <button
                  onClick={() => { setReceivedNow(false); setPayment('CREDIT_30'); }}
                  className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${!receivedNow ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {t('po.orderDraft')}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('sale.discount', { cur: curLabel })}</label>
                  <input className={inputCls} type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('sale.payment')}</label>
                  <select className={inputCls} value={payment} onChange={e => setPayment(e.target.value as any)}>
                    <option value="CASH">{t('sale.pay.cash')}</option>
                    <option value="CARD">{t('sale.pay.card')}</option>
                    <option value="MOBILE_MONEY">{t('sale.pay.momo')}</option>
                    <option value="LOAN">{t('sale.pay.loan')}</option>
                    <option value="CREDIT_30">{t('po.pay.credit')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('sale.paid', { cur: curLabel })}</label>
                  <input className={inputCls} type="number" min="0" value={paid} onChange={e => setPaid(e.target.value)} placeholder={String(toDisplay(payment === 'CREDIT_30' ? 0 : total))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('po.invoiceRef')}</label>
                  <input className={inputCls} value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder={t('po.invoiceRefPh')} />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('c.notes')}</label>
                <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('sale.optional')} />
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-8 text-gray-500"><span>{t('sale.subtotal')}</span><span>{fmtBif(subtotal)}</span></div>
                  <div className="flex justify-between gap-8 text-gray-500"><span>{t('sale.discountW')}</span><span>- {fmtBif(disc)}</span></div>
                  <div className="flex justify-between gap-8 text-gray-500"><span>{t('sale.paidW')}</span><span>{fmtBif(Math.min(paidNum, total))}</span></div>
                  <div className="flex justify-between gap-8 text-gray-600"><span>{t('sale.balanceDue')}</span><span className={balance > 0 ? 'text-red-600 font-semibold' : ''}>{fmtBif(balance)}</span></div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">{t('c.total')}</div>
                  <div className="text-2xl font-bold text-gray-900">{fmtBif(total)}</div>
                </div>
              </div>

              {formError && (
                <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={savePurchase} disabled={saving || !lines.length} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-50 text-white text-sm font-medium">
                {saving ? t('c.saving') : t('po.record')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View purchase modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <div className="font-mono text-xs text-gray-400">{viewing.poNumber}{viewing.invoiceRef ? ` · ${viewing.invoiceRef}` : ''}</div>
                <h2 className="font-bold text-gray-900">{viewing.supplierName}</h2>
              </div>
              <button onClick={() => setViewing(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                {statusChip(viewing.status)}
                <span>{fmtDate(viewing.orderDate)}</span>
                <span>·</span>
                <span>{viewing.paymentMethod.replace('_', ' ')}</span>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400"><th className="px-3 py-2">{t('sale.colItem')}</th><th className="px-3 py-2 text-right">{t('sale.colQty')}</th><th className="px-3 py-2 text-right">{t('c.total')}</th></tr></thead>
                  <tbody>
                    {(viewing.items || []).map((li, idx) => (
                      <tr key={li.id || idx} className="border-t border-gray-100">
                        <td className="px-3 py-2">{li.productName}<div className="text-[11px] text-gray-400">{fmtBif(li.unitPrice)}</div></td>
                        <td className="px-3 py-2 text-right">{li.quantity}</td>
                        <td className="px-3 py-2 text-right">{fmtBif(li.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between text-gray-500"><span>{t('sale.subtotal')}</span><span>{fmtBif(viewing.subtotal)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between text-gray-500"><span>{t('sale.discountW')}</span><span>- {fmtBif(viewing.discount)}</span></div>}
                <div className="flex justify-between font-bold text-gray-900"><span>{t('c.total')}</span><span>{fmtBif(viewing.total)}</span></div>
                <div className="flex justify-between text-gray-500"><span>{t('sale.paidW')}</span><span>{fmtBif(viewing.paidAmount)}</span></div>
                <div className={`flex justify-between ${viewing.balance > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}><span>{t('po.colBalance')}</span><span>{fmtBif(viewing.balance)}</span></div>
              </div>
              {viewing.notes && <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-3">{viewing.notes}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
