import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, Edit, Trash2, AlertTriangle, CheckCircle, Clock, X,
  RefreshCw, Cloud, CloudOff, Package, Boxes,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { fmtMoneyBif } from '../lib/money';
import { useAuthStore } from '../stores/authStore';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import type { Product, ProductCategory, ProductUnit } from '../types';

const CATEGORIES: ProductCategory[] = ['ENGINE', 'BRAKES', 'ELECTRICAL', 'FLUIDS', 'TYRES', 'BODY', 'ACCESSORIES', 'GENERAL'];
const UNITS: ProductUnit[] = ['PCS', 'LTR', 'KG', 'SET', 'BOX'];

const catColors: Record<string, string> = {
  ENGINE: 'bg-red-50 text-red-700 border-red-200',
  BRAKES: 'bg-blue-50 text-blue-700 border-blue-200',
  ELECTRICAL: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  FLUIDS: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  TYRES: 'bg-gray-100 text-gray-700 border-gray-300',
  BODY: 'bg-purple-50 text-purple-700 border-purple-200',
  ACCESSORIES: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  GENERAL: 'bg-amber-50 text-amber-700 border-amber-200',
};

const fmtBif = (n: number, currency: 'bif' | 'usd') => fmtMoneyBif(n, currency);

type FormState = {
  id?: string;
  version?: number;
  name: string;
  sku: string;
  category: ProductCategory;
  unit: ProductUnit;
  stockQuantity: string;
  reorderLevel: string;
  purchasePrice: string;
  sellingPrice: string;
  supplierName: string;
  location: string;
  description: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  name: '', sku: '', category: 'GENERAL', unit: 'PCS',
  stockQuantity: '0', reorderLevel: '5', purchasePrice: '0', sellingPrice: '0',
  supplierName: '', location: '', description: '', isActive: true,
};

const syncChip = (status?: string) => {
  switch (status) {
    case 'PENDING':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow-50 text-yellow-700 border border-yellow-200"><Clock className="w-3 h-3" /> {tNow('c.pending')}</span>;
    case 'FAILED':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200"><AlertTriangle className="w-3 h-3" /> {tNow('c.failed')}</span>;
    case 'CONFLICT':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200"><AlertTriangle className="w-3 h-3" /> {tNow('c.conflict')}</span>;
    default:
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700 border border-green-200"><CheckCircle className="w-3 h-3" /> {tNow('c.synced')}</span>;
  }
};

export default function InventoryPage() {  const { t } = useT();
  const { currency, toDisplay, toBif, curLabel } = useMoney();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission('inventory:manage');

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProducts = async () => {
    setLoading(true);
    setFormError('');
    try {
      const data = await apiClient.get<{ data: Product[] }>('/inventory?limit=300');
      const localPending = await localDB.inventory.filter(c => (c as any)._dirty).toArray();
      const pendingIds = new Set(localPending.map(c => c.id));
      const merged = [
        ...data.data.filter(c => !pendingIds.has(c.id)).map(c => ({ ...c, syncStatus: 'SYNCED' as const })),
        ...localPending,
      ].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      for (const c of data.data) {
        if (!pendingIds.has(c.id)) await localDB.inventory.put({ ...c, syncStatus: 'SYNCED', _dirty: false } as any);
      }
      setProducts(merged);
      setSource('cloud');
    } catch (err: any) {
      const cached = await localDB.inventory.filter(c => !c.isDeleted).toArray();
      setProducts(cached.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
      setSource('local');
      if (!String(err.message).includes('OFFLINE')) setNotice(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    const unsub = syncEngine.subscribe(() => { loadProducts(); });
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(pr => {
      if (category && pr.category !== category) return false;
      if (onlyLow && pr.stockQuantity > pr.reorderLevel) return false;
      if (!q) return true;
      return (
        pr.name.toLowerCase().includes(q) ||
        pr.sku.toLowerCase().includes(q) ||
        (pr.supplierName || '').toLowerCase().includes(q) ||
        (pr.location || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, category, onlyLow]);

  const stats = useMemo(() => {
    const low = products.filter(pr => pr.stockQuantity <= pr.reorderLevel);
    const out = products.filter(pr => pr.stockQuantity === 0);
    const value = products.reduce((s, pr) => s + pr.stockQuantity * pr.purchasePrice, 0);
    return { total: products.length, low: low.length, out: out.length, value };
  }, [products]);

  const openCreate = () => { setForm(emptyForm); setFormError(''); setShowForm(true); };
  const openEdit = (pr: Product) => {
    setForm({
      id: pr.id, version: pr.version,
      name: pr.name, sku: pr.sku, category: pr.category || 'GENERAL', unit: pr.unit || 'PCS',
      stockQuantity: String(pr.stockQuantity ?? 0), reorderLevel: String(pr.reorderLevel ?? 5),
      purchasePrice: String(toDisplay(pr.purchasePrice ?? 0)), sellingPrice: String(toDisplay(pr.sellingPrice ?? 0)),
      supplierName: pr.supplierName || '', location: pr.location || '', description: pr.description || '',
      isActive: pr.isActive ?? true,
    });
    setFormError('');
    setShowForm(true);
  };

  const queueForSync = async (operation: 'CREATE' | 'UPDATE' | 'DELETE', entityId: string, data: any, clientVersion?: number) => {
    await localDB.addToSyncQueue({
      entityType: 'Product',
      entityId,
      operation,
      data,
      clientVersion,
      deviceId: getDeviceId(),
    } as any);
  };

  const payloadFrom = (f: FormState) => ({
    name: f.name.trim(),
    sku: f.sku.trim().toUpperCase(),
    category: f.category,
    unit: f.unit,
    stockQuantity: Math.max(0, parseInt(f.stockQuantity || '0', 10) || 0),
    reorderLevel: Math.max(0, parseInt(f.reorderLevel || '0', 10) || 0),
    purchasePrice: Math.max(0, toBif(parseFloat(f.purchasePrice || '0') || 0)),
    sellingPrice: Math.max(0, toBif(parseFloat(f.sellingPrice || '0') || 0)),
    supplierName: f.supplierName.trim() || null,
    location: f.location.trim() || null,
    description: f.description.trim() || null,
    isActive: f.isActive,
  });

  const validate = (f: FormState) => {
    if (f.name.trim().length < 2) return t('inv.valName');
    if (f.sku.trim().length < 2) return t('inv.valSku');
    const buy = parseFloat(f.purchasePrice || '0');
    const sell = parseFloat(f.sellingPrice || '0');
    if (buy < 0 || sell < 0) return t('inv.valNeg');
    return '';
  };

  const saveProduct = async () => {
    const err = validate(form);
    if (err) { setFormError(err); return; }
    setSaving(true);
    setFormError('');

    const payload = payloadFrom(form);
    const isEdit = !!form.id;
    const id = form.id || crypto.randomUUID();

    // Local-first persist (offline-first guarantee)
    const localRecord: any = {
      id, ...payload,
      version: form.version ?? 1,
      createdAt: (products.find(c => c.id === id)?.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
      _dirty: true,
    };
    await localDB.inventory.put(localRecord);
    await queueForSync(isEdit ? 'UPDATE' : 'CREATE', id, { id, ...payload }, form.version);

    try {
      if (isEdit) {
        const saved = await apiClient.put<Product>(`/inventory/${id}`, { ...payload, version: form.version, deviceId: getDeviceId() });
        await localDB.inventory.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      } else {
        const saved = await apiClient.post<Product>('/inventory', { id, ...payload, deviceId: getDeviceId() });
        await localDB.inventory.put({ ...saved, syncStatus: 'SYNCED', _dirty: false } as any);
      }
      const queued = await localDB.syncQueue
        .where('entityId').equals(id)
        .filter(i => i.entityType === 'Product' && i.status === 'PENDING')
        .toArray();
      await localDB.syncQueue.bulkDelete(queued.map(q => q.id));
      setNotice(t('inv.saved'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('409') || msg.includes('already exists') || msg.includes('Conflict')) {
        setNotice(t('inv.conflict'));
      } else if (msg.includes('OFFLINE') || msg.includes('Network')) {
        setNotice(t('inv.offline'));
      } else {
        setFormError(msg || 'Save failed');
        setNotice(msg || t('inv.failed'));
      }
      await syncEngine.sync().catch(() => undefined);
    } finally {
      setSaving(false);
      setShowForm(false);
      loadProducts();
    }
  };

  const deleteProduct = async (pr: Product) => {
    if (!window.confirm(t('inv.delConfirm', { name: pr.name, sku: pr.sku }))) return;
    try {
      await apiClient.delete(`/inventory/${pr.id}`);
      await localDB.inventory.delete(pr.id);
      setNotice(t('inv.deleted'));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.inventory.delete(pr.id);
        await queueForSync('DELETE', pr.id, { id: pr.id }, pr.version);
        setNotice(t('inv.delOffline'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      loadProducts();
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
          <h1 className="text-2xl font-bold text-gray-900">{t('inv.heading')}</h1>
          <p className="text-gray-500 mt-1">{t('inv.sub')}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${
            source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
          }`}>
            {source === 'cloud' ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
            {source === 'cloud' ? t('c.cloudCache') : t('c.offlineData')}
          </span>
          <button onClick={loadProducts} className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors" title={t('c.reload')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canManage && (
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] text-white text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t('inv.new')}
            </button>
          )}
        </div>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><Boxes className="w-3.5 h-3.5" /> {t('inv.skus')}</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{stats.total}</div>
        </div>
        <div className={`bg-white rounded-2xl border px-4 py-3 ${stats.low > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'}`}>
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> {t('inv.low')}</div>
          <div className="text-xl font-bold text-amber-600 mt-0.5">{stats.low}</div>
        </div>
        <div className={`bg-white rounded-2xl border px-4 py-3 ${stats.out > 0 ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
          <div className="flex items-center gap-1.5 text-xs text-gray-400"><Package className="w-3.5 h-3.5 text-red-500" /> {t('inv.out')}</div>
          <div className="text-xl font-bold text-red-600 mt-0.5">{stats.out}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-400">{t('inv.stockValue')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{fmtBif(stats.value, currency)}</div>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-400 hover:text-blue-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('inv.searchPh')}
            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCategory('')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!category ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            {t('inv.all')}
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(category === cat ? '' : cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${category === cat ? 'bg-[#1A1A2E] text-white border-[#1A1A2E]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              {cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
          <button
            onClick={() => setOnlyLow(v => !v)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${onlyLow ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            {t('inv.lowOnly')}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">{t('inv.colProduct')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('inv.colCategory')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('inv.colStock')}</th>
                <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">{t('inv.colCost')}</th>
                <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">{t('inv.colSell')}</th>
                <th className="px-4 py-3 font-medium">{t('c.sync')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">{t('inv.empty')}</td></tr>
              )}
              {filtered.map(pr => {
                const low = pr.stockQuantity <= pr.reorderLevel;
                const out = pr.stockQuantity === 0;
                return (
                  <tr key={pr.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 shrink-0">
                          <Package className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">{pr.name}</div>
                          <div className="text-xs text-gray-400">
                            {pr.sku}
                            {pr.location ? ` · ${pr.location}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${catColors[pr.category] || catColors.GENERAL}`}>
                        {pr.category.charAt(0) + pr.category.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold ${
                        out ? 'bg-red-100 text-red-700' : low ? 'bg-amber-100 text-amber-700' : 'bg-green-50 text-green-700'
                      }`}>
                        {out && <AlertTriangle className="w-3 h-3" />}
                        {pr.stockQuantity} {pr.unit}
                      </span>
                      {low && !out && <div className="text-[10px] text-amber-500 mt-0.5">reorder at {pr.reorderLevel}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 hidden lg:table-cell whitespace-nowrap">{fmtBif(pr.purchasePrice, currency)}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium hidden lg:table-cell whitespace-nowrap">{fmtBif(pr.sellingPrice, currency)}</td>
                    <td className="px-4 py-3">{syncChip((pr as any).syncStatus || 'SYNCED')}</td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(pr)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title={t('c.edit')}>
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteProduct(pr)} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title={t('c.delete')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : <div className="text-right text-xs text-gray-300">view only</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
          <span>{filtered.length} product{filtered.length === 1 ? '' : 's'} {source === 'local' ? '(local cache)' : ''}</span>
          <button onClick={() => syncEngine.sync()} className="flex items-center gap-1 text-[#C1272D] font-medium hover:underline">
            <RefreshCw className="w-3 h-3" /> {t('c.syncNow')}
          </button>
        </div>
      </div>

      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">{form.id ? t('inv.editTitle') : t('inv.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.name')}</label>
                <input className={inputCls} {...field('name')} placeholder={t('inv.namePh')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.sku')}</label>
                <input className={inputCls} {...field('sku')} placeholder="BRK-4501" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.category')}</label>
                <select className={inputCls} {...field('category')}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.unit')}</label>
                <select className={inputCls} {...field('unit')}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.shelf')}</label>
                <input className={inputCls} {...field('location')} placeholder="Shelf A1" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.qty')}</label>
                <input className={inputCls} type="number" min="0" {...field('stockQuantity')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.reorder')}</label>
                <input className={inputCls} type="number" min="0" {...field('reorderLevel')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.purchase', { cur: curLabel })}</label>
                <input className={inputCls} type="number" min="0" step="100" {...field('purchasePrice')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.sellPrice', { cur: curLabel })}</label>
                <input className={inputCls} type="number" min="0" step="100" {...field('sellingPrice')} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.supplier')}</label>
                <input className={inputCls} {...field('supplierName')} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('inv.description')}</label>
                <textarea className={inputCls} rows={2} {...field('description')} />
              </div>
              <div className="flex items-center">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-[#C1272D]" {...field('isActive')} />
                  {t('inv.activeLabel')}
                </label>
              </div>

              {formError && (
                <div className="sm:col-span-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={saveProduct} disabled={saving} className="px-5 py-2 rounded-xl bg-[#C1272D] hover:bg-[#a51f24] disabled:opacity-60 text-white text-sm font-medium">
                {saving ? t('c.saving') : form.id ? t('c.saveChanges') : t('inv.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
