# Fictionist UI Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the approved fictionist desktop UI with focused render tests and a concise manual browser checklist before behavior or file-structure changes begin.

**Architecture:** Keep production code unchanged. Extend the existing server-rendered Vitest coverage for all five fictionist sections, then use the real Vite application to exercise the critical navigation and editing flow. Record three desktop viewport sizes for manual acceptance; do not check transient screenshots into the repository while the UI is still an early prototype.

**Tech Stack:** React 19, TypeScript, Vitest, Vite, Ant Design, Playwright CLI.

## Global Constraints

- Preserve the existing fictionist layout, colors, density, navigation, and user-facing copy.
- Do not change production behavior or split `FictionistWorkspace.tsx` in this task.
- Do not add a new JavaScript test framework or dependency.
- Record `1280x720`, `1600x900`, and `1920x1080` as the manual desktop acceptance viewports.
- Keep user-visible copy in Chinese and internal file names in ASCII.
- Leave the existing untracked `.superpowers/` directory untouched.

---

### Task 1: Characterize All Fictionist Views

**Files:**
- Modify: `app/src/components/FictionistWorkspace/FictionistWorkspace.test.tsx`

**Interfaces:**
- Consumes: `FictionistWorkspace` and its existing `initialSection` prop.
- Produces: render assertions for `library`, `chapters`, `canon`, `timeline`, and `workflows` without changing production exports.

- [ ] **Step 1: Replace duplicated render setup with a local helper**

Use a helper that renders the component inside Ant Design's provider:

```tsx
function renderWorkspace(
  initialSection?: 'library' | 'chapters' | 'canon' | 'timeline' | 'workflows',
): string {
  return renderToStaticMarkup(
    <AntdApp>
      <FictionistWorkspace initialSection={initialSection} />
    </AntdApp>,
  );
}
```

- [ ] **Step 2: Add characterization assertions for all five sections**

Keep the existing library assertions and add section-specific checks:

```tsx
it('renders the chapter editor baseline', () => {
  const html = renderWorkspace('chapters');
  expect(html).toContain('卷与章节');
  expect(html).toContain('章节正文编辑区');
  expect(html).toContain('续写下一章');
  expect(html).toContain('本章上下文');
});

it('renders the canon baseline', () => {
  const html = renderWorkspace('canon');
  expect(html).toContain('作品事实库');
  expect(html).toContain('设定库');
  expect(html).toContain('新建设定');
  expect(html).toContain('林砚');
});

it('renders the timeline baseline', () => {
  const html = renderWorkspace('timeline');
  expect(html).toContain('事件与章节同步');
  expect(html).toContain('故事时间线');
  expect(html).toContain('新增事件');
  expect(html).toContain('七号泊位因事故永久封闭');
});

it('renders the workflow baseline', () => {
  const html = renderWorkspace('workflows');
  expect(html).toContain('从画布能力组合而来');
  expect(html).toContain('小说工作流');
  expect(html).toContain('在画布中编辑');
  expect(html).toContain('章节连续性检查');
});
```

- [ ] **Step 3: Run the focused test**

Run:

```powershell
cd app
npm.cmd test -- src/components/FictionistWorkspace/FictionistWorkspace.test.tsx
```

Expected: the fictionist test file passes with coverage for five sections.

### Task 2: Record the Browser Acceptance Baseline

**Files:**
- Create: `docs/ui-baselines/fictionist/README.md`

**Interfaces:**
- Consumes: the browser development build at a local Vite URL.
- Produces: a repeatable manual acceptance checklist for the approved visual and interaction scope.

- [ ] **Step 1: Add the baseline README**

Record the approved scope and acceptance sizes:

```markdown
# 小说家 UI 验收基线

这份清单记录功能接入前已经认可的小说家桌面界面。

- `1280x720`：最低可用窗口。
- `1600x900`：常见缩放或非全屏窗口。
- `1920x1080`：原生 Full HD。

覆盖书架、正文、设定库、时间线和工作流。功能接入、文件拆分或状态管理重构不能顺带重做界面。
```

- [ ] **Step 2: Start the browser development server**

Run from `app/`:

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

Expected: Vite reports a local URL and stays running.

- [ ] **Step 3: Verify the key interaction flow in a real browser**

Use a fresh browser context to verify the critical flow. Repeat the visual checks at all three viewports when a change affects layout or styling:

1. Open the application and select `小说家`.
2. Open `雾港来信` from the library.
3. Edit the chapter textarea and confirm `有未保存修改` appears.
4. Open `续写下一章` and confirm the context preview modal appears.
5. Close the modal and visit `设定库`, `时间线`, and `工作流`.
6. Confirm there are no console errors, horizontal overflow, clipped primary actions, or overlapping title-bar controls.

- [ ] **Step 4: Record the manual viewport checklist**

At `1280x720`, `1600x900`, and `1920x1080`, inspect all five sections without altering application CSS to make the UI fit.

- [ ] **Step 5: Inspect the interface**

Check each section for:

- nonblank content;
- complete title bar and project bar;
- readable navigation and main content;
- no incoherent overlap;
- no clipped buttons or text;
- no unexpected scrollbars that hide controls.

### Task 3: Run the Baseline Verification

**Files:**
- Verify only; no additional production files.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: a verified baseline commit suitable for later UI-preserving refactors.

- [ ] **Step 1: Run the full frontend test suite**

```powershell
cd app
npm.cmd test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run lint**

```powershell
cd app
npm.cmd run lint
```

Expected: exit code 0 with no lint errors.

- [ ] **Step 3: Run the production build**

```powershell
cd app
npm.cmd run build
```

Expected: exit code 0. Existing bundle-size warnings may remain, but there must be no build failure.

- [ ] **Step 4: Verify the change boundary**

```powershell
git diff --check
git status --short
```

Expected: only the plan, fictionist test, baseline README, and planning-document viewport note are changed; `.superpowers/` and transient browser output remain untracked and unstaged.

- [ ] **Step 5: Commit the baseline**

```powershell
git add docs/superpowers/plans/2026-07-23-fictionist-ui-baseline.md app/src/components/FictionistWorkspace/FictionistWorkspace.test.tsx docs/ui-baselines/fictionist/README.md 小说家与工作台集成规划.md
git commit -m "测试：固定小说家界面与交互基线"
```
