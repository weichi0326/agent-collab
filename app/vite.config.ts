import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rustTarget = /[/\\]src-tauri[/\\]target[/\\]/;

// https://vite.dev/config/
// Tauri 期望固定端口与不清屏,便于 tauri dev 稳定接管
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [rustTarget, '**/src-tauri/target/**', '**/src-tauri/target/**/**'],
    },
  },
  // 显式预打包重量级依赖:开发模式下 Vite 若在首次加载途中「发现」新依赖会触发
  // 重新预打包 + 整页重载,表现为启动白屏一段时间。列出全部一级依赖使预打包确定化,
  // 避免加载途中的二次优化与重载(仅影响 dev 体验,正式打包不受此配置影响)。
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'zustand',
      'zustand/middleware',
      'antd',
      'antd/locale/zh_CN',
      '@ant-design/icons',
      '@xyflow/react',
      '@tauri-apps/api',
      '@tauri-apps/api/core',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-http',
    ],
  },
});
