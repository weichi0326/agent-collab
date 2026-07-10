import { invoke, isTauri } from '@tauri-apps/api/core';

const FALLBACK_OUTPUT_DIR = 'outputs';

export interface OutputReport {
  id: string;
  canvas_name: string;
  node_id: string;
  node_label: string;
  output_format: string;
  run_at: string;
  summary: string;
  folder_path: string;
  artifact_name: string;
  artifact_path: string;
  data_path: string;
}

export async function getAppOutputDir(): Promise<string> {
  if (!isTauri()) return FALLBACK_OUTPUT_DIR;
  return invoke<string>('output_dir');
}

export async function openAppOutputDir(): Promise<void> {
  if (!isTauri()) return;
  await invoke('open_output_dir');
}

export async function localPathExists(path: string): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>('path_exists', { path });
}

export async function openLocalPath(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('open_path', { path });
}

export async function listOutputReports(nodeLabel?: string): Promise<OutputReport[]> {
  if (!isTauri()) return [];
  return invoke<OutputReport[]>('list_output_reports', {
    nodeLabel: nodeLabel?.trim() || undefined,
  });
}

export async function deleteOutputReport(paths: string[]): Promise<void> {
  if (!isTauri()) return;
  await invoke('delete_output_report', { paths });
}
