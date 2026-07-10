import { useEffect } from 'react';
import { App } from 'antd';
import { setAppInstances } from '../lib/appNotify';

// 把 App.useApp() 的 message/notification 实例桥接到模块级引用，
// 供 store / 编排层等 React 之外的代码复用（见 lib/appNotify.ts）。不渲染任何内容。
export default function AppBridge() {
  const { message, notification } = App.useApp();
  useEffect(() => {
    setAppInstances(message, notification);
  }, [message, notification]);
  return null;
}
