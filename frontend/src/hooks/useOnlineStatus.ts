import { useState, useEffect } from 'react';
import apiClient from '../lib/api';
import type { OnlineStatus } from '../types';

export function useOnlineStatus(pingInterval: number = 30000) {
  const [status, setStatus] = useState<OnlineStatus>({
    isOnline: navigator.onLine,
    isServerReachable: navigator.onLine,
  });

  useEffect(() => {
    let interval: number | null = null;

    const updateOnline = () => {
      setStatus(prev => ({
        ...prev,
        isOnline: navigator.onLine,
        lastOnlineAt: navigator.onLine ? new Date().toISOString() : prev.lastOnlineAt,
        lastOfflineAt: !navigator.onLine ? new Date().toISOString() : prev.lastOfflineAt,
      }));
    };

    const checkServer = async () => {
      if (!navigator.onLine) {
        setStatus(prev => ({ ...prev, isServerReachable: false }));
        return;
      }

      try {
        await apiClient.healthCheck();
        setStatus(prev => ({ ...prev, isServerReachable: true }));
      } catch {
        setStatus(prev => ({ ...prev, isServerReachable: false }));
      }
    };

    // Initial check
    checkServer();

    window.addEventListener('online', () => {
      updateOnline();
      checkServer();
    });

    window.addEventListener('offline', updateOnline);

    // Periodic server check
    interval = window.setInterval(checkServer, pingInterval);

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      if (interval) clearInterval(interval);
    };
  }, [pingInterval]);

  return status;
}
