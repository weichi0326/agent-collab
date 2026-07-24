import { describe, expect, it } from 'vitest';
import {
  buildFictionProjectText,
  parseCanonTransfer,
  parseTimelineTransfer,
} from './dataTransfer';

describe('fictionist collection transfer', () => {
  it('parses portable canon and timeline envelopes', () => {
    const canon = parseCanonTransfer(JSON.stringify({
      kind: 'fictionist-canon',
      schema: 1,
      entries: [{ type: 'character', name: '林砚', summary: '', content: '记者' }],
    }));
    const timeline = parseTimelineTransfer(JSON.stringify({
      kind: 'fictionist-timeline',
      schema: 1,
      entries: [{
        timeLabel: '第一日', title: '抵达港口', description: '', kind: 'chapter',
        sourceChapterTitle: '七号泊位', order: 0,
      }],
    }));

    expect(canon).toEqual([{ type: 'character', name: '林砚', summary: '', content: '记者' }]);
    expect(timeline[0]).toMatchObject({ title: '抵达港口', sourceChapterTitle: '七号泊位' });
  });

  it('rejects mismatched and unsupported collection files', () => {
    expect(() => parseCanonTransfer(JSON.stringify({
      kind: 'fictionist-timeline', schema: 1, entries: [],
    }))).toThrow('文件类型');
    expect(() => parseTimelineTransfer(JSON.stringify({
      kind: 'fictionist-timeline', schema: 2, entries: [],
    }))).toThrow('文件版本');
  });

  it('builds a plain-text novel in volume and chapter order', () => {
    expect(buildFictionProjectText('雾港来信', [{
      title: '第一卷',
      chapters: [
        { title: '第一章 抵达', content: '潮水正在上涨。\n' },
        { title: '第二章 来信', content: '信封没有署名。' },
      ],
    }])).toBe([
      '《雾港来信》',
      '第一卷',
      '第一章 抵达',
      '潮水正在上涨。',
      '第二章 来信',
      '信封没有署名。',
      '',
    ].join('\n\n').replace(/\n\n$/u, '\n'));
  });
});
