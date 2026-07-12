import { createRef, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Tooltip: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
      <span>
        <span className="tooltip-title">{title}</span>
        {children}
      </span>
    ),
  };
});

import { Composer } from './Composer';

describe('master agent composer settings guidance', () => {
  it('points unavailable web search to its settings-center page', () => {
    const html = renderToStaticMarkup(
      <Composer
        draft=""
        setDraft={() => undefined}
        attachments={[]}
        removeAttachment={() => undefined}
        addFiles={() => undefined}
        fileInputRef={createRef<HTMLInputElement>()}
        searchReady={false}
        webSearchOn={false}
        setWebSearchOn={() => undefined}
        modelsLength={0}
        valueValid={false}
        currentValue={undefined}
        onChangeModel={() => undefined}
        options={[]}
        activeSending={false}
        onOpenSkillManager={() => undefined}
        onRunHealthCheck={() => undefined}
        healthChecking={false}
        onStop={() => undefined}
        onSend={() => undefined}
      />,
    );

    expect(html).toContain(
      '请先在设置 &gt; 联网搜索中启用并填写密钥',
    );
    expect(html).not.toContain('标题栏「搜索配置」');
  });
});
