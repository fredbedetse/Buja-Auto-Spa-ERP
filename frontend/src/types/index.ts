// Core types for Buja Auto Spa ERP

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type RoleName = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'MECHANIC' | 'WASHER' | 'RENTAL_AGENT' | 'ACCOUNTANT' | 'VIEWER';
export type SyncStatus = 'SYNCED' | 'PENDING' | 'FAILED' | 'CONFLICT' | 'LOCAL';
export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE';

export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
  status: UserStatus;
  roles: string[] | Role[];
  permissions?: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  syncStatus?: SyncStatus;
}

export type CustomerType = 'INDIVIDUAL' | 'COMPANY';

export interface Customer {
  id: string;
  name: string;
  contactName?: string | null;
  phone: string;
  altPhone?: string | null;
  email?: string | null;
  customerType: CustomerType;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  creditLimit: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string | null;
  isDeleted?: boolean;
  syncStatus?: SyncStatus;
}

export type ProductCategory = 'ENGINE' | 'BRAKES' | 'ELECTRICAL' | 'FLUIDS' | 'TYRES' | 'BODY' | 'ACCESSORIES' | 'GENERAL';
export type ProductUnit = 'PCS' | 'LTR' | 'KG' | 'SET' | 'BOX';

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: ProductCategory;
  unit: ProductUnit;
  stockQuantity: number;
  reorderLevel: number;
  purchasePrice: number;
  sellingPrice: number;
  supplierName?: string | null;
  location?: string | null;
  description?: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string | null;
  isDeleted?: boolean;
  syncStatus?: SyncStatus;
}

export interface Role {
  id: string;
  name: RoleName;
  displayName: string;
  description?: string;
  permissions?: Permission[];
}

export interface Permission {
  key: string;
  module: string;
  action: string;
  description?: string;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface SyncQueueItem {
  id: string; // UUID
  entityType: string;
  entityId: string;
  operation: SyncOperation;
  data?: any;
  version?: number;
  clientVersion?: number;
  status: SyncStatus;
  retryCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
}

export interface SyncMetadata {
  deviceId: string;
  lastPullAt?: string;
  lastPushAt?: string;
  lastSyncAt?: string;
  pendingCount: number;
  failedCount: number;
}

export interface OnlineStatus {
  isOnline: boolean;
  isServerReachable: boolean;
  lastOnlineAt?: string;
  lastOfflineAt?: string;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  }
}

export interface DashboardStats {
  totalSales: number;
  totalCustomers: number;
  pendingSync: number;
  lowStock: number;
}
