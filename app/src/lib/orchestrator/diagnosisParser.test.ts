import { describe, expect, it } from 'vitest';
import { parseFailureDiagnosis } from './diagnosisParser';

describe('parseFailureDiagnosis', () => {
  it('returns unknown when JSON is invalid', () => {
    const diagnosis = parseFailureDiagnosis('not-json');

    expect(diagnosis.category).toBe('unknown');
    expect(diagnosis.confidence).toBe(0);
    expect(diagnosis.evidence).toBe('');
  });

  it('returns unknown for unsupported categories', () => {
    const diagnosis = parseFailureDiagnosis(
      JSON.stringify({
        category: 'invented-cause',
        confidence: 1,
        evidence: 'some evidence',
      }),
    );

    expect(diagnosis.category).toBe('unknown');
  });

  it('requires evidence and sufficient confidence for missing-tool', () => {
    const noEvidence = parseFailureDiagnosis(
      JSON.stringify({
        category: 'missing-tool',
        confidence: 0.9,
        evidence: '',
      }),
    );
    const lowConfidence = parseFailureDiagnosis(
      JSON.stringify({
        category: 'missing-tool',
        confidence: 0.69,
        evidence: 'No module named openpyxl',
      }),
    );

    expect(noEvidence.category).toBe('unknown');
    expect(lowConfidence.category).toBe('unknown');
  });

  it('accepts an evidenced missing-tool diagnosis', () => {
    const diagnosis = parseFailureDiagnosis(
      '```json\n' +
        JSON.stringify({
          category: 'missing-tool',
          confidence: 0.9,
          evidence: 'ModuleNotFoundError: No module named openpyxl',
          summary: '缺少 Excel 读取库',
          capability: '读取 Excel',
          suggestedQuery: 'python openpyxl pypi',
          consequence: 'Excel 节点无法执行',
          nextStep: '生成并审阅 Excel 工具',
        }) +
        '\n```',
    );

    expect(diagnosis).toMatchObject({
      category: 'missing-tool',
      confidence: 0.9,
      evidence: 'ModuleNotFoundError: No module named openpyxl',
      capability: '读取 Excel',
    });
  });

  it('keeps a supported non-tool category without enabling tool generation', () => {
    const diagnosis = parseFailureDiagnosis(
      JSON.stringify({
        category: 'node-configuration',
        confidence: 0.8,
        evidence: '节点没有选择模型',
        summary: '节点配置不完整',
        nextStep: '为节点选择有效模型',
      }),
    );

    expect(diagnosis.category).toBe('node-configuration');
    expect(diagnosis.nextStep).toBe('为节点选择有效模型');
  });
});
