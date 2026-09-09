import { Construction, ArrowLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useT } from '../lib/i18n';

export default function NotImplemented() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();
  const moduleName = location.pathname.replace('/', '').replace('-', ' ');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#16A34A] to-[#15803D] flex items-center justify-center text-white mb-6 shadow-xl">
        <Construction className="w-10 h-10" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 capitalize">{moduleName ? t('ni.module', { name: moduleName }) : t('ni.this')}</h1>
      <p className="text-gray-500 mt-2 max-w-md">
        {t('ni.body')}
      </p>
      <div className="mt-6 flex gap-2">
        <button onClick={() => navigate('/dashboard')} className="px-4 py-2 rounded-xl bg-[#1A1A2E] text-white text-sm flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> {t('ni.back')}
        </button>
        <button onClick={() => navigate('/sync-status')} className="px-4 py-2 rounded-xl border border-gray-200 text-sm">
          View Sync Status
        </button>
      </div>
      <div className="mt-8 p-4 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500 max-w-md">
        <div className="font-medium text-gray-700 mb-1">{t('ni.done')}</div>
        {t('ni.list')}
      </div>
    </div>
  );
}
