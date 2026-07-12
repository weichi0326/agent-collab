import { invoke, isTauri } from '@tauri-apps/api/core';

export const FRONTEND_VERSION = '3.1.0';
export const TAURI_VERSION = '2.11.3';

export type SystemDirectoryKind = 'data' | 'app_data' | 'output' | 'log';

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
