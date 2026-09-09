// API client with offline support and token refresh
import { getDeviceId } from './device';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  skipRefresh?: boolean;
}

class ApiClient {
  private baseUrl: string;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getAccessToken(): string | null {
    return localStorage.getItem('buja_access_token');
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem('buja_refresh_token');
  }

  private setTokens(access: string, refresh: string) {
    localStorage.setItem('buja_access_token', access);
    localStorage.setItem('buja_refresh_token', refresh);
  }

  private clearTokens() {
    localStorage.removeItem('buja_access_token');
    localStorage.removeItem('buja_refresh_token');
    localStorage.removeItem('buja_user');
  }

  async refreshAccessToken(): Promise<string | null> {
    // Prevent multiple simultaneous refresh calls
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return null;

    this.refreshPromise = (async () => {
      try {
        const deviceId = getDeviceId();
        const response = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken, deviceId }),
        });

        if (!response.ok) {
          this.clearTokens();
          return null;
        }

        const data = await response.json();
        this.setTokens(data.accessToken, data.refreshToken);
        return data.accessToken;
      } catch (error) {
        console.error('Token refresh failed:', error);
        this.clearTokens();
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { skipAuth, skipRefresh, ...fetchOptions } = options;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(fetchOptions.headers as Record<string, string> || {}),
    };

    if (!skipAuth) {
      const token = this.getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      headers['X-Device-Id'] = getDeviceId();
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
      });

      // Handle token expiration
      if (response.status === 401 && !skipAuth && !skipRefresh) {
        const errorData = await response.json().catch(() => ({}));
        
        if (errorData.code === 'TOKEN_EXPIRED') {
          const newToken = await this.refreshAccessToken();
          if (newToken) {
            // Retry with new token
            headers['Authorization'] = `Bearer ${newToken}`;
            const retryResponse = await fetch(url, {
              ...fetchOptions,
              headers,
            });
            
            if (!retryResponse.ok) {
              const retryError = await retryResponse.json().catch(() => ({ error: 'Request failed' }));
              throw new Error(retryError.error || `HTTP ${retryResponse.status}`);
            }
            
            return retryResponse.json();
          } else {
            // Refresh failed, redirect to login
            window.location.href = '/login';
            throw new Error('Session expired');
          }
        } else if (errorData.error) {
          // Other auth errors
          if (response.status === 401) {
            this.clearTokens();
            window.location.href = '/login';
          }
          throw new Error(errorData.error);
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || errorData.message || `Request failed: ${response.status}`);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      return response.json();
    } catch (error: any) {
      // Network error - offline
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('OFFLINE: Network unavailable - operation queued for sync');
      }
      throw error;
    }
  }

  // Convenience methods
  get<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, data?: any, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  put<T>(endpoint: string, data?: any, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  delete<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  // Auth methods
  async login(identifier: string, password: string) {
    const { deviceId, deviceInfo } = await import('./device').then(m => m.getDeviceIdAndInfo());
    
    const data = await this.post<{
      user: any;
      accessToken: string;
      refreshToken: string;
      sessionId: string;
    }>('/auth/login', {
      identifier,
      password,
      deviceId,
      deviceInfo,
    }, { skipAuth: true });

    this.setTokens(data.accessToken, data.refreshToken);
    localStorage.setItem('buja_user', JSON.stringify(data.user));
    
    return data;
  }

  async logout() {
    try {
      await this.post('/auth/logout');
    } catch (e) {
      console.warn('Logout API failed, clearing locally anyway', e);
    } finally {
      this.clearTokens();
    }
  }

  async getProfile() {
    return this.get('/auth/me');
  }

  // Health
  async healthCheck() {
    return this.get('/health', { skipAuth: true });
  }

  async syncHealth() {
    return this.get('/health/sync-check');
  }
}

export const apiClient = new ApiClient(API_BASE);
export default apiClient;
