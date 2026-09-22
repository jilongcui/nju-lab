import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 项目未装 @types/node；这里只需要 env 一个字段
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // 子目录部署（如 medai.nju.edu.cn/lab/）：VITE_BASE=/lab/ npm run build；默认根部署
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
        },
      },
    },
  },
});
