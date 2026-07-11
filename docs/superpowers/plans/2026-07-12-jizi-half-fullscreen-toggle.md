# 姬子半屏 / 全屏切换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为姬子抽屉增加持久化的半屏 / 内容区全屏滑动开关，全屏覆盖标题栏以下工作台但不卸载画布组件。

**Architecture:** 在 `uiStore` 中增加持久化的 `drawerFullscreen` 布尔状态；`MasterAgentDrawer` 只负责展示和切换该状态，并通过根节点修饰类驱动覆盖布局。全屏使用位于标题栏下方的绝对覆盖层，工作台继续挂载，聊天业务组件不感知模式变化。

**Tech Stack:** React 19、TypeScript、Zustand persist、Ant Design `Switch` / `Tooltip`、Vitest、Playwright、CSS Flex / absolute positioning

## Global Constraints

- 首次默认半屏，半屏高度保持 `50vh`。
- `drawerFullscreen` 持久化；`drawerExpanded` 继续保持瞬态。
- 全屏仅覆盖标题栏以下内容区，标题栏命令始终可用。
- 画布、侧栏和运行组件不得因模式切换而卸载。
- 控件必须具有可访问名称、当前状态文案和 Tooltip。
- 必须验证 `1024 × 640` 与 `1920 × 1080` 两个视口。
- 不增加快捷键、拖拽高度或系统级 Fullscreen API。
- 不修改现有未提交的 `app/src-tauri/Cargo.toml`。

---

### Task 1: 持久化显示模式状态

**Files:**
- Create: `app/src/stores/uiStore.test.ts`
- Modify: `app/src/stores/uiStore.ts`

**Interfaces:**
- Produces: `drawerFullscreen: boolean`
- Produces: `setDrawerFullscreen(value: boolean): void`
- Produces: `partializeUiState(state: UiState)`，供 Zustand persist 与单元测试共用

- [ ] **Step 1: 写失败测试，锁定默认值、切换和持久化字段**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { partializeUiState, useUiStore } from './uiStore';

describe('uiStore drawer display mode', () => {
  beforeEach(() => {
    useUiStore.setState({ drawerExpanded: false, drawerFullscreen: false });
  });

  it('defaults to half height and updates fullscreen mode explicitly', () => {
    expect(useUiStore.getState().drawerFullscreen).toBe(false);
    useUiStore.getState().setDrawerFullscreen(true);
    expect(useUiStore.getState().drawerFullscreen).toBe(true);
  });

  it('persists fullscreen preference but not expanded state', () => {
    const persisted = partializeUiState({
      ...useUiStore.getState(),
      drawerExpanded: true,
      drawerFullscreen: true,
    });
    expect(persisted.drawerFullscreen).toBe(true);
    expect(persisted).not.toHaveProperty('drawerExpanded');
  });
});
```

- [ ] **Step 2: 运行定向测试并确认因接口缺失而失败**

Run: `cd app && npm.cmd test -- src/stores/uiStore.test.ts`

Expected: FAIL，提示 `drawerFullscreen` / `setDrawerFullscreen` / `partializeUiState` 不存在。

- [ ] **Step 3: 增加最小 Store 实现**

在 `UiState` 中增加：

```ts
drawerFullscreen: boolean;
setDrawerFullscreen: (value: boolean) => void;
```

导出并复用持久化选择函数：

```ts
export function partializeUiState(state: UiState) {
  return {
    leftWidth: state.leftWidth,
    rightWidth: state.rightWidth,
    masterModel: state.masterModel,
    drawerFullscreen: state.drawerFullscreen,
  };
}
```

Store 默认值和动作：

```ts
drawerFullscreen: false,
setDrawerFullscreen: (drawerFullscreen) => set({ drawerFullscreen }),
```

保持 persist 版本不变，只替换选择函数；Zustand 默认 merge 会给旧数据补上默认的 `drawerFullscreen: false`，不能在没有迁移函数时升级版本：

```ts
version: 1,
partialize: partializeUiState,
```

- [ ] **Step 4: 运行定向测试确认通过**

Run: `cd app && npm.cmd test -- src/stores/uiStore.test.ts`

Expected: `1` 个测试文件、`2` 项测试通过。

- [ ] **Step 5: 提交状态层改动**

```powershell
git add app/src/stores/uiStore.ts app/src/stores/uiStore.test.ts
git commit -m "feat(jizi): persist drawer display mode"
```

---

### Task 2: 接入滑动开关与全屏覆盖布局

**Files:**
- Create: `app/src/components/MasterAgentDrawer.test.tsx`
- Modify: `app/src/components/MasterAgentDrawer.tsx`
- Modify: `app/src/App.css`

**Interfaces:**
- Consumes: `drawerFullscreen` 和 `setDrawerFullscreen(value)`
- Produces: 根节点修饰类 `master-drawer--fullscreen`
- Produces: `role="switch"`、状态文案“半屏 / 全屏”和对应 Tooltip

- [ ] **Step 1: 写失败的 SSR 组件测试**

Mock `MasterAgentPanel`、`MasterSessionRail` 和 `MasterConfigModal` 为轻量占位组件，避免聊天业务依赖进入本测试；测试代码核心如下：

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../stores/uiStore';
import MasterAgentDrawer from './MasterAgentDrawer';

vi.mock('./MasterAgentPanel', () => ({ default: () => <div>chat</div> }));
vi.mock('./MasterSessionRail', () => ({ default: () => <div>sessions</div> }));
vi.mock('./MasterConfigModal', () => ({ default: () => null }));

describe('MasterAgentDrawer display mode', () => {
  beforeEach(() => {
    useUiStore.setState({ drawerExpanded: true, drawerFullscreen: false });
  });

  it('renders an accessible half/fullscreen switch', () => {
    const html = renderToStaticMarkup(<MasterAgentDrawer />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="姬子显示模式，当前半屏"');
    expect(html).not.toContain('master-drawer--fullscreen');
  });

  it('marks the drawer fullscreen without removing its shell', () => {
    useUiStore.setState({ drawerFullscreen: true });
    const html = renderToStaticMarkup(<MasterAgentDrawer />);
    expect(html).toContain('master-drawer--fullscreen');
    expect(html).toContain('aria-label="姬子显示模式，当前全屏"');
    expect(html).toContain('master-drawer__content--open');
  });
});
```

- [ ] **Step 2: 运行定向测试确认缺少开关和全屏类**

Run: `cd app && npm.cmd test -- src/components/MasterAgentDrawer.test.tsx`

Expected: FAIL，HTML 中不存在 `role="switch"` 和 `master-drawer--fullscreen`。

- [ ] **Step 3: 在抽屉控制条加入 Switch 和 Tooltip**

在 `MasterAgentDrawer.tsx` 引入 `Switch`、`Tooltip`，读取 Store 状态：

```tsx
const fullscreen = useUiStore((s) => s.drawerFullscreen);
const setFullscreen = useUiStore((s) => s.setDrawerFullscreen);
const fullscreenActive = expanded && fullscreen;
```

根节点与控制条：

```tsx
<div className={`master-drawer${fullscreenActive ? ' master-drawer--fullscreen' : ''}`}>
  <div className="master-drawer__bar">
    <button className="master-drawer__trigger" ...>...</button>
    {expanded && (
      <div className="master-drawer__mode">
        <Tooltip title={fullscreen ? '切换为半屏' : '切换为全屏'}>
          <Switch
            checked={fullscreen}
            checkedChildren="全屏"
            unCheckedChildren="半屏"
            aria-label={`姬子显示模式，当前${fullscreen ? '全屏' : '半屏'}`}
            onChange={setFullscreen}
          />
        </Tooltip>
      </div>
    )}
  </div>
  ...
</div>
```

- [ ] **Step 4: 增加稳定的半屏与覆盖布局 CSS**

保持 `.master-drawer__content--open { height: 50vh; }`，新增：

```css
.master-drawer__bar {
  position: relative;
  height: 26px;
  flex: 0 0 26px;
}

.master-drawer__mode {
  position: absolute;
  z-index: 1;
  top: 2px;
  right: 12px;
  display: flex;
  align-items: center;
}

.master-drawer__mode .ant-switch {
  min-width: 58px;
}

.master-drawer--fullscreen {
  position: absolute;
  z-index: 80;
  inset: 44px 0 0;
  min-height: 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.master-drawer--fullscreen .master-drawer__content--open {
  height: calc(100% - 26px);
}
```

把现有触发器高度放进 `master-drawer__bar`，触发器继续绝对铺满控制条；开关作为兄弟节点以更高层级接收点击。给 `.app-shell` 增加 `position: relative`，确保覆盖层相对应用内容定位。

```css
.master-drawer__trigger {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 26px;
}
```

- [ ] **Step 5: 运行定向测试和前端回归测试**

Run: `cd app && npm.cmd test -- src/components/MasterAgentDrawer.test.tsx src/stores/uiStore.test.ts`

Expected: `2` 个测试文件、`4` 项测试通过。

Run: `cd app && npm.cmd test`

Expected: 所有前端测试通过，无新增 warning 或未处理异常。

- [ ] **Step 6: 提交交互与布局改动**

```powershell
git add app/src/components/MasterAgentDrawer.tsx app/src/components/MasterAgentDrawer.test.tsx app/src/App.css
git commit -m "feat(jizi): add half and fullscreen drawer toggle"
```

---

### Task 3: 真实浏览器视觉验收与工程门禁

**Files:**
- Modify only if verification reveals a defect: `app/src/App.css`
- Verification artifacts: temporary screenshots outside Git tracking

**Interfaces:**
- Consumes: 可访问名称 `姬子显示模式，当前半屏` / `姬子显示模式，当前全屏`
- Verifies: 标题栏、工作台 DOM、会话栏、消息区和输入框

- [ ] **Step 1: 启动浏览器开发服务**

Run: `cd app && npm.cmd run dev -- --host 127.0.0.1`

Expected: Vite 输出本地 URL；若 `5173` 已占用，使用自动分配的新端口。

- [ ] **Step 2: 在 1024 × 640 验证半屏和全屏**

使用 Playwright 打开本地 URL，展开姬子并定位 `role="switch"`：

```ts
await page.setViewportSize({ width: 1024, height: 640 });
await page.getByRole('button', { name: '展开姬子' }).click();
const mode = page.getByRole('switch', { name: '姬子显示模式，当前半屏' });
await expect(mode).toBeVisible();
await mode.click();
await expect(page.locator('.master-drawer--fullscreen')).toBeVisible();
await expect(page.locator('.title-bar')).toBeVisible();
await expect(page.locator('.app-body')).toBeAttached();
await expect(page.locator('.master-composer')).toBeVisible();
```

截图确认：抽屉顶部不遮挡标题栏，输入框没有越出底边，会话栏不覆盖消息区，页面没有水平滚动条。

- [ ] **Step 3: 在 1920 × 1080 验证阅读宽度与模式记忆**

```ts
await page.setViewportSize({ width: 1920, height: 1080 });
await expect(page.locator('.master-chat')).toHaveCSS('max-width', '920px');
await page.getByRole('button', { name: '收起姬子' }).click();
await page.getByRole('button', { name: '展开姬子' }).click();
await expect(page.getByRole('switch', { name: '姬子显示模式，当前全屏' })).toBeVisible();
await page.reload();
await page.getByRole('button', { name: '展开姬子' }).click();
await expect(page.getByRole('switch', { name: '姬子显示模式，当前全屏' })).toBeVisible();
```

截图确认：正文没有被拉成超长行，左右留白均衡，标题栏命令可见。

- [ ] **Step 4: 运行最终工程门禁**

Run: `cd app && npm.cmd test`

Expected: 全部测试通过。

Run: `cd app && npm.cmd run lint`

Expected: exit code `0`，无 lint error。

Run: `cd app && npm.cmd run build`

Expected: TypeScript 与 Vite 构建成功；允许保留现有大 chunk 性能提示。

- [ ] **Step 5: 检查范围并提交必要的视觉修正**

Run: `git diff --check`

Expected: 无空白错误；`app/src-tauri/Cargo.toml` 的既有改动仍未被暂存或修改。

若 Task 3 根据截图修改了 `app/src/App.css`：

```powershell
git add app/src/App.css
git commit -m "fix(jizi): refine fullscreen drawer layout"
```

若没有视觉修正，不创建空提交。
