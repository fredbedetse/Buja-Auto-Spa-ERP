// Offline-first local database using Dexie (IndexedDB)
// This is the primary offline storage, NOT localStorage
import Dexie, { type Table } from 'dexie';
import type { User, Customer, Product, SyncQueueItem, SyncMetadata } from '../types';

export interface LocalUser extends User {
  _localId?: string;
  _dirty?: boolean;
}

export interface LocalSyncQueueItem extends SyncQueueItem {}

export interface LocalCustomer extends Customer {
  _dirty?: boolean;
}

export interface LocalProduct extends Product {
  _dirty?: boolean;
}

export interface LocalSyncMetadata extends SyncMetadata {
  id?: string;
}

export interface LocalAuditLog {
  id: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  data?: string;
  timestamp: string;
  deviceId: string;
  synced: boolean;
}

class BujaLocalDB extends Dexie {
  users!: Table<LocalUser, string>;
  syncQueue!: Table<LocalSyncQueueItem, string>;
  syncMetadata!: Table<LocalSyncMetadata, string>;
  auditLogs!: Table<LocalAuditLog, string>;
  
  // Future tables for business modules (foundation only)
  customers!: Table<LocalCustomer, string>;
  vehicles!: Table<any, string>;
  inventory!: Table<LocalProduct, string>;

  constructor() {
    super('BujaAutoSpaERP_LocalDB');

    this.version(1).stores({
      users: 'id, email, username, status, updatedAt, syncStatus',
      syncQueue: 'id, entityType, entityId, status, createdAt, deviceId',
      syncMetadata: 'deviceId',
      auditLogs: 'id, action, entityType, entityId, timestamp, synced',
      customers: 'id, name, phone, updatedAt, syncStatus',
      vehicles: 'id, plateNumber, type, updatedAt, syncStatus',
      inventory: 'id, name, sku, updatedAt, syncStatus',
    });

    // Version 2 - add indexes for offline search
    this.version(2).stores({
      users: 'id, email, username, status, updatedAt, syncStatus, firstName, lastName',
      syncQueue: 'id, entityType, entityId, status, createdAt, deviceId, operation',
      syncMetadata: 'deviceId',
      auditLogs: 'id, action, entityType, entityId, timestamp, synced, userId',
      customers: 'id, name, phone, updatedAt, syncStatus, email',
      vehicles: 'id, plateNumber, type, updatedAt, syncStatus, customerId',
      inventory: 'id, name, sku, updatedAt, syncStatus, category',
    });
  }

  // Helper methods
  async getPendingSyncCount(): Promise<number> {
    return await this.syncQueue.where('status').equals('PENDING').count();
  }

  async getFailedSyncCount(): Promise<number> {
    return await this.syncQueue.where('status').equals('FAILED').count();
  }

  async getConflictCount(): Promise<number> {
    return await this.syncQueue.where('status').equals('CONFLICT').count();
  }

  async addToSyncQueue(item: Omit<LocalSyncQueueItem, 'id' | 'createdAt' | 'updatedAt' | 'retryCount' | 'status'> & Partial<Pick<LocalSyncQueueItem, 'status'>>): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    const queueItem: LocalSyncQueueItem = {
      id,
      entityType: item.entityType,
      entityId: item.entityId,
      operation: item.operation,
      data: item.data,
      version: item.version,
      clientVersion: item.clientVersion,
      status: item.status || 'PENDING',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
      deviceId: item.deviceId,
    };

    await this.syncQueue.add(queueItem);
    return id;
  }

  async clearSyncedItems(olderThanHours: number = 24): Promise<number> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - olderThanHours);
    const cutoffIso = cutoff.toISOString();

    return await this.syncQueue
      .where('status')
      .equals('SYNCED')
      .filter(item => item.updatedAt < cutoffIso)
      .delete();
  }
}

// Singleton instance
export const localDB = new BujaLocalDB();

// Initialize DB and log
localDB.open().then(() => {
  console.log('✅ Local IndexedDB initialized - offline storage ready');
}).catch(err => {
  console.error('❌ Failed to open local DB:', err);
});

// Utility to check if IndexedDB is available
export function isIndexedDBAvailable(): boolean {
  try {
    return !!window.indexedDB;
  } catch {
    return false;
  }
}

export default localDB;
