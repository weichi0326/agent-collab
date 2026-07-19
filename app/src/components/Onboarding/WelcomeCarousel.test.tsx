import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WelcomeCarousel from './WelcomeCarousel';

describe('WelcomeCarousel', () => {
  it('renders the three approved animated welcome topics without a skip action', () => {
    const pages = [0, 1, 2].map((page) =>
      renderToStaticMarkup(
        <WelcomeCarousel
          page={page}
          onPrevious={() => undefined}
          onNext={() => undefined}
        />,
      ),
    );

    expect(pages[0]).toContain('把复杂任务变成可运行的协作流程');
    expect(pages[1]).toContain('让姬子协助规划、配置与诊断');
    expect(pages[2]).toContain('连接模型，让工作台真正运行起来');
    expect(pages.join('')).toContain('onboarding-welcome__motion');
    expect(pages[0]).toContain('onboarding-workflow-flow');
    expect(pages[0]).toContain('onboarding-workflow-stage--brief');
    expect(pages[0]).toContain('onboarding-workflow-stage--collaborate');
    expect(pages[0]).toContain('onboarding-workflow-stage--deliver');
    expect(pages[0]).not.toContain('onboarding-motion-node');
    expect(pages[1]).toContain('onboarding-jizi-request');
    expect(pages[1]).toContain('onboarding-jizi-core');
    expect(pages[1]).toContain('onboarding-jizi-result--plan');
    expect(pages[1]).toContain('onboarding-jizi-result--configure');
    expect(pages[1]).toContain('onboarding-jizi-result--diagnose');
    expect(pages[1]).not.toContain('onboarding-motion-thinking');
    expect(pages.join('')).not.toContain('跳过引导');
    expect(pages[2]).toContain('开始配置');
  });
});
