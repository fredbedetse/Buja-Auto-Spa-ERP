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

export type SaleStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'LOAN';

export interface SaleLine {
  id?: string;
  productId?: string | null;
  productName: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  invoiceNo: string;
  customerId: string;
  customerName: string;
  saleDate: string;
  status: SaleStatus;
  paymentMethod: PaymentMethod;
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paidAmount: number;
  balance: number;
  notes?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: SaleLine[];
  isDeleted?: boolean;
  deletedAt?: string | null;
  syncStatus?: SyncStatus;
}

export type SupplierType = string;

export interface Supplier {
  id: string;
  name: string;
  contactName?: string | null;
  phone: string;
  altPhone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  taxId?: string | null;
  notes?: string | null;
  leadTimeDays: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  syncStatus?: SyncStatus;
}

export type PurchaseStatus = 'DRAFT' | 'RECEIVED' | 'CANCELLED';
export type PurchasePayment = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'LOAN' | 'CREDIT_30';

export interface PurchaseLine {
  id?: string;
  productId?: string | null;
  productName: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  expectedDate?: string | null;
  status: PurchaseStatus;
  paymentMethod: PurchasePayment;
  invoiceRef?: string | null;
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paidAmount: number;
  balance: number;
  notes?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: PurchaseLine[];
  isDeleted?: boolean;
  deletedAt?: string | null;
  syncStatus?: SyncStatus;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  type: 'TRUCK' | 'BUS' | 'MINIBUS' | 'PICKUP' | 'CAR' | 'OTHER';
  make: string;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  color?: string | null;
  status: 'AVAILABLE' | 'IN_USE' | 'IN_MAINTENANCE' | 'RENTED' | 'RETIRED';
  odometerKm: number;
  driverName?: string | null;
  driverPhone?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null; // canonical BIF
  notes?: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
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
