import axios from 'axios';

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const apiOrigin = configuredApiUrl?.replace(/\/+$/, '') ?? '';
const BASE_URL = apiOrigin
  ? apiOrigin.endsWith('/api/v1')
    ? apiOrigin
    : `${apiOrigin}/api/v1`
  : '/api/v1';

/**
 * Pre-configured Axios instance for all API calls.
 * Automatically attaches JWT from localStorage.
 */
export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Request interceptor — attach auth token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401 globally
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
