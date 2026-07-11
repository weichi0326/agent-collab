import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat } from './llmClient';
import { loadJiziSkillById } from './jiziSkills';
import {
  analyzeImportedSkill,
  rewriteExistingSkill,
  splitSkillAnalysisDocument,
} from './jiziSkillImport';

vi.mock('./llmClient', () => ({ chat: vi.fn() }));
vi.mock('./jiziSkills', () => ({ loadJiziSkillById: vi.fn() }));

const mockedChat = vi.mocked(chat);
const mockedLoadJiziSkillById = vi.mocked(loadJiziSkillById);
const cfg = { provider: 'openai', apiKey: 'test', baseUrl: '', model: 'test' } as never;
const candidateReply = JSON.stringify({
  candidates: [
    {
      displayTitle: '测试 Skill',
      displayDescription: '处理测试任务。',
      category: 'workflow',
      capabilities: ['执行测试'],
      instructions: '先检查输入，再输出结果。',
    },
  ],
});

describe('skill-creator integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadJiziSkillById.mockResolvedValue({
      id: 'skill-creator',
      title: '定制 Skill 创建器',
      description: '定制触发说明',
      category: 'skill',
      capabilities: ['定制能力'],
      instructions: '磁盘覆盖规范：必须保留领域边界。',
      path: 'skills/skill-creator/SKILL.md',
    });
    mockedChat.mockResolvedValue(candidateReply);
  });

  it('loads the effective skill-creator for import and split audit prompts', async () => {
    await analyzeImportedSkill({
      fileContent: `${'# 长文档\n\n'}${'内容'.repeat(4_100)}`,
      fileName: 'long.md',
      existingSkills: [],
      cfg,
      model: 'test',
    });

    expect(mockedLoadJiziSkillById).toHaveBeenCalledWith('skill-creator');
    expect(mockedChat).toHaveBeenCalledTimes(2);
    for (const call of mockedChat.mock.calls) {
      expect(call[0].text).toContain('磁盘覆盖规范：必须保留领域边界。');
    }
  });

  it('uses the same skill-creator source when rewriting an existing skill', async () => {
    await rewriteExistingSkill({
      skill: {
        id: 'legacy',
        title: '旧 Skill',
        description: '旧描述',
        capabilities: ['旧能力'],
        instructions: '旧正文',
      },
      cfg,
      model: 'test',
    });

    expect(mockedChat.mock.calls[0]?.[0].text).toContain(
      '磁盘覆盖规范：必须保留领域边界。',
    );
  });

  it('falls back to embedded guidance when skill-creator cannot be loaded', async () => {
    mockedLoadJiziSkillById.mockRejectedValue(new Error('load failed'));

    await analyzeImportedSkill({
      fileContent: '简单正文',
      fileName: 'simple.md',
      existingSkills: [],
      cfg,
      model: 'test',
    });

    expect(mockedChat.mock.calls[0]?.[0].text).toContain('名称简短、具体、可识别');
  });

  it('reports a readable error when the model returns truncated JSON', async () => {
    mockedChat.mockResolvedValueOnce('{"candidates":[');

    await expect(analyzeImportedSkill({
      fileContent: '简单正文',
      fileName: 'broken.md',
      existingSkills: [],
      cfg,
      model: 'test',
    })).rejects.toThrow('结果不完整或格式错误');
  });
});

describe('splitSkillAnalysisDocument', () => {
  it('splits long documents at second-level heading boundaries', () => {
    const content = [
      '# QA 规范',
      ...Array.from({ length: 6 }, (_, index) =>
        `## 章节 ${index + 1}\n${String(index + 1).repeat(1_800)}`,
      ),
    ].join('\n\n');

    const chunks = splitSkillAnalysisDocument(content, 4_000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 4_000)).toBe(true);
    expect(chunks.join('\n')).toContain('## 章节 6');
  });
});
