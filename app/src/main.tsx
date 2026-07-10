import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import './index.css';
import App from './App.tsx';
import AppBridge from './components/AppBridge';
import ErrorBoundary from './components/ErrorBoundary';

const theme = {
  token: {
    colorPrimary: '#1890ff',
    borderRadius: 8,
    fontFamily:
      '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    colorBgLayout: '#f5f6f8',
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntApp>
        <AppBridge />
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
