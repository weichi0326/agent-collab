# 姬子侧边栏布局模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给姬子新增"右侧常驻竖栏"布局模式，与现有"顶部抽屉"模式并存，用户在设置中心切换，默认仍为顶部抽屉。

**Architecture:** uiStore 新增持久化的 `jiziPlacement`/`jiziWidth`/`jiziSideCollapsed`；纯函数 `jiziLayout.ts` 决定"生效布局"（引导激活时强制 top）与"侧栏模式下属性面板是否渲染"；App.tsx 按生效布局二选一渲染（顶部抽屉 或 侧栏 `JiziSideDock` + 按需属性面板）；`JiziSideDock` 复用 `MasterAgentPanel`，会话列表收成顶部下拉，支持折叠成窄条；ResizeHandle 扩展支持 `jizi` 侧拖拽宽度；设置开关放 `JiziSettingsPanel`。

**Tech Stack:** React 19 + TypeScript + Zustand(persist) + Ant Design v6 + Vite；测试 vitest；校验 `npx tsc --noEmit` / `npm run lint`(oxlint) / `npx vitest run`。

> **执行须知（重要）**
> - 所有命令先 `cd /c/Users/Admin/Desktop/agent-collab/app &&`（bash cwd 每条命令会重置；git 仓库根在 `C:\Users\Admin\Desktop\agent-collab`，代码在其 `app/` 子目录）。
> - **提交需用户明确同意**：本项目规则要求只有用户明确说"提交/commit"时才 `git commit`。每个 Task 末尾的 commit 步骤请在用户授权后执行；若未授权，完成实现与校验后停下等待。
> - 敏感文件 `data/multi-agent-models.json`、`data/multi-agent-search.json` 及 `data/`、`outputs/`、`logs/`、`node_modules`、`dist`、`src-tauri/target` 一律不提交；提交时按文件名精确 `git add`，不要 `git add -A`。
> - zustand selector 不得现算返回新数组/对象（白屏风险）；派生值用 `useMemo`。

---

## 文件结构

**新增**
- `app/src/components/jiziLayout.ts` — 纯函数：`effectiveJiziPlacement()`、`shouldRenderSideProperties()`。无 React 依赖，便于单测。
- `app/src/components/jiziLayout.test.ts` — 上述纯函数的单测。
- `app/src/components/MasterAgentPanel/JiziSideDock.tsx` — 侧栏外壳组件（会话下拉 + 折叠按钮 + 复用 `MasterAgentPanel` + `ResizeHandle side="jizi"`）。

**修改**
- `app/src/stores/uiStore.ts` — 加 `jiziPlacement`/`jiziWidth`/`jiziSideCollapsed` + setters + `JIZI_MIN`/`JIZI_MAX` clamp + partialize + persist `version:2` + `migrate`。
- `app/src/stores/uiStore.test.ts` — 补新字段的默认值 / clamp / 持久化 / migrate 测试。
- `app/src/components/ResizeHandle.tsx` — `side` 增加 `'jizi'`，绑 `jiziWidth`/`setJiziWidth`。
- `app/src/App.tsx` — 按生效布局二选一：顶部渲染 `MasterAgentDrawer`；侧栏渲染 `JiziSideDock` + 按需 `PropertiesPanel`。
- `app/src/components/MasterConfigModal.tsx`（`JiziSettingsPanel`）— 加「面板位置」Segmented 绑 `jiziPlacement`。
- `app/src/settings/settingsCatalog.ts` — `jizi` 项 keywords 补「布局」「侧边栏」「位置」。
- `app/src/App.css` — `.jizi-side-dock` 系列样式 + `.resize-handle--jizi` + 折叠窄条。

---

## Task 1: uiStore 新增侧栏状态字段（默认值 + clamp + 持久化 + migrate）

**Files:**
- Modify: `app/src/stores/uiStore.ts`
- Test: `app/src/stores/uiStore.test.ts`

- [ ] **Step 1: 写失败测试**

在 `app/src/stores/uiStore.test.ts` 顶部 import 追加 `JIZI_MIN`、`JIZI_MAX`：

```ts
import { JIZI_MIN, JIZI_MAX, partializeUiState, useUiStore } from './uiStore';
```

在文件末尾（最后一个 `});` 之后）追加一个新 describe：

```ts
describe('uiStore jizi placement', () => {
  beforeEach(() => {
    storage.clear();
    useUiStore.setState({
      jiziPlacement: 'top',
      jiziWidth: 360,
      jiziSideCollapsed: false,
    });
  });

  it('defaults to top placement, 360 width, not collapsed', () => {
    expect(useUiStore.getState().jiziPlacement).toBe('top');
    expect(useUiStore.getState().jiziWidth).toBe(360);
    expect(useUiStore.getState().jiziSideCollapsed).toBe(false);
  });

  it('switches placement and toggles collapse', () => {
    useUiStore.getState().setJiziPlacement('side');
    useUiStore.getState().setJiziSideCollapsed(true);
    expect(useUiStore.getState().jiziPlacement).toBe('side');
    expect(useUiStore.getState().jiziSideCollapsed).toBe(true);
  });

  it('clamps jizi width to [JIZI_MIN, JIZI_MAX]', () => {
    useUiStore.getState().setJiziWidth(10);
    expect(useUiStore.getState().jiziWidth).toBe(JIZI_MIN);
    useUiStore.getState().setJiziWidth(99999);
    expect(useUiStore.getState().jiziWidth).toBe(JIZI_MAX);
  });

  it('persists placement, width and collapse preference', () => {
    const persisted = partializeUiState({
      ...useUiStore.getState(),
      jiziPlacement: 'side',
      jiziWidth: 400,
      jiziSideCollapsed: true,
    });
    expect(persisted.jiziPlacement).toBe('side');
    expect(persisted.jiziWidth).toBe(400);
    expect(persisted.jiziSideCollapsed).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx vitest run src/stores/uiStore.test.ts`
Expected: FAIL —— `JIZI_MIN`/`JIZI_MAX` 未导出、`setJiziPlacement` 等不是函数。

- [ ] **Step 3: 实现 uiStore 改动**

在 `app/src/stores/uiStore.ts`：

(a) `UiState` 接口内（`settingsDirty: boolean;` 之后）加字段与 setters：

```ts
  jiziPlacement: 'top' | 'side';
  jiziWidth: number;
  jiziSideCollapsed: boolean;
```
```ts
  setJiziPlacement: (p: 'top' | 'side') => void;
  setJiziWidth: (w: number) => void;
  setJiziSideCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
```

(b) clamp 常量区（`RIGHT_MAX = 560;` 之后）加：

```ts
export const JIZI_MIN = 300;
export const JIZI_MAX = 560;
```

(c) `partializeUiState` 返回对象追加三项：

```ts
export function partializeUiState(state: UiState) {
  return {
    leftWidth: state.leftWidth,
    rightWidth: state.rightWidth,
    masterModel: state.masterModel,
    drawerFullscreen: state.drawerFullscreen,
    jiziPlacement: state.jiziPlacement,
    jiziWidth: state.jiziWidth,
    jiziSideCollapsed: state.jiziSideCollapsed,
  };
}
```

(d) create 初始值区（`settingsDirty: false,` 之后）加：

```ts
      jiziPlacement: 'top',
      jiziWidth: 360,
      jiziSideCollapsed: false,
```

(e) setters（`setSettingsDirty` 之后）加：

```ts
      setJiziPlacement: (jiziPlacement) => set({ jiziPlacement }),
      setJiziWidth: (w) => set({ jiziWidth: clamp(w, JIZI_MIN, JIZI_MAX) }),
      setJiziSideCollapsed: (v) =>
        set((s) => ({
          jiziSideCollapsed:
            typeof v === 'function' ? v(s.jiziSideCollapsed) : v,
        })),
```

(f) persist 配置：`version: 1` 改为 `version: 2`，并在 `partialize: partializeUiState,` 之后加 migrate：

```ts
      version: 2,
      partialize: partializeUiState,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<UiState>;
        if (version < 2) {
          return {
            ...state,
            jiziPlacement: state.jiziPlacement ?? 'top',
            jiziWidth: state.jiziWidth ?? 360,
            jiziSideCollapsed: state.jiziSideCollapsed ?? false,
          };
        }
        return state;
      },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx vitest run src/stores/uiStore.test.ts`
Expected: PASS（含既有 drawer display mode 测试不回归）。

- [ ] **Step 5: 提交（需用户授权）**

```bash
cd /c/Users/Admin/Desktop/agent-collab && git add app/src/stores/uiStore.ts app/src/stores/uiStore.test.ts && git commit -m "feat(ui): add jizi placement/width/collapse state with persist migration"
```

---

## Task 2: 纯函数 jiziLayout —— 生效布局 & 侧栏属性渲染判定

**Files:**
- Create: `app/src/components/jiziLayout.ts`
- Test: `app/src/components/jiziLayout.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `app/src/components/jiziLayout.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  effectiveJiziPlacement,
  shouldRenderSideProperties,
} from './jiziLayout';

describe('effectiveJiziPlacement', () => {
  it('returns the stored placement when onboarding is not active', () => {
    expect(effectiveJiziPlacement('side', false)).toBe('side');
    expect(effectiveJiziPlacement('top', false)).toBe('top');
  });

  it('forces top while onboarding is active (protects tutorial targets)', () => {
    expect(effectiveJiziPlacement('side', true)).toBe('top');
    expect(effectiveJiziPlacement('top', true)).toBe('top');
  });
});

describe('shouldRenderSideProperties', () => {
  it('renders properties in side mode only when a node is selected', () => {
    expect(shouldRenderSideProperties(true)).toBe(true);
    expect(shouldRenderSideProperties(false)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx vitest run src/components/jiziLayout.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现纯函数**

创建 `app/src/components/jiziLayout.ts`：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx vitest run src/components/jiziLayout.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交（需用户授权）**

```bash
cd /c/Users/Admin/Desktop/agent-collab && git add app/src/components/jiziLayout.ts app/src/components/jiziLayout.test.ts && git commit -m "feat(jizi): add pure layout helpers for placement and side properties"
```

---

## Task 3: ResizeHandle 扩展支持 jizi 侧拖拽

**Files:**
- Modify: `app/src/components/ResizeHandle.tsx`

> 说明：ResizeHandle 无独立单测（依赖 pointer 事件与 store），本 Task 只做实现，行为在 Task 7 手动验证。改动小且类型安全，tsc 兜底。

- [ ] **Step 1: 改 Props 与实现**

在 `app/src/components/ResizeHandle.tsx`：

(a) Props 的 `side` 类型加 `'jizi'`：

```ts
interface Props {
  side: 'left' | 'right' | 'jizi';
}
```

(b) 组件顶部再取一个 setter：

```ts
  const setLeftWidth = useUiStore((s) => s.setLeftWidth);
  const setRightWidth = useUiStore((s) => s.setRightWidth);
  const setJiziWidth = useUiStore((s) => s.setJiziWidth);
```

(c) `onMove` 分支补 jizi（姬子侧栏手柄挂在其左边缘，向左拖变宽，与 right 一致用 `startW - dx`）：

```ts
    function onMove(ev: PointerEvent) {
      if (!active) return;
      const dx = ev.clientX - startX;
      if (side === 'left') setLeftWidth(startW + dx);
      else if (side === 'jizi') setJiziWidth(startW - dx);
      else setRightWidth(startW - dx);
    }
```

(d) `onDown` 里 `startW` 计算补 jizi：

```ts
      startW =
        side === 'left'
          ? useUiStore.getState().leftWidth
          : side === 'jizi'
            ? useUiStore.getState().jiziWidth
            : useUiStore.getState().rightWidth;
```

(e) effect 依赖数组补 `setJiziWidth`：

```ts
  }, [side, setLeftWidth, setRightWidth, setJiziWidth]);
```

- [ ] **Step 2: 校验类型**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 3: 提交（需用户授权）**

```bash
cd /c/Users/Admin/Desktop/agent-collab && git add app/src/components/ResizeHandle.tsx && git commit -m "feat(ui): support jizi side in ResizeHandle bound to jiziWidth"
```

---

## Task 4: JiziSideDock 侧栏外壳组件

**Files:**
- Create: `app/src/components/MasterAgentPanel/JiziSideDock.tsx`

> 说明：纯 UI 组件，复用 `MasterAgentPanel` 与 masterAgentStore 现有 selectors，行为在 Task 7 手动验证。会话数据/动作与 `MasterSessionRail` 完全同源（同一 store），只是换紧凑下拉呈现，保持诊断会话置顶、删除二次确认等既有约束。

- [ ] **Step 1: 创建组件**

创建 `app/src/components/MasterAgentPanel/JiziSideDock.tsx`：

```tsx
import { useMemo, useState } from 'react';
import { App, Dropdown, Tooltip, type MenuProps } from 'antd';
import {
  RobotOutlined,
  PlusOutlined,
  DownOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DeleteOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';
import MasterAgentPanel from '../MasterAgentPanel';
import ResizeHandle from '../ResizeHandle';
import { useUiStore } from '../../stores/uiStore';
import {
  useMasterAgentStore,
  DIAGNOSIS_SESSION_ID,
} from '../../stores/masterAgentStore';

// 侧栏模式下姬子常驻:折叠成窄条(点图标展开)/展开为会话下拉 + 复用聊天面板。
// 会话切换收成顶部下拉,避免 208px 会话栏挤占窄侧栏宽度。
function JiziSideDock() {
  const { modal } = App.useApp();
  const width = useUiStore((s) => s.jiziWidth);
  const collapsed = useUiStore((s) => s.jiziSideCollapsed);
  const setCollapsed = useUiStore((s) => s.setJiziSideCollapsed);

  const sessions = useMasterAgentStore((s) => s.sessions);
  const activeId = useMasterAgentStore((s) => s.activeId);
  const newSession = useMasterAgentStore((s) => s.newSession);
  const switchSession = useMasterAgentStore((s) => s.switchSession);
  const deleteSession = useMasterAgentStore((s) => s.deleteSession);
  const [menuOpen, setMenuOpen] = useState(false);

  const ordered = useMemo(() => {
    const diagnosis = sessions.filter((s) => s.id === DIAGNOSIS_SESSION_ID);
    const rest = sessions
      .filter((s) => s.id !== DIAGNOSIS_SESSION_ID)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return [...diagnosis, ...rest];
  }, [sessions]);

  const activeTitle =
    sessions.find((s) => s.id === activeId)?.title ?? '姬子';

  const onDelete = (id: string, title: string) => {
    modal.confirm({
      title: '删除会话',
      content: `确定删除「${title}」？该会话的消息将被永久销毁，不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteSession(id),
    });
  };

  const items: MenuProps['items'] = ordered.map((s) => {
    const isDiagnosis = s.id === DIAGNOSIS_SESSION_ID;
    return {
      key: s.id,
      icon: isDiagnosis ? <MedicineBoxOutlined /> : undefined,
      label: (
        <span className="jizi-side-dock__session-item">
          <span className="jizi-side-dock__session-title">{s.title}</span>
          {!isDiagnosis && (
            <Tooltip title="删除会话">
              <DeleteOutlined
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id, s.title);
                }}
              />
            </Tooltip>
          )}
        </span>
      ),
    };
  });

  if (collapsed) {
    return (
      <div className="jizi-side-dock jizi-side-dock--collapsed">
        <Tooltip title="展开姬子" placement="left">
          <button
            type="button"
            className="jizi-side-dock__expand"
            aria-label="展开姬子"
            onClick={() => setCollapsed(false)}
          >
            <RobotOutlined />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="jizi-side-dock" style={{ width }}>
      <ResizeHandle side="jizi" />
      <div className="jizi-side-dock__header">
        <Dropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={['click']}
          menu={{
            items,
            selectedKeys: activeId ? [activeId] : [],
            onClick: ({ key }) => {
              switchSession(key);
              setMenuOpen(false);
            },
          }}
        >
          <button type="button" className="jizi-side-dock__session-switch">
            <RobotOutlined />
            <span className="jizi-side-dock__session-current">{activeTitle}</span>
            <DownOutlined />
          </button>
        </Dropdown>
        <div className="jizi-side-dock__actions">
          <Tooltip title="新建会话">
            <button
              type="button"
              className="jizi-side-dock__icon-btn"
              aria-label="新建会话"
              onClick={() => newSession()}
            >
              <PlusOutlined />
            </button>
          </Tooltip>
          <Tooltip title="折叠">
            <button
              type="button"
              className="jizi-side-dock__icon-btn"
              aria-label="折叠姬子"
              onClick={() => setCollapsed(true)}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="jizi-side-dock__body">
        <MasterAgentPanel />
      </div>
    </div>
  );
}

export default JiziSideDock;
```

- [ ] **Step 2: 校验类型**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit`
Expected: 0 errors。（若 `MasterAgentPanel` 默认导出路径或 `masterAgentStore` 导出名不符，按报错修正 import；参考 `MasterAgentDrawer.tsx` / `MasterSessionRail.tsx` 的既有 import。）

- [ ] **Step 3: 提交（需用户授权）**

```bash
cd /c/Users/Admin/Desktop/agent-collab && git add app/src/components/MasterAgentPanel/JiziSideDock.tsx && git commit -m "feat(jizi): add side dock shell reusing MasterAgentPanel with session dropdown"
```

---

## Task 5: App.tsx 按生效布局二选一渲染

**Files:**
- Modify: `app/src/App.tsx`

> 说明：布局接线，行为在 Task 7 手动验证；tsc 兜底类型。需要读取当前选中节点与 onboarding 状态。

- [ ] **Step 1: 补 import 与派生状态**

在 `app/src/App.tsx` 顶部 import 区加：

```ts
import JiziSideDock from './components/MasterAgentPanel/JiziSideDock';
import { effectiveJiziPlacement, shouldRenderSideProperties } from './components/jiziLayout';
import { useSelectedNodeContext } from './components/PropertiesPanel/useSelectedNodeContext';
import { useOnboardingStore } from './onboarding/onboardingStore';
```

在 `App` 组件函数体内（其它 `useUiStore(...)` 读取附近）加：

```ts
  const jiziPlacement = useUiStore((s) => s.jiziPlacement);
  const onboardingActive = useOnboardingStore((s) => s.status === 'active');
  const { node: selectedNode } = useSelectedNodeContext();
  const placement = effectiveJiziPlacement(jiziPlacement, onboardingActive);
```

> 校验点：确认 `useOnboardingStore` 有 `status` 字段（见 `OnboardingController.tsx` 用法 `useOnboardingStore((state) => state.status)`，'active' 为进行中）。`useSelectedNodeContext` 返回 `{ activeId, canvas, node }`（见 `PropertiesPanel.tsx:81`）。

- [ ] **Step 2: 改 workspace-layer 渲染分支**

把现有：

```tsx
          <MasterAgentDrawer />
          <JiziCommandCenter />
          <div className="app-body anim-fade">
            <LeftSidebar />
            <div className="canvas-column">
              <CanvasTabs />
              <CanvasArea />
              <CanvasStatusBar />
            </div>
            <PropertiesPanel />
          </div>
```

改为：

```tsx
          {placement === 'top' && <MasterAgentDrawer />}
          <JiziCommandCenter />
          <div className="app-body anim-fade">
            <LeftSidebar />
            <div className="canvas-column">
              <CanvasTabs />
              <CanvasArea />
              <CanvasStatusBar />
            </div>
            {placement === 'side' && <JiziSideDock />}
            {placement === 'top'
              ? <PropertiesPanel />
              : shouldRenderSideProperties(!!selectedNode) && <PropertiesPanel />}
          </div>
```

> 关键：顶部模式下 `PropertiesPanel` 仍无条件渲染（保持现状、不动引导）；侧栏模式下姬子在属性左边、属性选中节点才出现。

- [ ] **Step 3: 校验类型**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: 提交（需用户授权）**

```bash
cd /c/Users/Admin/Desktop/agent-collab && git add app/src/App.tsx && git commit -m "feat(jizi): branch workspace layout between top drawer and side dock"
```

---

## Task 6: 设置中心「面板位置」开关 + 搜索关键词

**Files:**
- Modify: `app/src/components/MasterConfigModal.tsx`（`JiziSettingsPanel`）
- Modify: `app/src/settings/settingsCatalog.ts`

> 说明：设置 UI 接线，行为在 Task 7 验证。

- [ ] **Step 1: settingsCatalog 补关键词**

在 `app/src/settings/settingsCatalog.ts` 的 `jizi` 项 `keywords` 数组末尾补：

```ts
    keywords: ['人格', '提示词', '记忆', '诊断', '系统提示词', '布局', '侧边栏', '位置', '显示模式'],
```

- [ ] **Step 2: JiziSettingsPanel 加 Segmented**

先确认 `JiziSettingsPanel` 结构：

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit >/dev/null; grep -n "JiziSettingsPanel\|Segmented\|import" src/components/MasterConfigModal.tsx | head -40`

在 `MasterConfigModal.tsx` 内 `JiziSettingsPanel` 组件里，于人格/记忆等配置项**最上方**新增一节「面板位置」。读取/写入用 uiStore：

```tsx
// 顶部 import 区(若尚未引入)
import { Segmented } from 'antd';
import { useUiStore } from '../stores/uiStore';
```

```tsx
// JiziSettingsPanel 组件体内
const jiziPlacement = useUiStore((s) => s.jiziPlacement);
const setJiziPlacement = useUiStore((s) => s.setJiziPlacement);
```

```tsx
{/* 面板位置:顶部抽屉 / 右侧边栏。切换即时生效并持久化。 */}
<section className="jizi-settings__section">
  <div className="jizi-settings__section-title">面板位置</div>
  <div className="jizi-settings__section-desc">
    选择姬子的呈现方式:从顶部下拉的抽屉,或常驻画布右侧的竖栏。
  </div>
  <Segmented
    value={jiziPlacement}
    onChange={(v) => setJiziPlacement(v as 'top' | 'side')}
    options={[
      { label: '顶部抽屉', value: 'top' },
      { label: '右侧边栏', value: 'side' },
    ]}
  />
</section>
```

> 若 `JiziSettingsPanel` 已有自己的分节 class 命名（非 `jizi-settings__section`），改用其既有 class 与既有排版风格保持一致（按 Step 2 的 grep 结果对齐）。此开关不受 `onDirtyChange` 脏标记影响（切换即时落盘，不属于"保存/取消"表单字段），因此**不要**调用 `onDirtyChange`。

- [ ] **Step 3: 校验类型 + lint**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit && npm run lint`
Expected: 0 errors；lint EXIT 0。

- [ ] **Step 4: 提交（需用户授权）**

```bash
cd /c/Users/Admin/Desktop/agent-collab && git add app/src/components/MasterConfigModal.tsx app/src/settings/settingsCatalog.ts && git commit -m "feat(settings): add jizi panel placement toggle in JiziSettingsPanel"
```

---

## Task 7: App.css 侧栏样式 + 折叠窄条 + resize 手柄

**Files:**
- Modify: `app/src/App.css`

- [ ] **Step 1: 追加样式**

在 `app/src/App.css` 的 `.master-drawer` 区块附近（例如 `.session-rail` 定义之后）追加：

```css
/* 姬子右侧常驻竖栏:位于画布列与属性面板之间(或最右) */
.jizi-side-dock {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border-left: 1px solid #e5e6eb;
  box-shadow: -3px 0 8px -6px rgba(0, 0, 0, 0.2);
}

.jizi-side-dock--collapsed {
  width: 44px;
  align-items: center;
  justify-content: flex-start;
  padding-top: 10px;
}

.jizi-side-dock__expand {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: #f2f3f5;
  color: #4e5969;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.jizi-side-dock__expand:hover {
  background: #e8f3ff;
  color: #1677ff;
}

.jizi-side-dock__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #e5e6eb;
}

.jizi-side-dock__session-switch {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #fafafb;
  color: #1d2129;
  font-size: 13px;
  cursor: pointer;
}
.jizi-side-dock__session-current {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.jizi-side-dock__actions {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 4px;
}
.jizi-side-dock__icon-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #4e5969;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.jizi-side-dock__icon-btn:hover {
  background: #f2f3f5;
  color: #1677ff;
}

.jizi-side-dock__body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.jizi-side-dock__session-item {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.jizi-side-dock__session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 姬子侧栏拖拽手柄:挂在左边缘 */
.resize-handle--jizi {
  left: -7px;
}
```

- [ ] **Step 2: 启动 dev server 手动验证**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npm run dev`（后台起）；在浏览器打开 dev URL。

验证清单（golden path + 边缘）：
1. **默认顶部**：首次/现状下姬子仍是顶部抽屉，pill 徽章、50vh/全屏、行为与改动前一致。
2. **切侧栏**：设置中心 → 姬子配置 → 面板位置选「右侧边栏」→ 姬子变右侧常驻竖栏,顶部 pill 消失。
3. **属性按需**：侧栏模式未选中节点只有姬子;点画布节点后属性栏出现在姬子**右边**;取消选中(点空白)属性栏消失。
4. **会话下拉**：点姬子侧栏顶部会话名 → 下拉列出会话,能切换/新建;诊断会话置顶且带图标;删除弹二次确认。
5. **折叠**：点折叠按钮 → 侧栏收成窄条,画布变宽;点窄条机器人图标恢复展开。
6. **宽度拖拽**：拖姬子侧栏左边缘手柄改宽度;拖属性面板手柄改宽度;刷新后两者宽度、`jiziPlacement`、折叠态保持。
7. **切回顶部**：设置里切回「顶部抽屉」→ 侧栏消失,顶部抽屉恢复,属性面板恢复无条件常驻。
8. **姬子功能**：侧栏模式下发消息、规划画布、执行 action 卡确认流程正常(与顶部模式等价)。

> 若发现姬子在侧栏模式下重复挂载或消息 abort 异常,检查 App 是否同时渲染了 `MasterAgentDrawer` 与 `JiziSideDock`（应互斥）。

- [ ] **Step 3: 提交（需用户授权）**

```bash
cd /c/Users/Admin/Desktop/agent-collab && git add app/src/App.css && git commit -m "style(jizi): add side dock, collapsed rail and resize handle styles"
```

---

## Task 8: 收口校验

**Files:** 无（仅校验）

- [ ] **Step 1: 全量 tsc**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 2: lint**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npm run lint`
Expected: EXIT 0。

- [ ] **Step 3: 全量测试**

Run: `cd /c/Users/Admin/Desktop/agent-collab/app && npx vitest run`
Expected: 全绿（含新增 `uiStore.test.ts`、`jiziLayout.test.ts`，既有 `masterDrawerDisplay` / `uiStore` drawer display mode 等不回归）。

- [ ] **Step 4: onboarding 回归确认（手动）**

在 workspace 触发新手引导（或临时把 onboarding status 置 'active'）：确认引导激活期间姬子始终是顶部抽屉（`effectiveJiziPlacement` 强制 top），教程步骤 3（查看节点属性,靶点 `properties-panel`）与步骤 6（使用姬子,靶点 `jizi-entry`）靶点存在、可正常推进。

---

## Self-Review（写计划者自检）

**Spec 覆盖**
- 布局结构(选中/未选中节点两态、姬子在属性左边) → Task 5 Step 2。 ✅
- 会话列表收成顶部下拉 → Task 4。 ✅
- 模式开关放设置中心 jizi 分区 → Task 6。 ✅
- 默认顶部抽屉 → Task 1 默认值 'top' + Task 2 生效判定。 ✅
- 侧栏可折叠成窄条 → Task 4 collapsed 分支 + Task 7 样式。 ✅
- 全屏只属顶部模式 → 侧栏不引入 fullscreen（Task 4/5 未涉及 drawerFullscreen）。 ✅
- 状态字段/persist/migrate → Task 1。 ✅
- ResizeHandle 支持 jizi → Task 3。 ✅
- 风险1(双挂载/in-flight)：Task 5 互斥渲染 + Task 7 Step2 验证点8/排查提示。 ✅
- 风险2(切换 in-flight)：侧栏常驻不卸载、顶部保持既有延后卸载逻辑;切换只是换渲染分支,MasterAgentPanel 底层 store 不变(会话/消息在 masterAgentStore,非组件内 state),故切换不 abort。已在 Task 5 说明互斥,Task7 验证点8覆盖。 ✅
- 风险3(属性面板改按需影响 onboarding)：顶部模式保持无条件属性面板 + 引导强制 top(Task 2) + Task 8 Step4 回归。 ✅
- 风险5(persist 迁移)：Task 1 migrate 补默认值 + 测试。 ✅

**Placeholder 扫描**：无 TBD/TODO;每个代码步骤都给了完整代码。Task 6 Step2 对 `JiziSettingsPanel` 既有 class 命名留了"按 grep 结果对齐"的判断（因该文件未逐行读，但给了明确的对齐依据与 grep 命令）。 ✅

**类型一致性**：`jiziPlacement:'top'|'side'`、`setJiziPlacement`、`jiziWidth`/`setJiziWidth`、`jiziSideCollapsed`/`setJiziSideCollapsed`、`JIZI_MIN`/`JIZI_MAX`、`effectiveJiziPlacement`/`shouldRenderSideProperties`、`ResizeHandle side='jizi'` 在各 Task 间命名一致。 ✅
