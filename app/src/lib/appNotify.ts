import type { App } from 'antd';

// antd 的 message/notification 静态 API 不吃 ConfigProvider 的主题与 locale，
// 且只能在 React 组件里通过 App.useApp() 拿到「吃主题」的实例。这里用一个模块级
// 引用桥接：<AppBridge/> 在挂载后把 hook 实例存进来，store / 编排层等 React 之外的
// 代码即可通过 getMessage()/getNotification() 复用同一套实例（不可用时返回 null）。

type AppApi = ReturnType<typeof App.useApp>;

let messageRef: AppApi['message'] | null = null;
let notificationRef: AppApi['notification'] | null = null;

export function setAppInstances(
  message: AppApi['message'],
  notification: AppApi['notification'],
): void {
  messageRef = message;
  notificationRef = notification;
}

export function getMessage(): AppApi['message'] | null {
  return messageRef;
}

export function getNotification(): AppApi['notification'] | null {
  return notificationRef;
}
