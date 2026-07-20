export type JiziPlacement = 'top' | 'side';

// 引导激活时强制回退顶部抽屉:新手教程的靶点(jizi-entry/jizi-panel)与
// 无条件属性面板(properties-panel)都只存在于顶部模式,侧栏模式会让教程步骤失去靶点。
export function effectiveJiziPlacement(
  placement: JiziPlacement,
  onboardingActive: boolean,
): JiziPlacement {
  return onboardingActive ? 'top' : placement;
}

// 侧栏模式下属性面板"选中节点才渲染";顶部模式的属性面板由 App 无条件渲染,不走此判定。
export function shouldRenderSideProperties(hasSelectedNode: boolean): boolean {
  return hasSelectedNode;
}
