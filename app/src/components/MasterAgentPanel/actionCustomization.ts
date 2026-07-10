import type { MasterAction } from '../../lib/masterActions';

export function actionCustomLabel(action: MasterAction): string {
  switch (action.type) {
    case 'create-canvas':
      return '画布名称';
    case 'rename-active-canvas':
      return '新的画布名称';
    case 'create-agent':
      return 'Agent 名称';
    default:
      return '';
  }
}

export function actionAllowsCustom(action: MasterAction): boolean {
  return (
    action.type === 'create-canvas' ||
    action.type === 'rename-active-canvas' ||
    action.type === 'create-agent'
  );
}

export function actionDefaultCustomValue(action: MasterAction): string {
  if ('name' in action && typeof action.name === 'string') return action.name;
  return '';
}

export function actionWithCustomValue(
  action: MasterAction,
  value: string,
): MasterAction {
  const name = value.trim();
  if (!name) return action;
  switch (action.type) {
    case 'create-canvas':
      return { ...action, name };
    case 'rename-active-canvas':
      return { ...action, name };
    case 'create-agent':
      return { ...action, name };
    default:
      return action;
  }
}
