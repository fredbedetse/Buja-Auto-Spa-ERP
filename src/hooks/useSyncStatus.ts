import { useState, useEffect } from 'react';
import syncEngine, { type SyncEngineStatus, type SyncResult } from '../lib/syncEngine';
import localDB from '../lib/db';

export interface SyncState {
  status: SyncEngineStatus;
  pending: number;
  failed: number;
  conflicts: number;
  lastSyncAt: string | null;
  lastResult?: SyncResult;
  isOnline: boolean;
}

export function useSyncStatus() {
  const [state, setState] = useState<SyncState>({
    status: syncEngine.getStatus(),
    pending: 0,
    failed: 0,
    conflicts: 0,
    lastSyncAt: syncEngine.getLastSyncAt(),
    isOnline: navigator.onLine,
  });

  useEffect(() => {
    let mounted = true;

    const updateCounts = async () => {
      if (!mounted) return;
      try {
        const status = await syncEngine.getSyncStatus();
        setState(prev => ({
          ...prev,
          pending: status.pending,
          failed: status.failed,
          conflicts: status.conflicts,
          lastSyncAt: status.lastSyncAt,
          isOnline: status.isOnline,
        }));
      } catch (e) {
        console.error('Failed to get sync status', e);
      }
    };

    // Initial load
    updateCounts();

    // Subscribe to sync engine status changes
    const unsubscribe = syncEngine.subscribe((status, result) => {
      if (!mounted) return;
      setState(prev => ({
        ...prev,
        status,
        lastResult: result || prev.lastResult,
        lastSyncAt: result?.timestamp || prev.lastSyncAt,
      }));
      updateCounts();
    });

    // Poll counts every 5 seconds
    const interval = setInterval(updateCounts, 5000);

    // Also listen to DB changes
    const handleDbChange = () => updateCounts();
    window.addEventListener('online', handleDbChange);
    window.addEventListener('offline', handleDbChange);

    return () => {
      mounted = false;
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener('online', handleDbChange);
      window.removeEventListener('offline', handleDbChange);
    };
  }, []);

  const triggerSync = async () => {
    return await syncEngine.sync();
  };

  const retryFailed = async () => {
    const count = await syncEngine.retryFailed();
    await triggerSync();
    return count;
  };

  const clearSynced = async () => {
    return await syncEngine.clearSynced();
  };

  return {
    ...state,
    triggerSync,
    retryFailed,
    clearSynced,
    syncEngine,
  };
}
