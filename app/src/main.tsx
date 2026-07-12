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
    colorPrimary: '#6f8980',
    colorInfo: '#7d919d',
    colorSuccess: '#6f8c78',
    colorWarning: '#a48864',
    colorError: '#a56f72',
    colorText: '#303734',
    colorTextSecondary: '#6f7874',
    colorBorder: 'rgba(86, 103, 96, 0.18)',
    colorBgBase: '#fbfcfb',
    colorBgLayout: '#f3f5f3',
    colorBgContainer: '#fbfcfb',
    borderRadius: 12,
    borderRadiusLG: 20,
    controlHeight: 36,
    fontFamily:
      '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Button: { fontWeight: 500, primaryShadow: 'none' },
    Modal: { borderRadiusLG: 24 },
    Segmented: { trackBg: '#e9eeeb' },
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
