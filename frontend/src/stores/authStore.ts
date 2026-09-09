import { create } from 'zustand';
import type { User, AuthState } from '../types';
import apiClient from '../lib/api';
import localDB from '../lib/db';

interface AuthStore extends AuthState {
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setUser: (user: User) => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem('buja_access_token'),
  refreshToken: localStorage.getItem('buja_refresh_token'),
  isAuthenticated: !!localStorage.getItem('buja_access_token'),
  isLoading: true,

  login: async (identifier: string, password: string) => {
    set({ isLoading: true });
    try {
      const data = await apiClient.login(identifier, password);
      
      // Save to local DB for offline access
      await localDB.users.put({
        ...data.user,
        syncStatus: 'SYNCED',
        _dirty: false,
      });

      set({
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false, isAuthenticated: false, user: null });
      throw error;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await apiClient.logout();
    } catch (e) {
      console.warn('Logout error', e);
    } finally {
      // Clear local data but keep device ID and sync queue?
      // For security, clear user but keep sync queue for later sync
      localStorage.removeItem('buja_user');
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
      window.location.href = '/login';
    }
  },

  checkAuth: async () => {
    const token = localStorage.getItem('buja_access_token');
    const cachedUser = localStorage.getItem('buja_user');

    if (!token) {
      // Try to load from local DB for offline mode
      if (cachedUser) {
        try {
          const user = JSON.parse(cachedUser);
          set({ user, isAuthenticated: true, isLoading: false });
          return;
        } catch {}
      }
      set({ isLoading: false, isAuthenticated: false, user: null });
      return;
    }

    try {
      // Try online profile fetch
      const user = await apiClient.getProfile() as User;
      localStorage.setItem('buja_user', JSON.stringify(user));
      
      // Update local DB
      await localDB.users.put({
        ...user,
        syncStatus: 'SYNCED',
      });

      set({
        user,
        accessToken: token,
        refreshToken: localStorage.getItem('buja_refresh_token'),
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error: any) {
      console.warn('Auth check failed, trying offline cache:', error.message);
      
      // If offline, use cached user
      if (cachedUser && (error.message.includes('OFFLINE') || error.message.includes('Network'))) {
        try {
          const user = JSON.parse(cachedUser);
          // Also try local DB
          const localUser = await localDB.users.get(user.id);
          set({
            user: localUser || user,
            isAuthenticated: true,
            isLoading: false,
          });
          return;
        } catch {}
      }

      // If token expired and refresh failed, clear auth
      if (error.message.includes('Session expired') || error.message.includes('Invalid')) {
        localStorage.removeItem('buja_access_token');
        localStorage.removeItem('buja_refresh_token');
        localStorage.removeItem('buja_user');
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, isLoading: false });
        return;
      }

      // For other errors, keep existing auth if we have cached user (offline mode)
      if (cachedUser) {
        try {
          const user = JSON.parse(cachedUser);
          set({ user, isAuthenticated: true, isLoading: false });
          return;
        } catch {}
      }

      set({ isLoading: false, isAuthenticated: false, user: null });
    }
  },

  setUser: (user: User) => {
    localStorage.setItem('buja_user', JSON.stringify(user));
    set({ user });
  },

  hasPermission: (permission: string) => {
    const { user } = get();
    if (!user) return false;
    if (user.roles?.includes('SUPER_ADMIN' as any)) return true;
    return user.permissions?.includes(permission) || false;
  },

  hasRole: (role: string) => {
    const { user } = get();
    if (!user) return false;
    const roles = user.roles as any[];
    if (typeof roles[0] === 'string') {
      return roles.includes(role);
    }
    return roles.some((r: any) => r.name === role || r === role);
  },

  hasAnyPermission: (permissions: string[]) => {
    const { user } = get();
    if (!user) return false;
    if (user.roles?.includes('SUPER_ADMIN' as any)) return true;
    return permissions.some(p => user.permissions?.includes(p));
  },

  hasAllPermissions: (permissions: string[]) => {
    const { user } = get();
    if (!user) return false;
    if (user.roles?.includes('SUPER_ADMIN' as any)) return true;
    return permissions.every(p => user.permissions?.includes(p));
  },
}));
