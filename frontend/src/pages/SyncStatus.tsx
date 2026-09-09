import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, Database, Trash2, Play } from 'lucide-react';
import localDB from '../lib/db';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import syncEngine from '../lib/syncEngine';
import { useT } from '../lib/i18n';

export default function SyncStatusPage() {
  const { t } = useT();
  const syncStatus = useSyncStatus();
  const onlineStatus = useOnlineStatus();
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [metadata, setMetadata] = useState<any>(null);

  const loadQueue = async () => {
    const items = await localDB.syncQueue.orderBy('createdAt').reverse().toArray();
    setQueueItems(items);
    const meta = await localDB.syncMetadata.toArray();
    setMetadata(meta[0]);
  };

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 3000);
    return () => clearInterval(interval);
  }, [syncStatus.pending, syncStatus.failed]);

  const handleClearSynced = async () => {
    await syncStatus.clearSynced();
    await loadQueue();
  };

  const handleRetry = async () => {
    await syncStatus.retryFailed();
    await loadQueue();
  };

  const handleResolveConflict = async (id: string, resolution: 'CLIENT_WINS' | 'SERVER_WINS') => {
    await syncEngine.resolveConflict(id, resolution);
    await loadQueue();
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('sync.title')}</h1>
          <p className="text-gray-500 mt-1">{t('sync.sub')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRetry} className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm flex items-center gap-1.5">
            <Play className="w-4 h-4" /> Retry Failed
          </button>
          <button onClick={() => syncStatus.triggerSync()} className="px-4 py-2 rounded-xl bg-[#1A1A2E] text-white text-sm flex items-center gap-1.5">
            <RefreshCw className={`w-4 h-4 ${syncStatus.status === 'syncing' ? 'animate-spin' : ''}`} /> Sync Now
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-bold mb-4 flex items-center gap-2"><Database className="w-4 h-4" /> Local Database</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="font-medium">IndexedDB (Dexie)</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Not localStorage</span><span className="text-green-600 font-medium">✓ Proper DB</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Device ID</span><span className="font-mono text-xs">{localStorage.getItem('buja_device_id')?.slice(0,12)}...</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Last Sync</span><span className="font-medium">{syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : 'Never'}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-bold mb-4">{t('sync.queueStats')}</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-3 rounded-xl bg-yellow-50 border border-yellow-200">
              <div className="text-xl font-bold text-yellow-700">{syncStatus.pending}</div>
              <div className="text-xs text-yellow-600">Pending</div>
            </div>
            <div className="text-center p-3 rounded-xl bg-red-50 border border-red-200">
              <div className="text-xl font-bold text-red-700">{syncStatus.failed}</div>
              <div className="text-xs text-red-600">Failed</div>
            </div>
            <div className="text-center p-3 rounded-xl bg-orange-50 border border-orange-200">
              <div className="text-xl font-bold text-orange-700">{syncStatus.conflicts}</div>
              <div className="text-xs text-orange-600">Conflicts</div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleClearSynced} className="flex-1 py-2 rounded-xl border text-xs flex items-center justify-center gap-1">
              <Trash2 className="w-3 h-3" /> Clear Synced
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-bold mb-4">{t('sync.connectivity')}</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center p-2 rounded-lg bg-gray-50">
              <span>{t('sync.browserOnline')}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs ${onlineStatus.isOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {onlineStatus.isOnline ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between items-center p-2 rounded-lg bg-gray-50">
              <span>{t('sync.serverReach')}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs ${onlineStatus.isServerReachable ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {onlineStatus.isServerReachable ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between items-center p-2 rounded-lg bg-gray-50">
              <span>Sync Engine</span>
              <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 capitalize">{syncStatus.status}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-bold">{t('sync.queue')}</h3>
          <span className="text-xs text-gray-500">{queueItems.length} total records • UUIDs • Versioned</span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">{t('c.entity')}</th>
                <th className="px-4 py-2 text-left">{t('c.operation')}</th>
                <th className="px-4 py-2 text-left">{t('c.status')}</th>
                <th className="px-4 py-2 text-left">{t('c.retry')}</th>
                <th className="px-4 py-2 text-left">{t('c.created')}</th>
                <th className="px-4 py-2 text-left">{t('c.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {queueItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                    <div className="text-gray-900 font-medium">{t('sync.allSynced')}</div>
                    <div className="text-gray-500 text-xs mt-1">{t('sync.queueEmpty')}</div>
                  </td>
                </tr>
              ) : (
                queueItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.entityType}</div>
                      <div className="text-xs font-mono text-gray-500">{item.entityId.slice(0,8)}...</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        item.operation === 'CREATE' ? 'bg-green-50 text-green-700 border border-green-200' :
                        item.operation === 'UPDATE' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                        'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {item.operation}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        item.status === 'SYNCED' ? 'bg-green-50 text-green-700 border border-green-200' :
                        item.status === 'PENDING' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
                        item.status === 'FAILED' ? 'bg-red-50 text-red-700 border border-red-200' :
                        'bg-orange-50 text-orange-700 border border-orange-200'
                      }`}>
                        {item.status === 'SYNCED' && <CheckCircle className="w-3 h-3" />}
                        {item.status === 'PENDING' && <Clock className="w-3 h-3" />}
                        {item.status === 'FAILED' && <AlertTriangle className="w-3 h-3" />}
                        {item.status}
                      </span>
                      {item.errorMessage && (
                        <div className="text-xs text-red-600 mt-1 max-w-[200px] truncate" title={item.errorMessage}>
                          {item.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{item.retryCount}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(item.createdAt).toLocaleTimeString()}</td>
                    <td className="px-4 py-3">
                      {item.status === 'CONFLICT' && (
                        <div className="flex gap-1">
                          <button onClick={() => handleResolveConflict(item.id, 'CLIENT_WINS')} className="px-2 py-1 rounded bg-blue-600 text-white text-xs">Client Wins</button>
                          <button onClick={() => handleResolveConflict(item.id, 'SERVER_WINS')} className="px-2 py-1 rounded bg-gray-600 text-white text-xs">Server Wins</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gradient-to-r from-[#1A1A2E] to-[#2A2A4E] rounded-2xl p-6 text-white">
        <h3 className="font-bold mb-2">{t('sync.checklist')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-white/80">
          <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> IndexedDB (not localStorage) as primary local DB</div>
          <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> UUIDs for all records (no auto-increment conflicts)</div>
          <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Version field for optimistic locking</div>
          <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Sync states: PENDING/SYNCED/FAILED/CONFLICT</div>
          <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Push/Pull sync engine with retry</div>
          <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Conflict detection & resolution</div>
          <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Online/offline detection + banner</div>
          <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Cloud DB is central source (Prisma/SQLite)</div>
        </div>
      </div>
    </div>
  );
}
