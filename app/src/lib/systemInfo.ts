import { invoke, isTauri } from '@tauri-apps/api/core';

export const FRONTEND_VERSION = '3.1.0';
export const TAURI_VERSION = '2.11.3';

export type SystemDirectoryKind = 'data' | 'app_data' | 'output' | 'log';

export type CleanableItemId =
  | 'outputs'
  | 'logs'
  | 'runtime'
  | 'ui'
  | 'canvas_agents'
  | 'jizi'
  | 'tools_app_data'
  | 'user_skills'
  | 'model_search';

export interface DirectoryUsage {
  bytes: number;
  complete: boolean;
  detail: string | null;
}

export interface SystemCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  repair: string;
}

export interface SystemSnapshot {
  app_version: string;
  backend_version: string;
  os: string;
  arch: string;
  data_dir: string;
  app_data_dir: string;
  output_dir: string;
  log_dir: string;
  data_usage: DirectoryUsage;
  app_data_usage: DirectoryUsage;
  output_usage: DirectoryUsage;
  log_usage: DirectoryUsage;
  checks: SystemCheck[];
}

export interface CleanableItem {
  id: CleanableItemId;
  label: string;
  description: string;
  impact: string;
  path: string;
  usage: DirectoryUsage;
  important: boolean;
  defaultSelected: boolean;
  exists: boolean;
}

export interface CleanableScan {
  items: CleanableItem[];
}

export interface ClearSelectedAppDataResult {
  cleared: CleanableItemId[];
}

export function isDesktopSystemInfoAvailable(): boolean {
  return isTauri();
}

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  if (!isTauri()) {
    throw new Error('系统快照仅在桌面应用中可用');
  }
  return invoke<SystemSnapshot>('system_snapshot');
}

export async function openSystemDirectory(kind: SystemDirectoryKind): Promise<void> {
  if (!isTauri()) {
    throw new Error('目录入口仅在桌面应用中可用');
  }
  await invoke('open_system_directory', { kind });
}
export async function scanCleanableAppData(): Promise<CleanableScan> {
  if (!isTauri()) {
    throw new Error('数据清理仅在桌面应用中可用');
  }
  return invoke<CleanableScan>('scan_cleanable_app_data');
}

export async function clearSelectedAppData(
  itemIds: CleanableItemId[],
): Promise<ClearSelectedAppDataResult> {
  if (!isTauri()) {
    throw new Error('数据清理仅在桌面应用中可用');
  }
  return invoke<ClearSelectedAppDataResult>('clear_selected_app_data', {
    input: { itemIds },
  });
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  const rounded = value >= 10 || Number.isInteger(value)
    ? Math.round(value)
    : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export function formatDirectoryUsage(usage: DirectoryUsage): string {
  const size = formatByteSize(usage.bytes);
  return usage.complete ? size : `至少 ${size}`;
}

export function readableSystemError(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === 'string' && reason.trim()) return reason;
  return fallback;
}
