import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import UsersPage from './pages/Users';
import CustomersPage from './pages/Customers';
import InventoryPage from './pages/Inventory';
import SalesPage from './pages/Sales';
import SuppliersPage from './pages/Suppliers';
import VehiclesPage from './pages/Vehicles';
import EmployeesPage from './pages/Employees';
import InvoicesPage from './pages/Invoices';
import PaymentsPage from './pages/Payments';
import CarWashPage from './pages/CarWash';
import PurchasesPage from './pages/Purchases';
import SyncStatusPage from './pages/SyncStatus';
import NotImplemented from './pages/NotImplemented';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authChecked } = useAuthStore();

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-gray-200 border-t-[#16A34A] rounded-full animate-spin mx-auto mb-3" />
          <div className="text-sm text-gray-500">Loading ERP...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authChecked } = useAuthStore();

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="w-10 h-10 border-3 border-gray-200 border-t-[#16A34A] rounded-full animate-spin" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="sync-status" element={<SyncStatusPage />} />
          
          {/* Business modules - foundation only, show not implemented */}
          <Route path="customers" element={<CustomersPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="vehicles" element={<VehiclesPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="carwash" element={<CarWashPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="purchases" element={<PurchasesPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="expenses" element={<NotImplemented />} />
          <Route path="maintenance" element={<NotImplemented />} />
          <Route path="ev-rentals" element={<NotImplemented />} />
          <Route path="truck-rentals" element={<NotImplemented />} />
          <Route path="reports" element={<NotImplemented />} />
          <Route path="settings" element={<NotImplemented />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
