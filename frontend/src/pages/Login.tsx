import { useState } from 'react';
import { useT } from '../lib/i18n';
import UiToggles from '../components/UiToggles';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Eye, EyeOff, Truck, Wrench, Zap, Droplets, Shield, Wifi, Database, RefreshCw } from 'lucide-react';

export default function Login() {
  const { t } = useT();

  const [identifier, setIdentifier] = useState('admin@bujaautospa.bi');
  const [password, setPassword] = useState('Admin@123456');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { login, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(identifier, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || t('login.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left - Branding & Features */}
      <div className="hidden lg:flex lg:w-[55%] bg-[#1A1A2E] text-white relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-72 h-72 bg-[#FF6B00] rounded-full blur-[100px]" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-[#C1272D] rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <div className="flex items-center gap-3 mb-12">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF6B00] to-[#C1272D] flex items-center justify-center font-bold text-lg shadow-xl">
                BA
              </div>
              <div>
                <div className="font-bold text-xl tracking-wide">BUJA AUTO SPA</div>
                <div className="text-xs text-white/60 tracking-[0.2em]">ENTERPRISE ERP</div>
              </div>
            </div>

            <h1 className="text-4xl font-bold leading-tight mb-4">
              Offline-First ERP<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF6B00] to-[#C1272D]">{t('login.builtFor')}</span>
            </h1>
            <p className="text-white/60 text-lg leading-relaxed max-w-lg">
              Complete business management for truck parts, maintenance, EV & truck rentals, and car wash. Works offline, syncs when online.
            </p>

            <div className="grid grid-cols-2 gap-4 mt-12 max-w-lg">
              {[
                { icon: Database, title: 'Offline-First', desc: 'Works without internet' },
                { icon: RefreshCw, title: 'Auto Sync', desc: 'Cloud sync when online' },
                { icon: Shield, title: 'Role-Based', desc: 'Secure permissions' },
                { icon: Wifi, title: 'PWA Ready', desc: 'Install on any device' },
              ].map((feature) => (
                <div key={feature.title} className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur">
                  <feature.icon className="w-6 h-6 mb-2 text-[#FF6B00]" />
                  <div className="font-medium text-sm">{feature.title}</div>
                  <div className="text-xs text-white/50">{feature.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-6 text-white/40 text-sm">
              <div className="flex items-center gap-2"><Truck className="w-4 h-4" /> Truck Parts</div>
              <div className="flex items-center gap-2"><Wrench className="w-4 h-4" /> Maintenance</div>
              <div className="flex items-center gap-2"><Zap className="w-4 h-4" /> EV Rentals</div>
              <div className="flex items-center gap-2"><Droplets className="w-4 h-4" /> Car Wash</div>
            </div>
            <div className="mt-6 pt-6 border-t border-white/10 text-xs text-white/30">
              © 2024 Buja Auto Spa - Gitega, Burundi • Offline-First Architecture • v1.0.0 Foundation
            </div>
          </div>
        </div>
      </div>

      {/* Right - Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-gray-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF6B00] to-[#C1272D] flex items-center justify-center font-bold text-white shadow-lg">
              BA
            </div>
            <div>
              <div className="font-bold text-gray-900">BUJA AUTO SPA</div>
              <div className="text-xs text-gray-500 tracking-widest">ERP SYSTEM</div>
            </div>
          </div>

          <div className="bg-white rounded-[24px] shadow-xl shadow-gray-200/50 border border-gray-100 p-8">
            <div className="mb-8">
              <div className="flex justify-end mb-3"><UiToggles /></div>
              <h2 className="text-2xl font-bold text-gray-900">{t('login.welcome')}</h2>
              <p className="text-gray-500 mt-1">{t('login.sub')}</p>
            </div>

            {error && (
              <div className="mb-6 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('login.id')}</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6B00]/20 focus:border-[#FF6B00] transition-all text-sm"
                  placeholder="admin@bujaautospa.bi"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('login.password')}</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-11 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6B00]/20 focus:border-[#FF6B00] transition-all text-sm"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#FF6B00] to-[#C1272D] text-white font-medium shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('login.signing')}
                  </>
                ) : (
                  t('login.signIn')
                )}
              </button>
            </form>

            <div className="mt-8 p-4 rounded-xl bg-gray-50 border border-gray-100">
              <div className="text-xs font-medium text-gray-700 mb-2">{t('login.demo')}</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Super Admin:</span>
                  <span className="font-mono text-gray-700">admin@bujaautospa.bi / Admin@123456</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Manager:</span>
                  <span className="font-mono text-gray-700">manager@bujaautospa.bi / Manager@123</span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400">
              <Database className="w-3 h-3" />
              <span>{t('login.tagline')}</span>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-gray-400">
            Architecture: Offline-First • RBAC • PWA • Sync Engine • Conflict Resolution
          </div>
        </div>
      </div>
    </div>
  );
}
