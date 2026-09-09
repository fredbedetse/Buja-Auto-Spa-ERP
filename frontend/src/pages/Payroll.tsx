import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote, Lock, Plus, X, CheckCircle2, Landmark, RotateCcw, Trash2, Pencil, CloudOff, Wallet,
} from 'lucide-react';
import apiClient from '../lib/api';
import { useT, tNow } from '../lib/i18n';
import { useMoney } from '../lib/money';
import { useAuthStore } from '../stores/authStore';

// ---------------------------------------------------------------------------
// Payroll (Phase 16) - manager/admin only, online only by design. Runs
// snapshot salaries at creation; a run flows OPEN -> APPROVED -> PAID and
// every mutation on a paid run is rejected server-side. No Dexie store, no
// sync queue: money leaves the building only with a live server.
// ---------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const monthName = (m: number, lang: string) => {
  try { return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { month: 'long' }).format(new Date(2026, m - 1)); }
  catch { return MONTHS[m - 1]; }
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-sky-50 text-sky-700 border-sky-200',
  PAID: 'bg-green-50 text-green-700 border-green-200',
};


interface Item { id: string; name: string; position: string; baseSalary: number; bonus: number; deduction: number; net: number; paid: boolean; paidAt?: string; paymentMethod?: string; notes?: string | null }
interface Run { id: string; runNo: string; year: number; month: number; status: string; note?: string | null; settledAt?: string | null; paymentMethod?: string | null; employees?: number; gross?: number; net?: number; paidCount?: number; items?: Item[] }

export default function PayrollPage() {
  const { t, language } = useT();
  const money = useMoney();
  const canRead = useAuthStore(s => s.hasPermission('payroll:read'));
  const canManage = useAuthStore(s => s.hasPermission('payroll:manage'));
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [detail, setDetail] = useState<Run | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [edit, setEdit] = useState<{ id: string; bonus: string; deduction: string; notes: string } | null>(null);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const flash = (kind: 'ok' | 'err', text: string) => { setNotice({ kind, text }); setTimeout(() => setNotice(null), 3500); };

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      const [rs, st] = await Promise.all([
        apiClient.get<any>('/payroll/runs'),
        apiClient.get<any>('/payroll/stats'),
      ]);
      setRuns(rs.data); setStats(st);
    } catch (e: any) {
      flash('err', String(e?.message || 'Request failed'));
    } finally { setLoading(false); }
  }, [canRead]);

  useEffect(() => { refresh(); }, [refresh]);

  const openRun = useCallback(async (id: string) => {
    try { setDetail(await apiClient.get<any>(`/payroll/runs/${id}`)); } catch (e: any) { flash('err', String(e?.message || 'Failed')); }
  }, []);

  const act = useCallback(async (fn: () => Promise<any>, okMsg: string, alsoClose = false) => {
    if (!online) { flash('err', t('pr.errOffline')); return; }
    try {
      await fn();
      if (alsoClose) setDetail(null); else await openRun(detail!.id);
      await refresh();
      flash('ok', okMsg);
    } catch (e: any) { flash('err', String(e?.message || 'Failed')); }
  }, [online, detail, openRun, refresh, t]);

  // -------- access gate -----------------------------------------------------
  if (!canRead) {
    return (
      <div className="max-w-lg mx-auto mt-16" data-testid="pay-lock">
        <div className="rounded-2xl border border-gray-200 bg-white dark:bg-gray-900 p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><Lock size={26} className="text-gray-500" /></div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('pr.locked')}</h2>
          <p className="mt-2 text-sm text-gray-500">{t('pr.lockedDesc')}</p>
        </div>
      </div>
    );
  }

  const statCards = stats ? [
    { k: 'pr.stat.paidYear', v: money.fmt(stats.paidThisYear?.amount), sub: t('pr.stat.items', { n: String(stats.paidThisYear?.count ?? 0) }) },
    { k: 'pr.stat.budget', v: money.fmt(stats.monthlyBudget), sub: t('pr.monthlyHint', { money: money.fmt(stats.monthlyBudget), n: String(stats.headcount) }) },
    { k: 'pr.stat.runs', v: String(stats.runs), sub: t('pr.headcount') + ': ' + stats.headcount },
    { k: 'pr.stat.open', v: stats.openRun ? stats.openRun.runNo : t('pr.none'), sub: stats.openRun ? t('pr.' + stats.openRun.status.toLowerCase()) : undefined },
  ] : [];

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-10" data-testid="pay-page">
      {/* header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-green-600 text-white flex items-center justify-center shadow"><Banknote size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">{t('pr.title')}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 font-medium">MANAGERS</span>
            </h1>
            <p className="text-xs text-gray-500">{t('pr.sub')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-500 dark:bg-gray-900 dark:border-gray-700">{t('pr.onlineOnly')}</span>
          {canManage && (
            <button data-testid="pay-new" onClick={() => setShowNew(true)} disabled={!online}
              className="inline-flex items-center gap-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3.5 py-2 rounded-xl shadow-sm transition">
              <Plus size={16} />{t('pr.new')}
            </button>
          )}
        </div>
      </div>

      {!online && (
        <div className="flex items-center gap-2 text-sm rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2" data-testid="pay-offline">
          <CloudOff size={15} />{t('pr.errOffline')}
        </div>
      )}
      {notice && (
        <div data-testid="pay-notice" className={`text-sm rounded-xl border px-3 py-2 flex items-center justify-between ${notice.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <span>{notice.text}</span><button onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {/* stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((c, idx) => (
          <div key={idx} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm" data-testid={`pay-stat-${idx}`}>
            <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{t(c.k)}</p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white truncate">{c.v}</p>
            {c.sub && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* runs */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white flex items-center gap-2"><Wallet size={15} />{t('pr.runs')}</h2>
          <span className="text-xs text-gray-400">{runs.length}</span>
        </div>
        {loading ? <div className="p-8 text-center text-sm text-gray-400">…</div> : runs.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">{t('pr.noRuns')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <th className="px-4 py-2">{t('pr.period')}</th><th className="px-2 py-2">{t('pr.status')}</th>
                <th className="px-2 py-2 text-right">{t('pr.employees')}</th><th className="px-2 py-2 text-right">{t('pr.net')}</th>
                <th className="px-2 py-2">{t('pr.paid')}</th><th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50 dark:hover:bg-gray-800/40" data-testid={`pay-run-${r.runNo}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{monthName(r.month, language)} {r.year}<span className="ml-2 text-[10px] text-gray-400">{r.runNo}</span></td>
                  <td className="px-2 py-2.5"><span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${STATUS_STYLE[r.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>{t('pr.' + r.status.toLowerCase())}</span></td>
                  <td className="px-2 py-2.5 text-right">{r.employees}</td>
                  <td className="px-2 py-2.5 text-right font-semibold">{money.fmt(r.net)}</td>
                  <td className="px-2 py-2.5 text-xs text-gray-500">{r.paidCount}/{r.employees}</td>
                  <td className="px-4 py-2.5 text-right"><button onClick={() => openRun(r.id)} className="text-xs font-medium text-green-700 hover:underline dark:text-green-400" data-testid={`pay-open-${r.runNo}`}>{t('pr.view')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* new-run dialog */}
      {showNew && <NewRunDialog onClose={() => setShowNew(false)} onDone={async runNo => { setShowNew(false); flash('ok', t('pr.toast.created', { no: runNo })); await refresh(); const found = (await apiClient.get<any>('/payroll/runs')).data.find((x: Run) => x.runNo === runNo); if (found) openRun(found.id); }} />}

      {/* detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start md:items-center justify-center p-2 md:p-6 overflow-auto" onClick={() => { setDetail(null); setEdit(null); }}>
          <div className="bg-white dark:bg-gray-900 w-full max-w-4xl rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 my-4" onClick={e => e.stopPropagation()} data-testid="pay-detail">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">{t('pr.detail')} · {monthName(detail.month, language)} {detail.year}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{detail.runNo} · {t('pr.' + detail.status.toLowerCase())}
                  {detail.settledAt ? ` · ${new Date(detail.settledAt).toLocaleDateString()} · ${detail.paymentMethod?.replace('_', ' ').toLowerCase()}` : ''}
                  {detail.note ? <span className="italic"> — {detail.note}</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canManage && detail.status === 'OPEN' && (
                  <button data-testid="pay-approve" onClick={() => { if (confirm(t('pr.approveConfirm', { no: detail.runNo }))) act(() => apiClient.put(`/payroll/runs/${detail.id}`, { status: 'APPROVED' }), t('pr.toast.approved')); }}
                    className="inline-flex items-center gap-1 text-xs font-medium bg-sky-600 hover:bg-sky-700 text-white px-2.5 py-1.5 rounded-lg"><CheckCircle2 size={13} />{t('pr.approve')}</button>
                )}
                {canManage && detail.status === 'APPROVED' && (
                  <button data-testid="pay-settle" onClick={() => { if (confirm(t('pr.settleConfirm', { no: detail.runNo }))) act(() => apiClient.post(`/payroll/runs/${detail.id}/settle`, { paymentMethod: 'BANK_TRANSFER' }), t('pr.toast.settled')); }}
                    className="inline-flex items-center gap-1 text-xs font-medium bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 rounded-lg"><Landmark size={13} />{t('pr.settle')}</button>
                )}
                {canManage && detail.status !== 'PAID' && (
                  <button data-testid="pay-delete" onClick={() => { if (confirm(t('pr.deleteConfirm', { no: detail.runNo }))) act(() => apiClient.delete(`/payroll/runs/${detail.id}`), t('pr.toast.deleted'), true); }}
                    className="inline-flex items-center gap-1 text-xs font-medium border border-red-200 text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg"><Trash2 size={13} /></button>
                )}
                {canManage && detail.status === 'PAID' && (
                  <button data-testid="pay-unsettle" onClick={() => act(() => apiClient.post(`/payroll/runs/${detail.id}/unsettle`, {}), t('pr.toast.unsettled'))}
                    className="inline-flex items-center gap-1 text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 px-2.5 py-1.5 rounded-lg dark:text-gray-200 dark:hover:bg-gray-800"><RotateCcw size={13} />{t('pr.unsettle')}</button>
                )}
                <button data-testid="pay-close" onClick={() => { setDetail(null); setEdit(null); }} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={16} /></button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                    <th className="px-5 py-2">{t('pr.employees')}</th><th className="px-2 py-2">{t('pr.position')}</th>
                    <th className="px-2 py-2 text-right">{t('pr.base')}</th><th className="px-2 py-2 text-right">{t('pr.bonus')}</th>
                    <th className="px-2 py-2 text-right">{t('pr.deduction')}</th><th className="px-2 py-2 text-right">{t('pr.netLabel')}</th>
                    <th className="px-2 py-2">{t('pr.payStatus')}</th><th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map(it => (
                    <tr key={it.id} className="border-b border-gray-50 dark:border-gray-800/60 align-top" data-testid={`pay-item-${it.name}`}>
                      <td className="px-5 py-2.5 font-medium text-gray-900 dark:text-white">{it.name}{it.notes ? <span className="block text-[10px] font-normal italic text-gray-400">{it.notes}</span> : null}</td>
                      <td className="px-2 py-2.5 text-xs text-gray-500">{it.position.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{money.fmt(it.baseSalary)}</td>
                      {edit?.id === it.id ? (
                        <>
                          <td className="px-2 py-2.5 text-right"><input data-testid="pay-bonus" className="w-24 text-right rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-1.5 py-1 text-xs tabular-nums" value={edit.bonus} onChange={e => setEdit({ ...edit, bonus: e.target.value })} /></td>
                          <td className="px-2 py-2.5 text-right"><input data-testid="pay-deduct" className="w-24 text-right rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-1.5 py-1 text-xs tabular-nums" value={edit.deduction} onChange={e => setEdit({ ...edit, deduction: e.target.value })} /></td>
                          <td className="px-2 py-2.5 text-right text-xs text-gray-400">= {money.fmt(Math.max(0, it.baseSalary + (Number(edit.bonus) || 0) - (Number(edit.deduction) || 0)))}</td>
                          <td className="px-2 py-2.5" colSpan={2}>
                            <div className="flex items-center justify-end gap-1.5">
                              <button data-testid="pay-item-save" className="text-xs font-medium bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700"
                                onClick={() => act(() => apiClient.patch(`/payroll/items/${it.id}`, { bonus: Math.round(money.toBif(Number(edit.bonus) || 0)), deduction: Math.round(money.toBif(Number(edit.deduction) || 0)), notes: edit.notes || '' }), t('pr.toast.saved'))}>{t('pr.saveItem')}</button>
                              <button className="text-xs text-gray-500 px-2 py-1" onClick={() => setEdit(null)}>{t('pr.cancel')}</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-2.5 text-right tabular-nums">{it.bonus ? '+ ' + money.fmt(it.bonus) : '—'}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{it.deduction ? '− ' + money.fmt(it.deduction) : '—'}</td>
                          <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{money.fmt(it.net)}</td>
                          <td className="px-2 py-2.5 text-xs">{it.paid
                            ? <span className="text-green-700 dark:text-green-400" title={it.paymentMethod || ''}>{it.paidAt ? new Date(it.paidAt).toLocaleDateString() : '✓'}</span>
                            : <span className="text-gray-400">{t('pr.unpaid')}</span>}</td>
                          <td className="px-4 py-2.5 text-right">
                            {canManage && detail.status !== 'PAID' && (
                              <button data-testid={`pay-edit-${it.name}`} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-green-700"
                                onClick={() => setEdit({ id: it.id, bonus: String(money.toDisplay(it.bonus)), deduction: String(money.toDisplay(it.deduction)), notes: it.notes || '' })}><Pencil size={13} /></button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-sm font-bold text-gray-900 dark:text-white">
                    <td className="px-5 py-2.5" colSpan={5}>{(detail.items || []).length} × {t('pr.netLabel')}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums" data-testid="pay-run-net">{money.fmt((detail.items || []).reduce((a, x) => a + x.net, 0))}</td>
                    <td className="px-2 py-2.5 text-xs font-medium text-gray-500" colSpan={2}>{(detail.items || []).filter(x => x.paid).length}/{(detail.items || []).length} {t('pr.paid')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {detail.status === 'APPROVED' && canManage && (
              <div className="px-5 py-2.5 border-t border-gray-100 dark:border-gray-800 text-right">
                <button data-testid="pay-reopen" onClick={() => act(() => apiClient.put(`/payroll/runs/${detail.id}`, { status: 'OPEN' }), t('pr.toast.unsettled'))} className="text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 underline underline-offset-2">{t('pr.reopen')}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewRunDialog({ onClose, onDone }: { onClose: () => void; onDone: (runNo: string) => void }) {
  const { t, language } = useT();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [headcount, setHeadcount] = useState<number | null>(null);
  useEffect(() => { apiClient.get<any>('/payroll/stats').then(s => setHeadcount(s.headcount)).catch(() => {}); }, []);

  const create = async () => {
    setBusy(true);
    try {
      const run = await apiClient.post<any>('/payroll/runs', { year: Number(year), month: Number(month), note: note || undefined });
      onDone(run.runNo);
    } catch (e: any) {
      alert(String(e?.message || 'Failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-5" onClick={e => e.stopPropagation()} data-testid="pay-new-dialog">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900 dark:text-white">{t('pr.newTitle')}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={16} /></button>
        </div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('pr.month')}</label>
        <select data-testid="pay-f-month" className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-transparent px-2.5 py-2 text-sm mb-3 dark:text-white" value={month} onChange={e => setMonth(e.target.value)}>
          {MONTHS.map((m, idx) => <option key={m} value={String(idx + 1)}>{monthName(idx + 1, language)}</option>)}
        </select>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('pr.year')}</label>
        <input data-testid="pay-f-year" type="number" min={2020} max={2100} className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-transparent px-2.5 py-2 text-sm mb-3 tabular-nums dark:text-white" value={year} onChange={e => setYear(e.target.value)} />
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('pr.note')}</label>
        <input data-testid="pay-f-note" className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-transparent px-2.5 py-2 text-sm mb-4 dark:text-white" value={note} onChange={e => setNote(e.target.value)} />
        <button data-testid="pay-f-create" disabled={busy} onClick={create}
          className="w-full inline-flex justify-center items-center gap-2 text-sm font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl">
          <Plus size={15} />{t('pr.create', { n: headcount ?? '…' })}
        </button>
      </div>
    </div>
  );
}
