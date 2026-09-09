import { useCallback, useEffect, useState } from 'react';
import {
  Settings2, Sun, Moon, Monitor, VolumeX, Globe2, DollarSign, Building2,
  ShieldCheck, UserCog, DatabaseZap, RefreshCw, Download, Trash2, Lock,
  CheckCircle2, MapPin, Crown, Save,
} from 'lucide-react';
import apiClient from '../lib/api';
import localDB from '../lib/db';
import { useT } from '../lib/i18n';
import { useUiStore, applyTheme, type Theme } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { getBrand } from '../lib/settingsSync';

// ---------------------------------------------------------------------------
// Settings (Phase 14). Three scopes, one page:
//   personal - theme / motion / currency / language (sync to server per user)
//   company  - identity + defaults (settings:manage; the shop never moves)
//   access   - who holds the ADMIN crown (guard-railed toggle per user)
// Plus the usual: sync status, JSON workspace export, local cache wipe.
// ---------------------------------------------------------------------------

const Section = ({ icon, title, sub, children, action }: any) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3" data-testid={`set-${title}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600">{icon}</div>
        <div>
          <h2 className="text-sm font-bold text-gray-800">{title}</h2>
          {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
    {children}
  </div>
);

const ThemeCard = ({ value, mode, icon, label, active, onPick }: any) => (
  <button
    onClick={onPick}
    data-testid={`theme-${mode}`}
    className={`flex-1 rounded-xl border p-3 text-left transition ${active ? 'border-[#16A34A] bg-green-50/60 ring-2 ring-green-200' : 'border-gray-200 hover:bg-gray-50'}`}
  >
    <div className="flex items-center justify-between mb-2">
      <span className={`flex items-center gap-1.5 text-xs font-semibold ${active ? 'text-green-700' : 'text-gray-600'}`}>{icon}{label}</span>
      {active && <CheckCircle2 size={14} className="text-[#16A34A]" />}
    </div>
    {/* tiny mock preview */}
    <div className={`rounded-lg border p-1.5 ${mode === 'dark' ? 'bg-[#0b1220] border-[#24334f]' : mode === 'system' ? 'bg-gradient-to-r from-[#0b1220] from-50% to-white border-gray-200' : 'bg-white border-gray-200'}`}>
      <div className={`h-1.5 w-3/4 rounded ${mode === 'dark' ? 'bg-[#24334f]' : 'bg-gray-200'}`} />
      <div className={`h-1.5 w-1/2 rounded mt-1 ${mode === 'dark' ? 'bg-[#16A34A]' : 'bg-[#16A34A]'}`} />
    </div>
  </button>
);

export default function SettingsPage() {
  const { t } = useT();
  const ui = useUiStore();
  const user = useAuthStore(s => (s as any).user);
  const syncStatus = useSyncStatus();
  const [data, setData] = useState<any>(null);
  const [admins, setAdmins] = useState<any[]>([]);
  const [adminCount, setAdminCount] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [brand, setBrand] = useState<{ companyName: string; location: string } | null>(null);
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await apiClient.get<any>('/settings');
      setData(s); setCanManage(!!s.canManage);
      setCompany(s.global?.companyName || 'Buja Auto Spa');
      try {
        const a = await apiClient.get<any>('/settings/admins');
        setAdmins(a.data || []); setAdminCount(a.adminCount || 0);
      } catch { /* read-only roles may still view settings even if this 403s */ }
    } catch {
      setMsg({ tone: 'err', text: t('set.errOffline') });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); getBrand().then(setBrand); }, [load]);

  const flash = (tone: 'ok' | 'err', text: string) => { setMsg({ tone, text }); setTimeout(() => setMsg(m => (m?.text === text ? null : m)), 5000); };

  const pickTheme = (mode: Theme) => { ui.setTheme(mode); flash('ok', t('set.themeSaved', { mode: t('set.theme.' + mode) })); };

  const saveCompany = async () => {
    setBusy('company');
    try {
      const r = await apiClient.put<any>('/settings/global', { companyName: company.trim() });
      setData({ ...data, global: r.global });
      flash('ok', t('set.companySaved'));
      setBrand(await getBrand().then(() => ({ companyName: r.global.companyName, location: r.global.location })));
    } catch (e: any) {
      flash('err', String(e?.message || t('set.errSave')));
    } finally { setBusy(''); }
  };

  const saveDefaults = async (patch: any) => {
    setBusy('defaults');
    try {
      const r = await apiClient.put<any>('/settings/global', patch);
      setData({ ...data, global: r.global });
      flash('ok', t('set.defaultsSaved'));
    } catch (e: any) { flash('err', String(e?.message || t('set.errSave'))); } finally { setBusy(''); }
  };

  const toggleAdmin = async (u: any) => {
    const want = !u.isAdmin;
    if (want ? false : !window.confirm(t('set.demoteConfirm', { name: u.name }))) return;
    try {
      const r = await apiClient.patch<any>(`/settings/admins/${u.id}`, { admin: want });
      flash('ok', t(want ? 'set.granted' : 'set.revoked', { name: r.user?.name || u.name }));
      load();
    } catch (e: any) {
      flash('err', String(e?.message || t('set.errSave')));
      load();
    }
  };

  const exportJson = async () => {
    setBusy('export');
    try {
      const [wash, maint, bookings, expenses, queue, ui] = await Promise.all([
        localDB.washOrders.toArray(), localDB.maintenanceOrders.toArray(), localDB.rentalBookings.toArray(),
        localDB.expenses.toArray(), localDB.syncQueue.toArray(), Promise.resolve(localStorage.getItem('buja-ui-prefs')),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        company: brand,
        personal: JSON.parse(ui || '{}').state ?? {},
        counts: { wash: wash.length, maintenance: maint.length, rentals: bookings.length, expenses: expenses.length, queuedOps: queue.length },
        data: { wash, maintenance: maint, rentalBookings: bookings, expenses, syncQueue: queue },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `buja-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      flash('ok', t('set.exported'));
    } catch (e: any) { flash('err', String(e?.message || '')); } finally { setBusy(''); }
  };

  const clearCache = async () => {
    if (!window.confirm(t('set.clearConfirm'))) return;
    setBusy('clear');
    try { await localDB.delete(); } catch { /* ignore */ }
    localStorage.removeItem('buja_workspace_cache_v1');
    window.location.href = '/login';
  };

  const isDark = document.documentElement.classList.contains('dark');
  const g = data?.global || {};

  return (
    <div className="space-y-5 max-w-[1100px] mx-auto pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm bg-gradient-to-br from-slate-600 to-slate-800"><Settings2 size={20} /></div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-bold text-gray-900">{t('nav.settings')}</h1>
          <p className="text-xs text-gray-500">{t('set.sub')}</p>
        </div>
        <span className="text-[11px] px-2.5 py-1 rounded-full border font-medium bg-white border-gray-200 text-gray-500 flex items-center gap-1.5">
          {brand ? <><Building2 size={12} />{brand.companyName}</> : '…'}
        </span>
      </div>

      {msg && (
        <div data-testid="set-msg" className={`text-xs rounded-lg px-3 py-2 border flex items-center justify-between gap-2 ${msg.tone === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {/* ---------------- Appearance ---------------- */}
      <Section icon={<Sun size={15} />} title={t('set.appearance')} sub={t('set.appearanceSub')}>
        <div className="grid sm:grid-cols-3 gap-2">
          <ThemeCard value={ui.theme} mode="light" icon={<Sun size={13} />} label={t('set.theme.light')} active={ui.theme === 'light'} onPick={() => pickTheme('light')} />
          <ThemeCard value={ui.theme} mode="dark" icon={<Moon size={13} />} label={t('set.theme.dark')} active={ui.theme === 'dark'} onPick={() => pickTheme('dark')} />
          <ThemeCard value={ui.theme} mode="system" icon={<Monitor size={13} />} label={t('set.theme.system')} active={ui.theme === 'system'} onPick={() => pickTheme('system')} />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <VolumeX size={14} className="text-gray-400" />
            <div>
              <div className="font-semibold text-gray-800">{t('set.motion')}</div>
              <div className="text-[11px] text-gray-400">{t('set.motionSub')}</div>
            </div>
          </div>
          <button
            role="switch" aria-checked={ui.reduceMotion} data-testid="set-motion-switch"
            onClick={() => ui.setReduceMotion(!ui.reduceMotion)}
            className={`w-10 h-5.5 rounded-full p-0.5 transition ${ui.reduceMotion ? 'bg-[#16A34A]' : 'bg-gray-200'}`}
            style={{ height: 22 }}
          >
            <span className={`block w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${ui.reduceMotion ? 'translate-x-[18px]' : ''}`} />
          </button>
        </div>
        <p className="text-[11px] text-gray-400">{t('set.themeHint')} {isDark ? t('set.themeHintDark') : t('set.themeHintLight')}</p>
      </Section>

      {/* ---------------- Language & display ---------------- */}
      <Section icon={<Globe2 size={15} />} title={t('set.locale')} sub={t('set.localeSub')}>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['en', 'fr'] as const).map(l => (
              <button key={l} data-testid={`set-lang-${l}`} onClick={() => ui.setLanguage(l)} className={`text-xs px-3 py-1.5 font-semibold ${ui.language === l ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>{l.toUpperCase()}</button>
            ))}
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['bif', 'usd'] as const).map(c => (
              <button key={c} data-testid={`set-cur-${c}`} onClick={() => ui.setCurrency(c)} className={`text-xs px-3 py-1.5 font-semibold ${ui.currency === c ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>{c === 'bif' ? 'FBu (BIF)' : '$ (USD)'}</button>
            ))}
          </div>
          <span className="flex items-center gap-1 text-[11px] text-gray-400 px-2"><DollarSign size={12} />1 USD = 6,000 BIF · {t('set.pegFixed')}</span>
        </div>
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5"><CheckCircle2 size={12} className="text-[#16A34A]" />{t('set.localeSync')}</p>
      </Section>

      {/* ---------------- Company ---------------- */}
      <Section icon={<Building2 size={15} />} title={t('set.company')} sub={canManage ? t('set.companySub') : t('set.companySubRo')}>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[11px] font-medium text-gray-500">{t('set.f.company')}
            <div className="flex gap-1.5 mt-1">
              <input value={company} disabled={!canManage} onChange={e => setCompany(e.target.value)} className="flex-1 text-xs font-normal rounded-lg border border-gray-200 px-2.5 py-1.5 disabled:opacity-60" data-testid="set-company-input" />
              {canManage && <button onClick={saveCompany} disabled={busy === 'company'} className="text-[11px] px-2.5 rounded-lg bg-[#16A34A] text-white font-semibold flex items-center gap-1 disabled:opacity-50"><Save size={12} />{t('c.save')}</button>}
            </div>
          </label>
          <label className="text-[11px] font-medium text-gray-500">{t('set.f.location')}
            <div className="mt-1 flex items-center gap-2 text-xs rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-gray-600 select-none" data-testid="set-location-lock">
              <MapPin size={13} className="text-[#C1272D]" />
              <span className="font-semibold">{g.location || 'Bujumbura, Burundi'}</span>
              <Lock size={11} className="text-gray-400 ml-auto" />
            </div>
          </label>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
            <span className="text-[11px] text-gray-500">{t('set.f.defaultCurrency')}</span>
            <button data-testid="set-def-cur" disabled={busy === 'defaults'} onClick={() => saveDefaults({ defaultCurrency: g.defaultCurrency === 'usd' ? 'bif' : 'usd' })} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 font-semibold text-gray-700 hover:bg-gray-50">
              {(g.defaultCurrency || 'bif').toUpperCase()} ⇄
            </button>
            <span className="text-[11px] text-gray-500">{t('set.f.defaultLanguage')}</span>
            <button data-testid="set-def-lang" disabled={busy === 'defaults'} onClick={() => saveDefaults({ defaultLanguage: g.defaultLanguage === 'fr' ? 'en' : 'fr' })} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 font-semibold text-gray-700 hover:bg-gray-50">
              {(g.defaultLanguage || 'en').toUpperCase()} ⇄
            </button>
            <span className="text-[11px] text-gray-400">{t('set.defaultsHint')}</span>
          </div>
        )}
      </Section>

      {/* ---------------- Access & admins ---------------- */}
      <Section
        icon={<ShieldCheck size={15} />} title={t('set.access')} sub={t('set.accessSub', { n: String(adminCount) })}
        action={<span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1"><Crown size={10} />{adminCount} admin{adminCount === 1 ? '' : 's'}</span>}
      >
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
          {admins.length === 0 && <div className="p-3 text-xs text-gray-400">…</div>}
          {admins.map(u => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-gray-50/60" data-testid={`set-user-${u.email}`}>
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-600">
                {u.name.split(' ').map((x: string) => x[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                  {u.name}
                  {u.id === user?.id && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{t('set.you')}</span>}
                  {u.status !== 'ACTIVE' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">{t('set.inactive')}</span>}
                </div>
                <div className="text-[10px] text-gray-400 truncate">{u.email} · {u.roles.join(', ')}</div>
              </div>
              {u.isSuper ? (
                <span className="text-[10px] px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-semibold flex items-center gap-1" title={t('set.ownerTip')}><Crown size={11} />{t('set.owner')}</span>
              ) : canManage ? (
                <button
                  data-testid={`admin-switch-${u.email}`}
                  role="switch" aria-checked={u.isAdmin} disabled={busy === u.id}
                  onClick={() => toggleAdmin(u)}
                  title={u.isAdmin ? t('set.revokeAdmin') : t('set.grantAdmin')}
                  className={`relative w-11 rounded-full p-0.5 transition ${u.isAdmin ? 'bg-[#16A34A]' : 'bg-gray-200'} disabled:opacity-50`}
                  style={{ height: 22 }}
                >
                  <span className={`block w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${u.isAdmin ? 'translate-x-[22px]' : ''}`} />
                </button>
              ) : (
                <span className={`text-[10px] px-2 py-1 rounded-lg border font-medium ${u.isAdmin ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                  {u.isAdmin ? t('set.adminOn') : t('set.adminOff')}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5"><UserCog size={12} />{t('set.accessGuard')}</p>
      </Section>

      {/* ---------------- Data & sync ---------------- */}
      <Section icon={<DatabaseZap size={15} />} title={t('set.data')} sub={t('set.dataSub')}>
        <div className="grid sm:grid-cols-4 gap-2 text-center">
          {[
            { k: t('set.data.pending'), v: syncStatus.pending, tone: 'amber' },
            { k: t('set.data.failed'), v: syncStatus.failed, tone: 'red' },
            { k: t('set.data.conflicts'), v: syncStatus.conflicts, tone: 'gray' },
            { k: t('set.data.engine'), v: String(syncStatus.status || 'idle').toUpperCase(), tone: 'green' },
          ].map((c: any, i) => (
            <div key={i} className="rounded-xl border border-gray-200 px-2 py-2.5">
              <div className={`text-base font-bold ${c.tone === 'red' ? 'text-red-600' : c.tone === 'amber' ? 'text-amber-600' : 'text-gray-800'}`}>{c.v}</div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">{c.k}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => syncStatus.triggerSync()} data-testid="set-sync-now" className="text-xs px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 font-semibold text-gray-700 flex items-center gap-1.5"><RefreshCw size={13} />{t('set.syncNow')}</button>
          <button onClick={exportJson} disabled={busy === 'export'} data-testid="set-export" className="text-xs px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 font-semibold text-gray-700 flex items-center gap-1.5 disabled:opacity-50"><Download size={13} />{t('set.export')}</button>
          <button onClick={clearCache} disabled={busy === 'clear'} data-testid="set-clear" className="ml-auto text-xs px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-semibold flex items-center gap-1.5 disabled:opacity-50"><Trash2 size={13} />{t('set.clear')}</button>
        </div>
        <p className="text-[11px] text-gray-400">{t('set.exportHint')}</p>
      </Section>

      <p className="text-center text-[10px] text-gray-400">
        Buja Auto Spa ERP · {brand?.location || 'Bujumbura, Burundi'} · v1.0.0 — {t('set.footer')}
      </p>
    </div>
  );
}

export { applyTheme };
