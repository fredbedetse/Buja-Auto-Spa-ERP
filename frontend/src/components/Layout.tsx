import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  Truck, 
  Wrench, 
  Car, 
  Zap, 
  Package,
  ShoppingCart,
  FileText,
  CreditCard,
  BarChart3,
  Settings,
  Shield,
  LogOut,
  Menu,
  X,
  Bell,
  Search,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  Droplets,
  Building2,
  UserCog
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSyncStatus } from '../hooks/useSyncStatus';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, module: 'dashboard:read', exact: true },
  { name: 'Customers', href: '/customers', icon: Users, module: 'customers:read', badge: 'Soon' },
  { name: 'Suppliers', href: '/suppliers', icon: Building2, module: 'suppliers:read', badge: 'Soon' },
  { name: 'Vehicles', href: '/vehicles', icon: Truck, module: 'vehicles:read', badge: 'Soon' },
  { name: 'Employees', href: '/employees', icon: UserCog, module: 'users:read', badge: 'Soon' },
  { name: 'Truck Parts', href: '/inventory', icon: Package, module: 'inventory:read', badge: 'Soon' },
  { name: 'Purchases', href: '/purchases', icon: ShoppingCart, module: 'purchases:read', badge: 'Soon' },
  { name: 'Sales', href: '/sales', icon: ShoppingCart, module: 'sales:read', badge: 'Soon' },
  { name: 'Invoices', href: '/invoices', icon: FileText, module: 'invoices:read', badge: 'Soon' },
  { name: 'Payments', href: '/payments', icon: CreditCard, module: 'payments:read', badge: 'Soon' },
  { name: 'Car Wash', href: '/carwash', icon: Droplets, module: 'carwash:read', badge: 'Soon' },
  { name: 'Maintenance', href: '/maintenance', icon: Wrench, module: 'maintenance:read', badge: 'Soon' },
  { name: 'EV Rentals', href: '/ev-rentals', icon: Zap, module: 'evrentals:read', badge: 'Soon' },
  { name: 'Truck Rentals', href: '/truck-rentals', icon: Truck, module: 'truckrentals:read', badge: 'Soon' },
  { name: 'Reports', href: '/reports', icon: BarChart3, module: 'reports:read', badge: 'Soon' },
  { name: 'Users & Roles', href: '/users', icon: Shield, module: 'users:read' },
  { name: 'Settings', href: '/settings', icon: Settings, module: 'settings:read', badge: 'Soon' },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout, hasPermission } = useAuthStore();
  const onlineStatus = useOnlineStatus();
  const syncStatus = useSyncStatus();
  const navigate = useNavigate();

  const filteredNav = navigation.filter(item => {
    if (item.module === 'dashboard:read') return true;
    if (user?.roles?.includes('SUPER_ADMIN' as any)) return true;
    return hasPermission(item.module);
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getSyncStatusColor = () => {
    if (!onlineStatus.isOnline) return 'bg-gray-400';
    if (syncStatus.status === 'syncing') return 'bg-blue-500 animate-pulse';
    if (syncStatus.failed > 0 || syncStatus.conflicts > 0) return 'bg-red-500';
    if (syncStatus.pending > 0) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getSyncStatusText = () => {
    if (!onlineStatus.isOnline) return 'Offline';
    if (syncStatus.status === 'syncing') return 'Syncing...';
    if (syncStatus.conflicts > 0) return `${syncStatus.conflicts} conflicts`;
    if (syncStatus.failed > 0) return `${syncStatus.failed} failed`;
    if (syncStatus.pending > 0) return `${syncStatus.pending} pending`;
    return 'Synced';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-[#1A1A2E] text-white transform transition-transform duration-300 ease-in-out lg:translate-x-0 flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:static lg:inset-auto lg:flex-shrink-0
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#FF6B00] to-[#C1272D] flex items-center justify-center font-bold text-sm">
              BA
            </div>
            <div>
              <div className="font-bold text-sm tracking-wide">BUJA AUTO SPA</div>
              <div className="text-[10px] text-white/60 tracking-widest">ERP SYSTEM</div>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-2 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Online/Offline & Sync Status Card */}
        <div className="mx-4 mt-4 p-3 rounded-xl bg-white/5 border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs">
              {onlineStatus.isOnline ? (
                <><Wifi className="w-4 h-4 text-green-400" /> <span className="text-green-400">Online</span></>
              ) : (
                <><WifiOff className="w-4 h-4 text-gray-400" /> <span className="text-gray-400">Offline Mode</span></>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${getSyncStatusColor()}`} />
              <span className="text-[10px] text-white/70">{getSyncStatusText()}</span>
            </div>
          </div>
          
          <div className="flex items-center justify-between text-[11px] text-white/50">
            <span>Last sync: {syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleTimeString() : 'Never'}</span>
            <button 
              onClick={() => syncStatus.triggerSync()}
              disabled={syncStatus.status === 'syncing' || !onlineStatus.isOnline}
              className="p-1 rounded hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncStatus.status === 'syncing' ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {(syncStatus.pending > 0 || syncStatus.failed > 0 || syncStatus.conflicts > 0) && (
            <div className="mt-2 pt-2 border-t border-white/10 flex gap-2 text-[10px]">
              {syncStatus.pending > 0 && <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">{syncStatus.pending} pending</span>}
              {syncStatus.failed > 0 && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">{syncStatus.failed} failed</span>}
              {syncStatus.conflicts > 0 && <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">{syncStatus.conflicts} conflicts</span>}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1 scrollbar-thin">
          {filteredNav.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                  isActive
                    ? 'bg-gradient-to-r from-[#FF6B00] to-[#C1272D] text-white shadow-lg shadow-orange-500/20'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span className="flex-1">{item.name}</span>
              {item.badge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">{item.badge}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User profile */}
        <div className="p-4 border-t border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</div>
              <div className="text-xs text-white/50 truncate">{user?.email}</div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(Array.isArray(user?.roles) ? user?.roles : []).slice(0,2).map((role: any) => (
              <span key={typeof role === 'string' ? role : role.name} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                {typeof role === 'string' ? role : role.displayName || role.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 flex-shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100">
              <Menu className="w-5 h-5" />
            </button>
            
            <div className="hidden lg:flex items-center gap-2 text-sm text-gray-500">
              <span>Buja Auto Spa ERP</span>
              <span>/</span>
              <span className="text-gray-900 font-medium">Dashboard</span>
            </div>

            {/* Global Search - placeholder */}
            <div className="hidden md:flex items-center gap-2 ml-6">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  placeholder="Search customers, parts, invoices... (soon)"
                  className="pl-9 pr-4 py-2 w-80 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B00]/20 focus:border-[#FF6B00] focus:bg-white transition-all"
                  disabled
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Sync indicator mobile */}
            <div className="flex lg:hidden items-center gap-2 px-2.5 py-1.5 rounded-full bg-gray-100 text-xs">
              <div className={`w-2 h-2 rounded-full ${getSyncStatusColor()}`} />
              <span>{getSyncStatusText()}</span>
            </div>

            <button className="relative p-2.5 rounded-xl hover:bg-gray-100 transition-colors">
              <Bell className="w-5 h-5 text-gray-600" />
              {syncStatus.conflicts > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
            </button>

            <div className="hidden sm:flex items-center gap-2 pl-2 ml-2 border-l border-gray-200">
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">{user?.firstName} {user?.lastName}</div>
                <div className="text-xs text-gray-500">{onlineStatus.isServerReachable ? 'Cloud connected' : 'Local mode'}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-[#f8fafc] p-4 lg:p-6">
          <Outlet />
        </main>

        {/* Offline banner */}
        {!onlineStatus.isOnline && (
          <div className="bg-[#1A1A2E] text-white px-4 py-2.5 flex items-center justify-center gap-2 text-sm">
            <WifiOff className="w-4 h-4" />
            <span>You are offline - ERP continues to work. Changes will sync when online.</span>
            <span className="hidden sm:inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-white/10 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              {syncStatus.pending} pending
            </span>
          </div>
        )}

        {/* Conflict banner */}
        {syncStatus.conflicts > 0 && onlineStatus.isOnline && (
          <div className="bg-amber-500 text-white px-4 py-2.5 flex items-center justify-center gap-2 text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span>{syncStatus.conflicts} sync conflicts need resolution</span>
            <button 
              onClick={() => window.location.href = '/sync-status'}
              className="ml-2 px-3 py-1 rounded-full bg-white text-amber-600 text-xs font-medium hover:bg-amber-50"
            >
              Resolve
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
