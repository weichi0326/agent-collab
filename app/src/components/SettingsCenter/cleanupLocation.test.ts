import { describe, expect, it } from 'vitest';
import {
  cleanupLocationDirectories,
  cleanupLocationDirectory,
  cleanupLocationOptions,
} from './cleanupLocation';

describe('cleanup location helpers', () => {
  it('opens the parent directory for a file path and the directory itself for a directory path', () => {
    expect(cleanupLocationDirectory('C:/agent-collab/data/multi-agent-canvas.json')).toBe('C:/agent-collab/data');
    expect(cleanupLocationDirectory('C:/agent-collab/outputs')).toBe('C:/agent-collab/outputs');
  });

  it('deduplicates files in the same directory into one location', () => {
    expect(cleanupLocationDirectories(
      'C:/agent-collab/data/multi-agent-canvas.json；C:/agent-collab/data/multi-agent-agents.json',
    )).toEqual(['C:/agent-collab/data']);
  });

  it('keeps separate locations when a cleanup category spans multiple directories', () => {
    expect(cleanupLocationDirectories(
      'C:/agent-collab/data/multi-agent-tools.json；C:/Users/Admin/AppData/Local/com.agent-collab',
    )).toEqual([
      'C:/agent-collab/data',
      'C:/Users/Admin/AppData/Local/com.agent-collab',
    ]);
  });

  it('labels each selectable location with what it contains', () => {
    expect(cleanupLocationOptions(
      '自定义工具',
      'C:/agent-collab/data/multi-agent-tools.json；C:/Users/Admin/AppData/Local/com.agent-collab/python-tools',
    )).toEqual([
      {
        label: '项目数据目录',
        description: '保存工具配置、画布、姬子、模型和搜索等项目内 JSON 数据。',
        path: 'C:/agent-collab/data',
      },
      {
        label: '自定义工具目录',
        description: '保存已安装或生成的自定义工具及其 Python 依赖。',
        path: 'C:/Users/Admin/AppData/Local/com.agent-collab/python-tools',
      },
    ]);
  });

  it('labels the user Skill directory separately from tools', () => {
    expect(cleanupLocationOptions(
      '用户 Skill',
      'C:/Users/Admin/AppData/Local/com.agent-collab/skills',
    )).toEqual([{
      label: '用户 Skill 目录',
      description: '保存用户创建、导入和覆盖的 Skill 文件。',
      path: 'C:/Users/Admin/AppData/Local/com.agent-collab/skills',
    }]);
  });
});
