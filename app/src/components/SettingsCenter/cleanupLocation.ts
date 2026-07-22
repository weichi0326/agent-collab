const CLEANUP_FILE_EXTENSIONS = new Set(['bak', 'json', 'log']);

export interface CleanupLocationOption {
  label: string;
  description: string;
  path: string;
}

export function cleanupLocationDirectory(path: string): string | null {
  const trimmed = path.trim().replace(/[\\/]+$/u, '');
  if (!trimmed) return null;
  const separatorIndex = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  const name = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed;
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : null;
  if (!extension || !CLEANUP_FILE_EXTENSIONS.has(extension)) return trimmed;
  return separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed;
}

export function cleanupLocationDirectories(path: string): string[] {
  const directories = path
    .split(/[,;；]\s*/u)
    .map(cleanupLocationDirectory)
    .filter((location): location is string => Boolean(location));
  return Array.from(new Set(directories));
}

function cleanupLocationLabel(categoryLabel: string, path: string): Pick<CleanupLocationOption, 'label' | 'description'> {
  const normalized = path.replace(/\\/gu, '/').toLowerCase();
  if (normalized.endsWith('/data')) {
    return {
      label: '项目数据目录',
      description: '保存工具配置、画布、姬子、模型和搜索等项目内 JSON 数据。',
    };
  }
  if (normalized.endsWith('/python-tools')) {
    return {
      label: '自定义工具目录',
      description: '保存已安装或生成的自定义工具及其 Python 依赖。',
    };
  }
  if (normalized.endsWith('/skills')) {
    return {
      label: '用户 Skill 目录',
      description: '保存用户创建、导入和覆盖的 Skill 文件。',
    };
  }
  if (normalized.includes('/appdata/local/') || normalized.includes('/app_data')) {
    return {
      label: '用户扩展数据目录',
      description: '保存桌面应用的插件、扩展和运行时用户数据。',
    };
  }
  if (normalized.endsWith('/outputs')) {
    return {
      label: '任务产物目录',
      description: '保存运行生成的报告、正文产物和附件文件。',
    };
  }
  if (normalized.endsWith('/logs')) {
    return {
      label: '运行日志目录',
      description: '保存应用运行日志和崩溃排查信息。',
    };
  }
  return {
    label: `${categoryLabel}位置`,
    description: '保存该清理分类涉及的数据文件或目录。',
  };
}

export function cleanupLocationOptions(
  categoryLabel: string,
  path: string,
): CleanupLocationOption[] {
  return cleanupLocationDirectories(path).map((location) => ({
    ...cleanupLocationLabel(categoryLabel, location),
    path: location,
  }));
}
