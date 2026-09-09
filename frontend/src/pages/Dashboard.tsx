import { useEffect, useState } from 'react';
import { 
  Users, Package, Truck, Wrench, Droplets, Zap, 
  TrendingUp, AlertTriangle, Database, Wifi, ShoppingCart, 
  RefreshCw, CheckCircle, Clock, Shield,
  Activity, HardDrive, Cloud, Smartphone
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSyncStatus } from '../hooks/useSyncStatus';
import localDB from '../lib/db';
import apiClient from '../lib/api';
import { Link } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { useMoney } from '../lib/money';

interface SystemStats {
  users: number;
  customers: number;
  products: number;
  lowStock: number;
  sales: number;
  balanceOut: number;
  localUsers: number;
  pendingSync: number;
  failedSync: number;
  conflicts: number;
  isServerConnected: boolean;
}

export default function Dashboard() {
  const { t } = useT();
  const { fmt: fmtBif } = useMoney();

  const { user } = useAuthStore();
  const onlineStatus = useOnlineStatus();
  const syncStatus = useSyncStatus();
  const [stats, setStats] = useState<SystemStats>({
    users: 0,
    customers: 0,
    products: 0,
    lowStock: 0,
    sales: 0,
    balanceOut: 0,
    localUsers: 0,
    pendingSync: 0,
    failedSync: 0,
    conflicts: 0,
    isServerConnected: false,
  });
  const [serverInfo, setServerInfo] = useState<any>(null);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [localUsersCount, pending, failed, conflicts] = await Promise.all([
          localDB.users.count(),
          localDB.getPendingSyncCount(),
          localDB.getFailedSyncCount(),
          localDB.getConflictCount(),
        ]);

        let serverUsers = 0;
        let serverConnected = false;
        let serverCustomers: number | null = null;
        try {
          const health = await apiClient.syncHealth() as any;
          serverUsers = health.stats?.users || 0;
          serverConnected = true;
          setServerInfo(health);
          try {
            const cstats = await apiClient.get<any>('/customers/stats');
            serverCustomers = cstats.total ?? null;
          } catch {
            serverCustomers = null;
          }
        } catch {
          serverConnected = false;
        }

        let serverProducts: number | null = null;
        let serverLowStock: number | null = null;
        try {
          const istats = await apiClient.get<any>('/inventory/stats');
          serverProducts = istats.total ?? null;
          serverLowStock = (istats.lowStock ?? 0) + (istats.outOfStock ?? 0);
        } catch {
          serverProducts = null;
          serverLowStock = null;
        }

        let serverSales: number | null = null;
        let serverBalance: number | null = null;
        try {
          const sstats = await apiClient.get<any>('/sales/stats');
          serverSales = sstats.total ?? null;
          serverBalance = sstats.balanceOutstanding ?? null;
        } catch {
          serverSales = null;
          serverBalance = null;
        }

        const localCustomersCount = await localDB.customers.count();
        const localProducts = await localDB.inventory.toArray();
        const localLow = localProducts.filter(pr => pr.stockQuantity <= pr.reorderLevel).length;

        setStats({
          users: serverUsers,
          customers: serverCustomers ?? localCustomersCount,
          products: serverProducts ?? localProducts.length,
          lowStock: serverLowStock ?? localLow,
          sales: serverSales ?? (await localDB.sales.count()),
          balanceOut: serverBalance ?? 0,
          localUsers: localUsersCount,
          pendingSync: pending,
          failedSync: failed,
          conflicts,
          isServerConnected: serverConnected,
        });
      } catch (e) {
        console.error('Failed to load stats', e);
      }
    };

    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [syncStatus.pending, syncStatus.failed]);

  const modules: Array<{ name: string; icon: any; color: string; count: string; sub?: string; desc: string; href: string; implemented?: boolean }> = [
    { name: 'nav.customers', icon: Users, color: 'from-indigo-500 to-purple-500', count: String(stats.customers), desc: 'dash.customersDesc', href: '/customers', implemented: true },
{ name: 'nav.truckParts', icon: Package, color: 'from-orange-500 to-red-500', count: String(stats.products), sub: stats.lowStock > 0 ? t('dash.lowStock', { n: stats.lowStock }) : undefined, desc: 'dash.partsDesc', href: '/inventory', implemented: true },
    { name: 'dash.salesName', icon: ShoppingCart, color: 'from-sky-500 to-blue-500', count: String(stats.sales), sub: stats.balanceOut > 0 ? t('dash.outstanding', { money: fmtBif(stats.balanceOut) }) : undefined, desc: 'dash.salesDesc', href: '/sales', implemented: true },
    { name: 'nav.maintenance', icon: Wrench, color: 'from-blue-500 to-cyan-500', count: 'Soon', desc: 'dash.maintDesc', href: '/maintenance' },
    { name: 'nav.carwash', icon: Droplets, color: 'from-cyan-500 to-blue-500', count: 'Soon', desc: 'dash.washDesc', href: '/carwash' },
    { name: 'nav.evRentals', icon: Zap, color: 'from-green-500 to-emerald-500', count: 'Soon', desc: 'dash.evDesc', href: '/ev-rentals' },
    { name: 'nav.truckRentals', icon: Truck, color: 'from-purple-500 to-pink-500', count: 'Soon', desc: 'dash.truckDesc', href: '/truck-rentals' },
];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('dash.hello', { name: user?.firstName || '' })}
          </h1>
          <p className="text-gray-500 mt-1">
            Buja Auto Spa ERP • Offline-First Foundation • Gitega, Burundi
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            onlineStatus.isOnline && onlineStatus.isServerReachable 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : onlineStatus.isOnline 
                ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                : 'bg-gray-100 text-gray-700 border border-gray-200'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              onlineStatus.isOnline && onlineStatus.isServerReachable ? 'bg-green-500 animate-pulse' : 
              onlineStatus.isOnline ? 'bg-yellow-500' : 'bg-gray-400'
            }`} />
            {onlineStatus.isOnline && onlineStatus.isServerReachable ? t('dash.cloudConn') : 
             onlineStatus.isOnline ? t('dash.localModeServer') : t('layout.offlineMode')}
          </div>
          
          <button
            onClick={() => syncStatus.triggerSync()}
            disabled={syncStatus.status === 'syncing' || !onlineStatus.isOnline}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1A1A2E] text-white text-xs font-medium hover:bg-black disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncStatus.status === 'syncing' ? 'animate-spin' : ''}`} />
            {t('dash.syncNow')}
          </button>
        </div>
      </div>

      {/* Architecture Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-gradient-to-br from-[#1A1A2E] to-[#2A2A4E] rounded-2xl p-6 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-[#FF6B00]/20 to-[#C1272D]/20 rounded-full blur-3xl" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold">{t('dash.foundTitle')}</h3>
                <p className="text-xs text-white/60">{t('dash.foundSub')}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4 mt-6">
              {[
                { label: t('dash.authRbac'), status: t('dash.active'), icon: Shield },
                { label: t('dash.localDb'), status: t('c.indexed'), icon: HardDrive },
                { label: t('dash.syncEngine'), status: t('dash.pendingN', { n: stats.pendingSync }), icon: RefreshCw },
                { label: 'PWA', status: t('dash.installed'), icon: Smartphone },
                { label: t('dash.cloudDb'), status: stats.isServerConnected ? t('dash.connected') : t('c.offline'), icon: Cloud },
                { label: t('dash.onlineDetect'), status: onlineStatus.isOnline ? t('c.online') : t('c.offline'), icon: Wifi },
              ].map((item) => (
                <div key={item.label} className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <item.icon className="w-4 h-4 mb-1.5 text-white/60" />
                  <div className="text-xs text-white/50">{item.label}</div>
                  <div className="text-sm font-medium">{item.status}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Sync Status
          </h3>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 rounded-xl bg-gray-50">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">{t('dash.lastSyncCap')}</span>
              </div>
              <span className="text-sm font-medium">
                {syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleTimeString() : t('c.never')}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-3 rounded-xl bg-yellow-50 border border-yellow-200">
                <div className="text-lg font-bold text-yellow-700">{stats.pendingSync}</div>
                <div className="text-xs text-yellow-600">{t('c.pending')}</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-red-50 border border-red-200">
                <div className="text-lg font-bold text-red-700">{stats.failedSync}</div>
                <div className="text-xs text-red-600">{t('dash.failedCap')}</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-orange-50 border border-orange-200">
                <div className="text-lg font-bold text-orange-700">{stats.conflicts}</div>
                <div className="text-xs text-orange-600">{t('dash.conflictsCap')}</div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => syncStatus.triggerSync()}
                className="flex-1 py-2 rounded-xl bg-[#1A1A2E] text-white text-sm font-medium hover:bg-black transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" /> Sync
              </button>
              <button
                onClick={() => syncStatus.retryFailed()}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                {t('dash.retryFailed')}
              </button>
            </div>

            {syncStatus.lastResult && (
              <div className="text-xs text-gray-500 p-2 rounded-lg bg-gray-50">
                {t('dash.lastRes', { p: syncStatus.lastResult.pushed, y: syncStatus.lastResult.pulled })}
                {syncStatus.lastResult.errors.length > 0 && (
                  <div className="text-red-600 mt-1">{syncStatus.lastResult.errors[0]}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('dash.cloudUsers'), value: stats.users, icon: Users, change: t('c.synced'), good: true, color: 'bg-blue-500' },
          { label: t('dash.localCache'), value: stats.localUsers, icon: Database, change: t('c.indexed'), good: false, color: 'bg-purple-500' },
          { label: t('dash.syncQueue'), value: stats.pendingSync + stats.failedSync, icon: RefreshCw, change: stats.pendingSync > 0 ? t('c.pending') : t('sync.clearQueue'), good: stats.pendingSync === 0, color: 'bg-orange-500' },
          { label: t('dash.sysHealth'), value: stats.isServerConnected ? '100%' : t('c.offline'), icon: CheckCircle, change: stats.isServerConnected ? t('dash.healthy') : t('dash.localOnly'), good: stats.isServerConnected, color: stats.isServerConnected ? 'bg-green-500' : 'bg-gray-400' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${stat.color} flex items-center justify-center text-white`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                (stat as any).good
                  ? 'bg-green-50 text-green-700' 
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {stat.change}
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
            <div className="text-sm text-gray-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Modules Preview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">{t('dash.bizModules')}</h2>
          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">{t('dash.modsLive', { n: 3 })}</span>
          </span>
        </div>
        
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((mod) => (
            <Link key={mod.name} to={mod.href} className={`bg-white rounded-2xl border p-5 transition-all group block text-left ${mod.implemented ? 'border-gray-200 hover:shadow-lg hover:border-gray-300' : 'border-gray-100 opacity-80'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${mod.color} flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform`}>
                  <mod.icon className="w-5 h-5" />
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">{mod.count === 'Soon' ? t('c.soon') : mod.count}</span>
              </div>
              <h3 className="font-semibold text-gray-900">{t(mod.name)}</h3>
              <p className="text-sm text-gray-500 mt-1">{t(mod.desc)}</p>
              <div className={`mt-3 flex items-center justify-between text-xs ${mod.implemented ? 'text-[#C1272D] font-medium' : 'text-gray-400'}`}>
                <span className="flex items-center gap-1">
                  {mod.sub ? <AlertTriangle className="w-3 h-3 text-orange-500" /> : <TrendingUp className="w-3 h-3" />}
                  {mod.sub || (mod.implemented ? t('dash.openModule') : t('dash.readyImpl'))}
                </span>
                {mod.implemented && <span>→</span>}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Tech Stack Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-bold text-gray-900 mb-4">Implemented Foundation</h3>
          <div className="space-y-3 text-sm">
            {[
              { task: 'Project Architecture (Monorepo)', done: true },
              { task: 'Authentication (JWT + Refresh)', done: true },
              { task: 'Database Foundation (Prisma + SQLite)', done: true },
              { task: 'Local Offline DB (Dexie/IndexedDB)', done: true },
              { task: 'Cloud Database Connection', done: true },
              { task: 'Sync Engine (Push/Pull + Conflicts)', done: true },
              { task: 'PWA Foundation (Manifest + SW)', done: true },
              { task: 'Online/Offline Detection', done: true },
              { task: 'User Roles & Permissions (RBAC)', done: true },
              { task: 'ERP Shell & Dashboard', done: true },
              { task: 'Customers Module (Phase 2)', done: true },
              { task: 'Inventory / Truck Parts Module (Phase 3)', done: true },
            ].map((item) => (
              <div key={item.task} className="flex items-center gap-2">
                <CheckCircle className={`w-4 h-4 ${item.done ? 'text-green-500' : 'text-gray-300'}`} />
                <span className={item.done ? 'text-gray-900' : 'text-gray-400'}>{item.task}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-bold text-gray-900 mb-4">System Information</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Environment</span>
              <span className="font-medium">Development</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Local DB</span>
              <span className="font-medium">IndexedDB (Dexie)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Cloud DB</span>
              <span className="font-medium">SQLite (Prisma) → PostgreSQL ready</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Device ID</span>
              <span className="font-mono text-xs">{localStorage.getItem('buja_device_id')?.slice(0,8)}...</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">User</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-500">Roles</span>
              <span className="font-medium">{(user?.roles as any)?.join(', ') || 'N/A'}</span>
            </div>
          </div>
          
          {serverInfo && (
            <div className="mt-4 p-3 rounded-xl bg-green-50 border border-green-200 text-xs">
              <div className="font-medium text-green-800">Server: {serverInfo.status}</div>
              <div className="text-green-600">Users: {serverInfo.stats?.users}, SyncLogs: {serverInfo.stats?.syncLogs}</div>
            </div>
          )}
        </div>
      </div>

      {/* Offline-First Explanation */}
      <div className="bg-gradient-to-r from-[#FF6B00]/10 to-[#C1272D]/10 border border-orange-200 rounded-2xl p-6">
        <div className="flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF6B00] to-[#C1272D] flex items-center justify-center text-white flex-shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Offline-First Architecture Verified</h3>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">
              This ERP continues operating when internet is unavailable. Data is stored in <strong>IndexedDB</strong> (not localStorage) via Dexie.js. 
              Changes are queued with states: <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs">PENDING</span> <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-800 text-xs">SYNCED</span> <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-xs">FAILED</span> <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 text-xs">CONFLICT</span>.
              Unique IDs (UUID) for all records. Conflict handling with last-write-wins + manual resolution. Try going offline - the app still works!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
