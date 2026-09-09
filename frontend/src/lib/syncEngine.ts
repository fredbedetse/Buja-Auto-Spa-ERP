// Synchronization Engine - Core of offline-first architecture
// Handles pushing local changes and pulling remote changes

import localDB from './db';
import apiClient from './api';
import { getDeviceId } from './device';
import type { SyncQueueItem } from '../types';

export type SyncEngineStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  failed: number;
  errors: string[];
  timestamp: string;
}

class SyncEngine {
  private status: SyncEngineStatus = 'idle';
  private lastSyncAt: string | null = null;
  private syncInterval: number | null = null;
  private listeners: Set<(status: SyncEngineStatus, result?: SyncResult) => void> = new Set();
  private isSyncing = false;

  constructor() {
    // Load last sync from localStorage
    this.lastSyncAt = localStorage.getItem('buja_last_sync_at');
    
    // Auto-sync every 30 seconds when online
    if (typeof window !== 'undefined') {
      this.startAutoSync();
      
      // Listen to online/offline
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }

  getStatus(): SyncEngineStatus {
    return this.status;
  }

  getLastSyncAt(): string | null {
    return this.lastSyncAt;
  }

  subscribe(listener: (status: SyncEngineStatus, result?: SyncResult) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(status: SyncEngineStatus, result?: SyncResult) {
    this.status = status;
    this.listeners.forEach(l => l(status, result));
  }

  private handleOnline() {
    console.log('🌐 Device online - triggering sync');
    this.sync();
  }

  private handleOffline() {
    console.log('📴 Device offline');
    this.notify('offline');
  }

  startAutoSync(intervalMs: number = 30000) {
    this.stopAutoSync();
    this.syncInterval = window.setInterval(() => {
      if (navigator.onLine && !this.isSyncing) {
        this.sync();
      }
    }, intervalMs);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async pushChanges(): Promise<{ pushed: number; failed: number; conflicts: number; errors: string[] }> {
    const deviceId = getDeviceId();
    const pendingItems = await localDB.syncQueue
      .where('status')
      .equals('PENDING')
      .toArray();

    if (pendingItems.length === 0) {
      return { pushed: 0, failed: 0, conflicts: 0, errors: [] };
    }

    console.log(`📤 Pushing ${pendingItems.length} pending changes...`);

    try {
      const payload = {
        deviceId,
        clientTimestamp: new Date().toISOString(),
        changes: pendingItems.map(item => ({
          id: item.id,
          entityType: item.entityType,
          entityId: item.entityId,
          operation: item.operation,
          data: item.data,
          version: item.version,
          clientVersion: item.clientVersion,
          timestamp: item.updatedAt,
        })),
      };

      const response = await apiClient.post<{
        success: boolean;
        processed: number;
        results: Array<{
          entityType: string;
          entityId: string;
          status: string;
          version?: number;
          error?: string;
          serverVersion?: number;
          serverData?: any;
        }>;
      }>('/sync/push', payload, { signal: AbortSignal.timeout(20000) });

      let pushed = 0;
      let failed = 0;
      let conflicts = 0;
      const errors: string[] = [];

      // Update local queue based on results
      for (const result of response.results) {
        const queueItem = pendingItems.find(
          item => item.entityId === result.entityId && item.entityType === result.entityType
        );

        if (!queueItem) continue;

        if (result.status === 'SYNCED') {
          await localDB.syncQueue.update(queueItem.id, {
            status: 'SYNCED',
            version: result.version,
            updatedAt: new Date().toISOString(),
            errorMessage: undefined,
          });

          // Mark the local entity record clean too (server accepted it).
          // Without this, dirty records keep showing "Pending" forever after
          // their queue item drains, and pull keeps skipping fresh server data.
          if (queueItem.operation !== 'DELETE') {
            try {
              if (result.entityType === 'User') {
                await localDB.users.update(result.entityId, {
                  _dirty: false,
                  syncStatus: 'SYNCED',
                  ...(result.version ? { version: result.version } : {}),
                } as any);
              } else if (result.entityType === 'Customer') {
                await localDB.customers.update(result.entityId, {
                  _dirty: false,
                  syncStatus: 'SYNCED',
                  ...(result.version ? { version: result.version } : {}),
                } as any);
              } else if (result.entityType === 'Product') {
                await localDB.inventory.update(result.entityId, {
                  _dirty: false,
                  syncStatus: 'SYNCED',
                  ...(result.version ? { version: result.version } : {}),
                } as any);
              } else if (result.entityType === 'Sale') {
                // Server assigned the canonical invoiceNo - keep it
                const upd: any = { _dirty: false, syncStatus: 'SYNCED' };
                if (result.version) upd.version = result.version;
                if ((result as any).invoiceNo) upd.invoiceNo = (result as any).invoiceNo;
                await localDB.sales.update(result.entityId, upd);
              } else if (result.entityType === 'Supplier') {
                await localDB.suppliers.update(result.entityId, {
                  _dirty: false,
                  syncStatus: 'SYNCED',
                  ...(result.version ? { version: result.version } : {}),
                } as any);
              } else if (result.entityType === 'Purchase') {
                // Server assigned the canonical PO number - keep it
                const upd: any = { _dirty: false, syncStatus: 'SYNCED' };
                if (result.version) upd.version = result.version;
                if ((result as any).poNumber) upd.poNumber = (result as any).poNumber;
                await localDB.purchases.update(result.entityId, upd);
              } else if (result.entityType === 'Vehicle') {
                await localDB.vehicles.update(result.entityId, {
                  _dirty: false,
                  syncStatus: 'SYNCED',
                  ...(result.version ? { version: result.version } : {}),
                } as any);
              } else if (result.entityType === 'Employee') {
                await localDB.employees.update(result.entityId, {
                  _dirty: false,
                  syncStatus: 'SYNCED',
                  ...(result.version ? { version: result.version } : {}),
                } as any);
              } else if (result.entityType === 'Payment') {
                // Server assigned the canonical receipt number - keep it
                const upd: any = { _dirty: false, syncStatus: 'SYNCED' };
                if (result.version) upd.version = result.version;
                if ((result as any).paymentNo) upd.paymentNo = (result as any).paymentNo;
                await localDB.payments.update(result.entityId, upd);
              } else if (result.entityType === 'CarWashOrder') {
                // Server assigned the canonical wash order number
                const upd: any = { _dirty: false, syncStatus: 'SYNCED' };
                if (result.version) upd.version = result.version;
                if ((result as any).orderNo) upd.orderNo = (result as any).orderNo;
                await localDB.washOrders.update(result.entityId, upd);
              } else if (result.entityType === 'MaintenanceOrder') {
                // Server assigned the canonical WO number and recomputed parts money
                const upd: any = { _dirty: false, syncStatus: 'SYNCED' };
                if (result.version) upd.version = result.version;
                if ((result as any).orderNo) upd.orderNo = (result as any).orderNo;
                await localDB.maintenanceOrders.update(result.entityId, upd);
              }
            } catch (e) {
              console.warn('Could not mark record synced locally:', e);
            }
          }
          pushed++;
        } else if (result.status === 'CONFLICT') {
          await localDB.syncQueue.update(queueItem.id, {
            status: 'CONFLICT',
            updatedAt: new Date().toISOString(),
            errorMessage: result.error,
            data: {
              ...queueItem.data,
              _conflict: {
                serverVersion: result.serverVersion,
                serverData: result.serverData,
              }
            }
          });
          conflicts++;
          errors.push(`Conflict: ${result.entityType} ${result.entityId}`);
        } else {
          await localDB.syncQueue.update(queueItem.id, {
            status: 'FAILED',
            retryCount: queueItem.retryCount + 1,
            errorMessage: result.error,
            updatedAt: new Date().toISOString(),
          });
          failed++;
          if (result.error) errors.push(result.error);
        }
      }

      console.log(`✅ Push complete: ${pushed} synced, ${conflicts} conflicts, ${failed} failed`);
      return { pushed, failed, conflicts, errors };

    } catch (error: any) {
      console.error('❌ Push failed:', error);
      
      if (error.message.includes('OFFLINE')) {
        this.notify('offline');
        return { pushed: 0, failed: 0, conflicts: 0, errors: ['Offline'] };
      }

      // Mark items as failed if server error
      for (const item of pendingItems) {
        if (item.retryCount >= 3) {
          await localDB.syncQueue.update(item.id, {
            status: 'FAILED',
            errorMessage: error.message,
            updatedAt: new Date().toISOString(),
          });
        } else {
          await localDB.syncQueue.update(item.id, {
            retryCount: item.retryCount + 1,
            errorMessage: error.message,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      return { pushed: 0, failed: pendingItems.length, conflicts: 0, errors: [error.message] };
    }
  }

  async pullChanges(): Promise<{ pulled: number; errors: string[] }> {
    const deviceId = getDeviceId();
    
    try {
      console.log(`📥 Pulling changes since ${this.lastSyncAt || 'beginning'}...`);

      const response = await apiClient.post<{
        changes: Array<{
          entityType: string;
          entityId: string;
          operation: string;
          data: any;
          version: number;
          timestamp: string;
        }>;
        count: number;
        timestamp: string;
        hasMore: boolean;
      }>('/sync/pull', {
        deviceId,
        lastSyncAt: this.lastSyncAt,
        limit: 100,
      }, { signal: AbortSignal.timeout(20000) });

      let pulled = 0;

      for (const change of response.changes) {
        try {
          if (change.entityType === 'User') {
            if (change.operation === 'DELETE') {
              await localDB.users.delete(change.entityId);
            } else {
              // Upsert user
              const existing = await localDB.users.get(change.entityId);
              if (existing) {
                // Conflict check - if local is dirty and newer, keep local
                if ((existing as any)._dirty) {
                  console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                  continue;
                }
              }

              await localDB.users.put({
                ...change.data,
                syncStatus: 'SYNCED',
                _dirty: false,
              });
            }
            pulled++;
          } else if (change.entityType === 'Customer') {
            if (change.operation === 'DELETE') {
              await localDB.customers.delete(change.entityId);
            } else {
              const existing = await localDB.customers.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.customers.put({
                ...change.data,
                syncStatus: 'SYNCED',
                _dirty: false,
              });
            }
            pulled++;
          } else if (change.entityType === 'Product') {
            if (change.operation === 'DELETE') {
              await localDB.inventory.delete(change.entityId);
            } else {
              const existing = await localDB.inventory.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.inventory.put({
                ...change.data,
                syncStatus: 'SYNCED',
                _dirty: false,
              });
            }
            pulled++;
          } else if (change.entityType === 'Sale') {
            if (change.operation === 'DELETE') {
              await localDB.sales.delete(change.entityId);
            } else {
              const existing = await localDB.sales.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.sales.put({
                ...change.data,
                syncStatus: 'SYNCED',
                _dirty: false,
              });
            }
            pulled++;
          } else if (change.entityType === 'Supplier') {
            if (change.operation === 'DELETE') {
              await localDB.suppliers.delete(change.entityId);
            } else {
              const existing = await localDB.suppliers.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.suppliers.put({ ...change.data, syncStatus: 'SYNCED', _dirty: false });
            }
            pulled++;
          } else if (change.entityType === 'Vehicle') {
            if (change.operation === 'DELETE') {
              await localDB.vehicles.delete(change.entityId);
            } else {
              const existing = await localDB.vehicles.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.vehicles.put({ ...change.data, syncStatus: 'SYNCED', _dirty: false });
            }
            pulled++;
          } else if (change.entityType === 'CarWashOrder') {
            if (change.operation === 'DELETE') {
              await localDB.washOrders.delete(change.entityId);
            } else {
              const existing = await localDB.washOrders.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.washOrders.put({ ...change.data, syncStatus: 'SYNCED', _dirty: false });
            }
            pulled++;
          } else if (change.entityType === 'MaintenanceOrder') {
            if (change.operation === 'DELETE') {
              await localDB.maintenanceOrders.delete(change.entityId);
            } else {
              const existing = await localDB.maintenanceOrders.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.maintenanceOrders.put({ ...change.data, syncStatus: 'SYNCED', _dirty: false });
            }
            pulled++;
          } else if (change.entityType === 'Payment') {
            if (change.operation === 'DELETE') {
              await localDB.payments.delete(change.entityId);
            } else {
              const existing = await localDB.payments.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.payments.put({ ...change.data, syncStatus: 'SYNCED', _dirty: false });
            }
            pulled++;
          } else if (change.entityType === 'Employee') {
            if (change.operation === 'DELETE') {
              await localDB.employees.delete(change.entityId);
            } else {
              const existing = await localDB.employees.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.employees.put({ ...change.data, syncStatus: 'SYNCED', _dirty: false });
            }
            pulled++;
          } else if (change.entityType === 'Purchase') {
            if (change.operation === 'DELETE') {
              await localDB.purchases.delete(change.entityId);
            } else {
              const existing = await localDB.purchases.get(change.entityId);
              if (existing && (existing as any)._dirty) {
                console.log(`⚠️ Skipping pull for dirty local record: ${change.entityId}`);
                continue;
              }
              await localDB.purchases.put({ ...change.data, syncStatus: 'SYNCED', _dirty: false });
            }
            pulled++;
          } else {
            // Future entities
            console.log(`Pull for ${change.entityType} not yet implemented in local DB`);
            pulled++;
          }
        } catch (itemError) {
          console.error(`Failed to apply pulled change ${change.entityId}:`, itemError);
        }
      }

      // Update last sync timestamp
      if (response.changes.length > 0) {
        const latestTimestamp = response.changes[response.changes.length - 1].timestamp;
        this.lastSyncAt = latestTimestamp;
        localStorage.setItem('buja_last_sync_at', latestTimestamp);
      } else {
        // Even if no changes, update to server time to avoid re-pulling same window
        this.lastSyncAt = response.timestamp;
        localStorage.setItem('buja_last_sync_at', response.timestamp);
      }

      console.log(`✅ Pull complete: ${pulled} changes`);
      return { pulled, errors: [] };

    } catch (error: any) {
      console.error('❌ Pull failed:', error);
      if (error.message.includes('OFFLINE')) {
        this.notify('offline');
        return { pulled: 0, errors: ['Offline'] };
      }
      return { pulled: 0, errors: [error.message] };
    }
  }

  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      console.log('⏳ Sync already in progress, skipping');
      return {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        failed: 0,
        errors: ['Sync already in progress'],
        timestamp: new Date().toISOString(),
      };
    }

    if (!navigator.onLine) {
      this.notify('offline');
      return {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        failed: 0,
        errors: ['Offline'],
        timestamp: new Date().toISOString(),
      };
    }

    this.isSyncing = true;
    this.notify('syncing');

    const startTime = Date.now();
    console.log('🔄 Starting sync...');

    try {
      // First push local changes, then pull remote
      const pushResult = await this.pushChanges();
      const pullResult = await this.pullChanges();

      const result: SyncResult = {
        success: pushResult.failed === 0 && pullResult.errors.length === 0,
        pushed: pushResult.pushed,
        pulled: pullResult.pulled,
        conflicts: pushResult.conflicts,
        failed: pushResult.failed,
        errors: [...pushResult.errors, ...pullResult.errors],
        timestamp: new Date().toISOString(),
      };

      // Update sync metadata in local DB
      const deviceId = getDeviceId();
      const existingMeta = await localDB.syncMetadata.get(deviceId);
      const pendingCount = await localDB.getPendingSyncCount();
      const failedCount = await localDB.getFailedSyncCount();

      if (existingMeta) {
        await localDB.syncMetadata.update(deviceId, {
          lastSyncAt: result.timestamp,
          lastPushAt: new Date().toISOString(),
          lastPullAt: new Date().toISOString(),
          pendingCount,
          failedCount,
        });
      } else {
        await localDB.syncMetadata.add({
          deviceId,
          lastSyncAt: result.timestamp,
          lastPushAt: new Date().toISOString(),
          lastPullAt: new Date().toISOString(),
          pendingCount,
          failedCount,
        });
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Sync completed in ${duration}ms:`, result);

      this.notify(result.success ? 'idle' : 'error', result);
      return result;

    } catch (error: any) {
      console.error('❌ Sync failed:', error);
      const result: SyncResult = {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        failed: 0,
        errors: [error.message],
        timestamp: new Date().toISOString(),
      };
      this.notify('error', result);
      return result;
    } finally {
      this.isSyncing = false;
    }
  }

  async getSyncStatus() {
    const deviceId = getDeviceId();
    const pending = await localDB.getPendingSyncCount();
    const failed = await localDB.getFailedSyncCount();
    const conflicts = await localDB.getConflictCount();
    const metadata = await localDB.syncMetadata.get(deviceId);

    return {
      pending,
      failed,
      conflicts,
      metadata,
      lastSyncAt: this.lastSyncAt,
      status: this.status,
      isOnline: navigator.onLine,
    };
  }

  async clearSynced() {
    return await localDB.clearSyncedItems();
  }

  async retryFailed() {
    const failedItems = await localDB.syncQueue.where('status').equals('FAILED').toArray();
    for (const item of failedItems) {
      await localDB.syncQueue.update(item.id, {
        status: 'PENDING',
        retryCount: 0,
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
    return failedItems.length;
  }

  async resolveConflict(queueId: string, resolution: 'CLIENT_WINS' | 'SERVER_WINS' | 'MERGE', mergedData?: any) {
    const item = await localDB.syncQueue.get(queueId);
    if (!item || item.status !== 'CONFLICT') {
      throw new Error('Conflict not found');
    }

    if (resolution === 'SERVER_WINS') {
      // Accept server data, mark as synced
      await localDB.syncQueue.update(queueId, {
        status: 'SYNCED',
        updatedAt: new Date().toISOString(),
      });
      
      // Also update local entity with server data if available
      if (item.data?._conflict?.serverData) {
        if (item.entityType === 'User') {
          await localDB.users.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
          });
        } else if (item.entityType === 'Customer') {
          await localDB.customers.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'Product') {
          await localDB.inventory.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'Sale') {
          await localDB.sales.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'Supplier') {
          await localDB.suppliers.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'Purchase') {
          await localDB.purchases.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'Vehicle') {
          await localDB.vehicles.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'Employee') {
          await localDB.employees.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'Payment') {
          await localDB.payments.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'CarWashOrder') {
          await localDB.washOrders.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        } else if (item.entityType === 'MaintenanceOrder') {
          await localDB.maintenanceOrders.put({
            ...item.data._conflict.serverData,
            syncStatus: 'SYNCED',
            _dirty: false,
          });
        }
      }
    } else if (resolution === 'CLIENT_WINS') {
      // Re-queue as pending to force push
      await localDB.syncQueue.update(queueId, {
        status: 'PENDING',
        retryCount: 0,
        updatedAt: new Date().toISOString(),
      });
    } else if (resolution === 'MERGE' && mergedData) {
      await localDB.syncQueue.update(queueId, {
        data: mergedData,
        status: 'PENDING',
        retryCount: 0,
        updatedAt: new Date().toISOString(),
      });
    }

    // Also call server to resolve
    try {
      const deviceId = getDeviceId();
      // Find server sync log ID - we need to fetch status first
      // For foundation, we just handle locally
    } catch (e) {
      console.warn('Failed to resolve conflict on server, will retry on next sync', e);
    }
  }
}

export const syncEngine = new SyncEngine();
export default syncEngine;
