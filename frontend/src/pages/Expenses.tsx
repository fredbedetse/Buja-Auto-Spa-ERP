import { useEffect, useMemo, useState } from 'react';
import {
  Receipt, Plus, X, Search, Pencil, Trash2, Cloud, CloudOff, Wallet,
  CalendarClock, TrendingDown, AlertTriangle,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import syncEngine from '../lib/syncEngine';
import { getDeviceId } from '../lib/device';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';

// ---------------------------------------------------------------------------
// Expenses (Phase 13) - operating-spend ledger. Fully offline: rows keep a
// TMP-EXP-xxx number locally and self-heal to EXP-YYYY-NNNNN on sync replay.
// Amounts are entered in the display currency and converted to BIF; the
// server rounds/clamps and owns the canonical figure.
// ---------------------------------------------------------------------------

const CATS = ['FUEL', 'RENT', 'UTILITIES', 'SUPPLIES', 'INSURANCE', 'TRANSPORT', 'MARKETING', 'MISC'] as const;
const METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const;
const CAT_COLOR: Record<string, string> = {
  FUEL: '#F59E0B', RENT: '#6366F1', UTILITIES: '#0EA5E9', SUPPLIES: '#84CC16',
  INSURANCE: '#EC4899', TRANSPORT: '#14B8A6', MARKETING: '#A855F7', MISC: '#6B7280',
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const syncChip = (status?: string) => {
  if (status === 'PENDING') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{tNow('c.pendingSync')}</span>;
  if (status === 'FAILED') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 flex items-center gap-1 w-fit"><AlertTriangle size={10} />{tNow('c.syncFailed')}</span>;
  if (status === 'CONFLICT') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1 w-fit"><AlertTriangle size={10} />{tNow('c.conflict')}</span>;
  return null;
};

interface EForm { id: string; category: string; amount: string; date: string; vendor: string; paidBy: string; paymentMethod: string; notes: string }
const emptyForm = (): EForm => ({ id: '', category: 'FUEL', amount: '', date: ymd(new Date()), vendor: '', paidBy: '', paymentMethod: 'CASH', notes: '' });

export default function ExpensesPage() {
  const { t } = useT();
  const money = useMoney();
  const user = useAuthStore(s => (s as any).user);
  const canManage = useAuthStore(s => s.hasPermission('expenses:manage'));
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ total: 0, count: 0, today: { count: 0, amount: 0 }, month: { count: 0, amount: 0 }, byCategory: [] });
  const [source, setSource] = useState<'cloud' | 'local'>('cloud');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [q, setQ] = useState('');
  const [fCat, setFCat] = useState('ALL');

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: any[] }>('/expenses?limit=200');
      for (const e of res.data) await localDB.expenses.put({ ...e, syncStatus: 'SYNCED', _dirty: false });
      setRows(res.data); setSource('cloud');
      setNotice(n => (n === t('exp.offline') || n === t('exp.offlineUpdated') ? '' : n));
      try { setStats(await apiClient.get('/expenses/stats')); } catch { /* keep */ }
    } catch {
      const cached = (await localDB.expenses.toArray()).filter(e => !(e as any).isDeleted).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
      setRows(cached as any); setSource('local');
      const day0 = ymd(new Date());
      const m0 = `${day0.slice(0, 7)}-01`;
      setStats({
        total: cached.reduce((s: number, e: any) => s + (e.amount || 0), 0),
        count: cached.length,
        today: { count: cached.filter((e: any) => ymd(new Date(e.date)) === day0).length, amount: cached.filter((e: any) => ymd(new Date(e.date)) === day0).reduce((s: number, e: any) => s + (e.amount || 0), 0) },
        month: { count: cached.filter((e: any) => ymd(new Date(e.date)) >= m0).length, amount: cached.filter((e: any) => ymd(new Date(e.date)) >= m0).reduce((s: number, e: any) => s + (e.amount || 0), 0) },
        byCategory: (() => {
          const m = new Map<string, { count: number; amount: number }>();
          for (const e of cached.filter((x: any) => ymd(new Date(x.date)) >= m0)) { const k = e.category; const c = m.get(k) || { count: 0, amount: 0 }; c.count++; c.amount += e.amount || 0; m.set(k, c); }
          return [...m.entries()].map(([category, v]) => ({ category, ...v })).sort((a: any, b: any) => b.amount - a.amount);
        })(),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = syncEngine.subscribe(() => { load(); });
    return () => { void unsub; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queueOffline = async (entityId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', data: any) => {
    await localDB.addToSyncQueue({ entityType: 'Expense', entityId, operation, data, deviceId: getDeviceId() } as any);
  };

  const toBifAmount = () => {
    const raw = Number(String(form.amount).replace(/[^\d.]/g, ''));
    if (!isFinite(raw) || raw <= 0) return 0;
    return Math.round(money.currency === 'usd' ? raw * 6000 : raw);
  };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(e =>
      (fCat === 'ALL' || e.category === fCat) &&
      (!needle || [e.expenseNo, e.vendor, e.paidBy, e.notes].some(v => String(v || '').toLowerCase().includes(needle))));
  }, [rows, q, fCat]);

  const buildPayload = () => ({
    category: form.category, amount: toBifAmount(), date: form.date,
    vendor: form.vendor.trim() || undefined, paidBy: form.paidBy.trim() || undefined,
    paymentMethod: form.paymentMethod, notes: form.notes.trim() || undefined,
  });

  const localRow = (id: string, payload: any) => ({
    id, expenseNo: `TMP-EXP-${id.slice(0, 8).toUpperCase()}`, category: payload.category, amount: payload.amount,
    date: payload.date, vendor: payload.vendor || null, paidBy: payload.paidBy || (user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : null),
    paymentMethod: payload.paymentMethod || 'CASH', notes: payload.notes || null,
    version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as any);

  const save = async () => {
    if (!toBifAmount()) { setFormError(t('exp.valAmount')); return; }
    setSaving(true); setFormError('');
    const id = editId || crypto.randomUUID();
    const payload: any = buildPayload();
    try {
      if (editId) {
        const cur = rows.find(r => r.id === editId);
        const saved = await apiClient.put<any>(`/expenses/${editId}`, { ...payload, version: cur?.version });
        await localDB.expenses.put({ ...saved, syncStatus: 'SYNCED', _dirty: false });
        setNotice(t('exp.saved'));
      } else {
        const row = localRow(id, payload); row.syncStatus = 'PENDING'; row._dirty = true;
        await localDB.expenses.put(row);
        await queueOffline(id, 'CREATE', { id, ...payload });
        const saved = await apiClient.post<any>('/expenses', { id, ...payload });
        await localDB.expenses.put({ ...row, ...saved, syncStatus: 'SYNCED', _dirty: false });
        const queued = await localDB.syncQueue.where('entityId').equals(id).filter(i => i.status === 'PENDING').toArray();
        await localDB.syncQueue.bulkDelete(queued.map(x => x.id));
        setNotice(t('exp.created'));
      }
      setShowForm(false); setEditId(null); setForm(emptyForm());
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        const row = localRow(id, payload); row.syncStatus = 'PENDING'; row._dirty = true;
        await localDB.expenses.put(row);
        await queueOffline(id, editId ? 'UPDATE' : 'CREATE', { id, ...payload });
        setNotice(t('exp.offline'));
        setShowForm(false); setEditId(null);
        await syncEngine.sync().catch(() => undefined);
      } else {
        setFormError(msg);
      }
    } finally {
      setSaving(false);
      load();
    }
  };

  const remove = async (e: any) => {
    if (!window.confirm(t('exp.deleteConfirm', { no: e.expenseNo }))) return;
    try {
      await apiClient.delete(`/expenses/${e.id}`);
      await localDB.expenses.delete(e.id);
      setNotice(t('exp.deleted', { no: e.expenseNo }));
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('OFFLINE') || msg.includes('Network')) {
        await localDB.expenses.update(e.id, { isDeleted: true, syncStatus: 'PENDING', _dirty: true } as any);
        await queueOffline(e.id, 'DELETE', { id: e.id });
        setNotice(t('exp.offlineUpdated'));
        await syncEngine.sync().catch(() => undefined);
      } else {
        setNotice(msg);
      }
    } finally {
      load();
    }
  };

  const topCat = stats.byCategory?.[0];

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm bg-gradient-to-br from-rose-500 to-red-600"><Receipt size={20} /></div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-bold text-gray-900">{t('nav.expenses')}</h1>
          <p className="text-xs text-gray-500">{t('exp.sub')}</p>
        </div>
        <span className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium ${source === 'cloud' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
          {source === 'cloud' ? <Cloud size={12} /> : <CloudOff size={12} />}{t(source === 'cloud' ? 'c.cloudCache' : 'c.offlineData')}
        </span>
        {canManage && <button onClick={openCreate} className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-[#16A34A] text-white font-semibold hover:bg-[#128a3e] shadow-sm"><Plus size={14} />{t('exp.new')}</button>}
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-2 text-xs bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2">
          <span>{notice}</span><button onClick={() => setNotice('')} className="text-green-600 hover:text-green-800"><X size={13} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { k: 'exp.stat.month', v: money.fmt(stats.month?.amount), sub: t('exp.stat.lines', { n: String(stats.month?.count ?? 0) }), tone: 'red' },
          { k: 'exp.stat.today', v: money.fmt(stats.today?.amount) },
          { k: 'exp.stat.total', v: money.fmt(stats.total), sub: t('exp.stat.lines', { n: String(stats.count ?? 0) }) },
          { k: 'exp.stat.topCat', v: topCat ? t('exp.cat.' + topCat.category) : '—', sub: topCat ? money.fmt(topCat.amount) : undefined, cat: topCat?.category },
        ].map((c: any, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium flex items-center gap-1.5">
              {i === 0 ? <TrendingDown size={12} className="text-red-400" /> : i === 1 ? <CalendarClock size={12} className="text-gray-400" /> : i === 3 ? <Wallet size={12} className="text-gray-400" /> : null}
              {t(c.k)}
            </div>
            <div className={`text-lg font-bold mt-0.5 flex items-center gap-2 ${c.tone === 'red' ? 'text-red-600' : 'text-gray-900'}`}>
              {c.cat && <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: CAT_COLOR[c.cat] }} />}
              {c.v}
            </div>
            {c.sub && <div className="text-[11px] text-gray-500">{c.sub}</div>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setFCat('ALL')} className={`text-[11px] px-2.5 py-1 rounded-full border font-medium ${fCat === 'ALL' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{t('exp.allCats')}</button>
        {CATS.map(c => (
          <button key={c} onClick={() => setFCat(fCat === c ? 'ALL' : c)} className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border font-medium ${fCat === c ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: fCat === c ? '#fff' : CAT_COLOR[c] }} />
            {t('exp.cat.' + c)}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('exp.searchPh')} className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 w-56 focus:outline-none focus:ring-2 focus:ring-green-200" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              {[t('exp.col.no'), t('exp.col.date'), t('exp.col.category'), t('exp.col.vendor'), t('exp.col.paidBy'), t('exp.col.amount'), t('exp.col.actions')].map((h, i) => (
                <th key={i} className={`px-4 py-2.5 font-medium ${i >= 5 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{loading ? '…' : t('exp.empty')}</td></tr>}
            {visible.map(e => (
              <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                <td className="px-4 py-2.5">
                  <div className="font-mono font-semibold text-gray-800">{e.expenseNo}</div>
                  {e.syncStatus && e.syncStatus !== 'SYNCED' ? syncChip(e.syncStatus) : null}
                </td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{ymd(new Date(e.date))}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border border-gray-200 bg-gray-50 text-gray-700">
                    <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLOR[e.category] || CAT_COLOR.MISC }} />
                    {t('exp.cat.' + e.category)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-700">
                  {e.vendor || '—'}
                  {e.notes && <div className="text-[10px] text-gray-400 max-w-[220px] truncate" title={e.notes}>{e.notes}</div>}
                </td>
                <td className="px-4 py-2.5 text-gray-500">{e.paidBy || '—'}<div className="text-[10px] text-gray-400">{t('pay.method.' + e.paymentMethod) !== 'pay.method.' + e.paymentMethod ? t('pay.method.' + e.paymentMethod) : e.paymentMethod}</div></td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{money.fmt(e.amount)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
{canManage && <div className="flex items-center justify-end gap-1">
                    <button title={t('exp.edit')} onClick={() => { setEditId(e.id); setForm({ id: e.id, category: e.category, amount: String(money.toDisplay(e.amount)), date: ymd(new Date(e.date)), vendor: e.vendor || '', paidBy: e.paidBy || '', paymentMethod: e.paymentMethod || 'CASH', notes: e.notes || '' }); setFormError(''); setShowForm(true); }} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><Pencil size={13} /></button>
                    <button title={t('exp.delete')} onClick={() => remove(e)} className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                  </div>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={ev => ev.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm">{editId ? t('exp.editTitle') : t('exp.newTitle')}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            {formError && <div className="text-[11px] bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] font-medium text-gray-500">{t('exp.f.category')}
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
                  {CATS.map(c => <option key={c} value={c}>{t('exp.cat.' + c)}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('exp.f.amount')} ({money.curLabel})
                <input inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('exp.f.date')}
                <input type="date" value={form.date} max={ymd(new Date())} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('exp.f.method')}
                <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
                  {METHODS.map(m => <option key={m} value={m}>{t('pay.method.' + m) !== 'pay.method.' + m ? t('pay.method.' + m) : m}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('exp.f.vendor')}
                <input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">{t('exp.f.paidBy')}
                <input value={form.paidBy} onChange={e => setForm({ ...form, paidBy: e.target.value })} placeholder={user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : ''} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
              <label className="col-span-2 text-[11px] font-medium text-gray-500">{t('exp.f.notes')}
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 w-full text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5" />
              </label>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-green-50/60 border border-green-200 px-3 py-2 text-[11px] text-gray-600">
              <span>{t('exp.postedAs')}</span>
              <span className="font-bold text-gray-900">{money.fmt(toBifAmount())}</span>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowForm(false)} className="text-xs px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">{t('c.cancel')}</button>
              <button onClick={save} disabled={saving} className="text-xs px-4 py-2 rounded-lg bg-[#16A34A] text-white font-semibold hover:bg-[#128a3e] disabled:opacity-50">{saving ? t('c.saving') : t('c.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function openCreate() {
    setEditId(null); setForm({ ...emptyForm(), paidBy: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '' }); setFormError(''); setShowForm(true);
  }
}
