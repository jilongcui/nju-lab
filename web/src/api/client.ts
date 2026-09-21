import axios, { AxiosError } from 'axios';
import { message } from 'antd';
import type { ApiResponse } from '../types';
import { useAuthStore } from '../stores/auth';

const client = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) {
        return body.data as never;
      }
      message.error(body.message || '请求失败');
      return Promise.reject(new Error(body.message || '请求失败'));
    }
    return response.data as never;
  },
  (error: AxiosError<ApiResponse>) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      message.error('登录已过期，请重新登录');
    } else {
      const msg = error.response?.data?.message || error.message || '网络错误';
      message.error(msg);
    }
    return Promise.reject(error);
  },
);

export default client;
