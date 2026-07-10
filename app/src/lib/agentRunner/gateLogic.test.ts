import { describe, it, expect } from 'vitest';
import { isNodeReady, gatePassed } from './gateLogic';

// 门控节点纯判定逻辑的单测。覆盖 OR/AND/NOR × failed/skipped 场景,
// 锁定「上游失败/跳过也能推进门控评估」这一修复(避免回归到兜底分支不跑)。

describe('isNodeReady', () => {
  it('agent 节点:所有上游 success 才 ready', () => {
    expect(isNodeReady(undefined, ['success', 'success'])).toBe(true);
    expect(isNodeReady(undefined, ['success', 'running'])).toBe(false);
    expect(isNodeReady(undefined, ['success', 'failed'])).toBe(false);
    expect(isNodeReady(undefined, ['success', 'skipped'])).toBe(false);
  });

  it('门控节点:所有上游 settled(含 failed/skipped)即 ready——修复关键', () => {
    // 上游失败/跳过时,门控仍要 ready 去自评估,而不是卡死或被动跳过。
    expect(isNodeReady('or', ['success', 'failed'])).toBe(true);
    expect(isNodeReady('and', ['success', 'failed'])).toBe(true);
    expect(isNodeReady('nor', ['failed', 'skipped'])).toBe(true);
    // 仍有运行中/排队上游时不 ready(等它定局)
    expect(isNodeReady('or', ['success', 'running'])).toBe(false);
    expect(isNodeReady('nor', ['failed', 'queued'])).toBe(false);
  });

  it('空上游:vacuously ready', () => {
    expect(isNodeReady('or', [])).toBe(true);
    expect(isNodeReady(undefined, [])).toBe(true);
  });
});

describe('gatePassed', () => {
  it('OR:任一 success 即通过', () => {
    expect(gatePassed('or', ['success', 'failed'])).toBe(true); // A 成功 B 失败→通过(核心场景)
    expect(gatePassed('or', ['failed', 'skipped'])).toBe(false); // 全不成功→不通过
    expect(gatePassed('or', ['success', 'success'])).toBe(true);
  });

  it('AND:全部 success 才通过', () => {
    expect(gatePassed('and', ['success', 'success'])).toBe(true);
    expect(gatePassed('and', ['success', 'failed'])).toBe(false); // 有一个失败→不通过(非 failed,是 skipped)
    expect(gatePassed('and', ['success', 'skipped'])).toBe(false);
  });

  it('NOR:全部非 success 才通过(兜底分支)', () => {
    expect(gatePassed('nor', ['failed', 'failed'])).toBe(true); // 全失败→兜底跑(核心场景)
    expect(gatePassed('nor', ['failed', 'skipped'])).toBe(true); // 全非成功→通过
    expect(gatePassed('nor', ['success', 'failed'])).toBe(false); // 有一个成功→不通过
    expect(gatePassed('nor', ['success', 'success'])).toBe(false);
  });

  it('skipped 算「非 success」,不算通过依据', () => {
    expect(gatePassed('or', ['skipped', 'skipped'])).toBe(false);
    expect(gatePassed('nor', ['skipped', 'skipped'])).toBe(true);
  });
});
