# Pearl Order Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved “珍珠秩序” visual system consistently across the application shell, workspace, settings, reports, Jizi surfaces, and secondary dialogs without changing business behavior.

**Architecture:** Establish one CSS token layer in `App.css`, map Ant Design theme tokens to the same palette in `main.tsx`, and let existing component class names consume those tokens. Preserve the current React component and state architecture; TSX edits are limited to removing hardcoded visual literals, adding stable styling hooks, and keeping page/modal transitions mounted long enough for smooth presentation.

**Tech Stack:** React 19, TypeScript 6, Ant Design 6, React Flow 12, Vitest 4, oxlint, Vite 8.

## Global Constraints

- Use the approved “局部玻璃、主体平整” Pearl Order direction.
- Minimum supported viewport remains `1024 x 640`.
- Use glass only for the title bar, floating toolbars, menus, Jizi overlays, and dialogs.
- Keep workspace, settings content, reports, lists, and property editing surfaces predominantly opaque and readable.
- Use radius values `10px`, `12px`, `16px`, `20px`, and `24px`; ordinary text buttons must not become pills.
- Use motion durations `140-180ms`, `220-280ms`, and `300-360ms` with `cubic-bezier(0.16, 1, 0.3, 1)` for emphasized entry.
- Preserve `prefers-reduced-motion` behavior.
- Do not add packages, change build tooling, or modify `app/src-tauri/`, `app/src/stores/`, `app/src/lib/`, or `app/src/settings/`.
- Do not change model, search, tool, canvas, Agent, report, or Jizi data behavior.
- At each task boundary, verify `git diff --name-only` contains only files listed by that task.

---

### Task 1: Pearl Design Tokens and Ant Design Theme

**Files:**
- Modify: `app/src/main.tsx`
- Modify: `app/src/index.css`
- Modify: `app/src/App.css`
- Modify: `app/src/components/SettingsCenter/SettingsStyles.test.ts`

**Interfaces:**
- Produces: CSS variables `--pearl-*`, shared radius/shadow/glass/motion tokens, and an Ant Design theme mapped to the same values.
- Consumed by: every later task through CSS only.

- [ ] **Step 1: Add failing token contract tests**

Extend `SettingsStyles.test.ts` with exact token assertions:

```ts
it('defines the Pearl Order color, radius, glass, and motion contracts', () => {
  expect(styles).toContain('--pearl-bg: #f3f5f3;');
  expect(styles).toContain('--pearl-surface: rgba(251, 252, 251, 0.94);');
  expect(styles).toContain('--pearl-accent: #6f8980;');
  expect(styles).toContain('--radius-panel: 20px;');
  expect(styles).toContain('--radius-dialog: 24px;');
  expect(styles).toContain('--glass-blur: 22px;');
  expect(styles).toContain('--motion-page: 340ms;');
});

it('keeps reduced-motion support in the global stylesheet', () => {
  expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
});
```

- [ ] **Step 2: Run the style test and verify RED**

Run: `cd app; npm.cmd test -- src/components/SettingsCenter/SettingsStyles.test.ts`

Expected: FAIL because the Pearl Order tokens do not exist.

- [ ] **Step 3: Replace the global token block**

At the top of `App.css`, define the complete shared contract:

```css
:root {
  --pearl-bg: #f3f5f3;
  --pearl-bg-soft: #eef1ef;
  --pearl-surface: rgba(251, 252, 251, 0.94);
  --pearl-surface-solid: #fbfcfb;
  --pearl-surface-muted: #e9eeeb;
  --pearl-glass: rgba(248, 250, 249, 0.78);
  --pearl-text: #303734;
  --pearl-text-secondary: #6f7874;
  --pearl-text-tertiary: #929a96;
  --pearl-border: rgba(86, 103, 96, 0.16);
  --pearl-border-strong: rgba(86, 103, 96, 0.25);
  --pearl-accent: #6f8980;
  --pearl-accent-hover: #607a72;
  --pearl-accent-soft: rgba(111, 137, 128, 0.14);
  --pearl-blue: #7d919d;
  --pearl-violet: #90889b;
  --pearl-danger: #a56f72;
  --pearl-warning: #a48864;
  --pearl-success: #6f8c78;
  --radius-control: 12px;
  --radius-node: 16px;
  --radius-panel: 20px;
  --radius-dialog: 24px;
  --glass-blur: 22px;
  --shadow-soft: 0 14px 40px rgba(57, 70, 64, 0.08);
  --shadow-float: 0 24px 70px rgba(57, 70, 64, 0.14);
  --motion-fast: 160ms;
  --motion-base: 260ms;
  --motion-slow: 320ms;
  --motion-page: 340ms;
  --motion-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --motion-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Retain the existing keyframes and reduced-motion block. Change `anim-fade-in-up` to use `translateY(10px)` and add a page transition that never transforms the React Flow canvas:

```css
@keyframes pearl-page-enter {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.pearl-page-enter {
  animation: pearl-page-enter var(--motion-page) var(--motion-ease-out) both;
}
```

- [ ] **Step 4: Map Ant Design and document base styles to the tokens**

Replace the theme in `main.tsx` with:

```ts
const theme = {
  token: {
    colorPrimary: '#6f8980',
    colorInfo: '#7d919d',
    colorSuccess: '#6f8c78',
    colorWarning: '#a48864',
    colorError: '#a56f72',
    colorText: '#303734',
    colorTextSecondary: '#6f7874',
    colorBorder: 'rgba(86, 103, 96, 0.18)',
    colorBgBase: '#fbfcfb',
    colorBgLayout: '#f3f5f3',
    colorBgContainer: '#fbfcfb',
    borderRadius: 12,
    borderRadiusLG: 20,
    controlHeight: 36,
    fontFamily:
      '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Button: { fontWeight: 500, primaryShadow: 'none' },
    Modal: { borderRadiusLG: 24 },
    Segmented: { trackBg: '#e9eeeb' },
  },
};
```

Update `index.css` so `body` uses the same font stack, `var(--pearl-bg)` and `var(--pearl-text)`, and add `text-rendering: optimizeLegibility`.

- [ ] **Step 5: Verify tokens, lint, and build**

Run: `cd app; npm.cmd test -- src/components/SettingsCenter/SettingsStyles.test.ts; npm.cmd run lint; npm.cmd run build`

Expected: the focused test passes, lint exits 0, and build exits 0.

- [ ] **Step 6: Commit the token foundation**

```bash
git add app/src/main.tsx app/src/index.css app/src/App.css app/src/components/SettingsCenter/SettingsStyles.test.ts
git commit -m "style: add pearl order design tokens"
```

### Task 2: Application Shell, Title Bar, and Page Transitions

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.css`
- Modify: `app/src/components/TitleBar.tsx`
- Modify: `app/src/components/TitleBar.test.tsx`

**Interfaces:**
- Produces: stable `.app-view-stage`, `.title-bar__view-nav`, and `.pearl-modal-copy` hooks.
- Preserves: existing `PrimaryViewActions` callbacks, focus restoration, run/save behavior, and settings dirty confirmation.

- [ ] **Step 1: Add failing shell markup tests**

Add to `TitleBar.test.tsx`:

```ts
it('labels the primary view navigation for the Pearl shell', () => {
  const html = renderToStaticMarkup(
    <PrimaryViewActions
      view="workspace"
      onWorkspace={noop}
      onReports={noop}
      onSettings={noop}
      onRefreshReports={noop}
      onOpenOutput={noop}
    />,
  );

  expect(html).toContain('aria-label="一级页面"');
  expect(html).toContain('title-bar__view-nav');
});
```

- [ ] **Step 2: Run the title-bar test and verify RED**

Run: `cd app; npm.cmd test -- src/components/TitleBar.test.tsx`

Expected: FAIL because the navigation wrapper does not exist.

- [ ] **Step 3: Add stable semantic styling hooks**

Wrap each branch returned by `PrimaryViewActions` in:

```tsx
<nav className="title-bar__view-nav" aria-label="一级页面">
  {/* existing buttons */}
</nav>
```

Replace modal paragraph inline colors with:

```tsx
<p className="pearl-modal-copy pearl-modal-copy--compact">...</p>
<p className="pearl-modal-copy">...</p>
```

In `App.tsx`, add `pearl-page-enter` to reports and settings page containers, while leaving the mounted workspace canvas on opacity-only `.anim-fade`:

```tsx
{view === 'reports' && (
  <div className="app-body app-body--reports pearl-page-enter">
    <ReportCenter refreshToken={reportRefreshToken} />
  </div>
)}
{view === 'settings' && (
  <div className="app-view-stage pearl-page-enter">
    <SettingsCenter />
  </div>
)}
```

- [ ] **Step 4: Style the shell and title bar**

Implement the Pearl shell rules in `App.css`:

```css
.app-shell {
  background:
    radial-gradient(circle at 18% -10%, rgba(125, 145, 157, 0.12), transparent 34%),
    linear-gradient(145deg, var(--pearl-bg), var(--pearl-bg-soft));
}

.title-bar {
  height: 52px;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--pearl-border);
  background: var(--pearl-glass);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(var(--glass-blur)) saturate(115%);
}

.title-bar__logo {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: var(--pearl-accent-soft);
  color: var(--pearl-accent-hover);
}

.title-bar__view-nav {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.app-view-stage {
  position: absolute;
  inset: 52px 0 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

Restyle title-bar buttons to `12px` radius, remove pill styling from ordinary actions, and keep destructive run state visibly distinct.

- [ ] **Step 5: Verify behavior and build**

Run: `cd app; npm.cmd test -- src/components/TitleBar.test.tsx src/components/SettingsCenter/SettingsCenter.test.tsx; npm.cmd run build`

Expected: tests pass and build exits 0.

- [ ] **Step 6: Commit the shell update**

```bash
git add app/src/App.tsx app/src/App.css app/src/components/TitleBar.tsx app/src/components/TitleBar.test.tsx
git commit -m "style: unify pearl application shell"
```

### Task 3: Workspace Panels, Canvas, and Properties

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/components/LeftSidebar.tsx`
- Modify: `app/src/components/CanvasArea.tsx`
- Modify: `app/src/components/CanvasTabs.tsx`
- Modify: `app/src/components/CanvasStatusBar.tsx`
- Modify: `app/src/components/PropertiesPanel.tsx`

**Interfaces:**
- Produces: `.workspace-panel-header`, `.pearl-secondary-copy`, and tokenized React Flow edge/background colors.
- Preserves: resize handles, tab selection, canvas coordinates, node drag/drop, search, zoom, properties editing, and status behavior.

- [ ] **Step 1: Add a failing workspace style contract**

Add to `SettingsStyles.test.ts`:

```ts
it('uses flat Pearl workspace surfaces and a glass canvas toolbar', () => {
  expect(styles).toMatch(/\.agent-sidebar\s*\{[^}]*background:\s*var\(--pearl-surface\)/s);
  expect(styles).toMatch(/\.properties-panel\s*\{[^}]*background:\s*var\(--pearl-surface\)/s);
  expect(styles).toMatch(/\.canvas-toolbar\s*\{[^}]*backdrop-filter:\s*blur\(/s);
});
```

- [ ] **Step 2: Run the style test and verify RED**

Run: `cd app; npm.cmd test -- src/components/SettingsCenter/SettingsStyles.test.ts`

Expected: FAIL because the workspace still uses legacy white/gray literals.

- [ ] **Step 3: Remove scoped inline visual literals**

Replace the inline sidebar and properties headers with:

```tsx
<div className="workspace-panel-header">
  {/* existing header content */}
</div>
```

Replace modal helper paragraphs in `CanvasTabs.tsx` with `className="pearl-modal-copy pearl-modal-copy--compact"`.

Change React Flow literals in `CanvasArea.tsx` to:

```ts
const defaultEdgeOptions = {
  type: 'default',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { stroke: 'var(--pearl-accent)', strokeWidth: 1.6 },
};
```

Use `color="rgba(111, 120, 116, 0.12)"` for the dot background and `color="rgba(111, 137, 128, 0.24)"` for line background variants. These values match the token palette while React Flow requires concrete SVG color values.

- [ ] **Step 4: Apply the flat workspace layout**

Update existing selectors in `App.css` so the workspace uses:

```css
.app-body {
  gap: 12px;
  padding: 12px;
}

.agent-sidebar,
.properties-panel {
  overflow: hidden;
  border: 1px solid var(--pearl-border);
  border-radius: var(--radius-panel);
  background: var(--pearl-surface);
  box-shadow: var(--shadow-soft);
}

.canvas-column {
  overflow: hidden;
  border: 1px solid var(--pearl-border);
  border-radius: var(--radius-panel);
  background: rgba(247, 249, 248, 0.76);
  box-shadow: var(--shadow-soft);
}

.workspace-panel-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--pearl-border);
}

.canvas-area {
  background: transparent;
}

.canvas-toolbar,
.react-flow__controls {
  border: 1px solid var(--pearl-border);
  border-radius: 16px;
  background: var(--pearl-glass);
  box-shadow: var(--shadow-soft);
  backdrop-filter: blur(var(--glass-blur));
}
```

Replace scoped legacy blue, white, gray, red, orange, and green literals with the corresponding `--pearl-*` variables. Keep node status meaning unchanged.

- [ ] **Step 5: Run workspace tests and build**

Run: `cd app; npm.cmd test -- src/components/SettingsCenter/SettingsStyles.test.ts src/stores/canvasStore.test.ts; npm.cmd run build`

Expected: available tests pass and build exits 0.

- [ ] **Step 6: Commit the workspace update**

```bash
git add app/src/App.css app/src/components/LeftSidebar.tsx app/src/components/CanvasArea.tsx app/src/components/CanvasTabs.tsx app/src/components/CanvasStatusBar.tsx app/src/components/PropertiesPanel.tsx
git commit -m "style: redesign pearl workspace surfaces"
```

### Task 4: Settings and Report Centers

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/components/SettingsCenter/SettingsCenter.tsx`
- Modify: `app/src/components/SettingsCenter/SettingsCenter.test.tsx`
- Modify: `app/src/components/SettingsCenter/SettingsStyles.test.ts`
- Modify: `app/src/components/SettingsCenter/SystemDataSettingsPanel.tsx`
- Modify: `app/src/components/ReportCenter/ReportCenter.tsx`

**Interfaces:**
- Produces: unified `.page-kicker`, `.page-heading`, `.page-subtitle`, flat settings rows, and report section surfaces.
- Preserves: five settings sections, search, dirty confirmation, focus entry, report refresh, and report data rendering.

- [ ] **Step 1: Add failing semantic and style tests**

In `SettingsCenter.test.tsx`, assert the active panel renders the shared heading hooks:

```ts
expect(html).toContain('settings-content__kicker');
expect(html).toContain('settings-content__title');
```

In `SettingsStyles.test.ts`, add:

```ts
it('uses a flat Pearl settings layout without nested section cards', () => {
  expect(styles).toMatch(/\.settings-center\s*\{[^}]*background:\s*var\(--pearl-bg\)/s);
  expect(styles).toMatch(/\.settings-content\s*\{[^}]*background:\s*var\(--pearl-surface-solid\)/s);
  expect(styles).toMatch(/\.settings-nav__item--active[^}]*background:\s*var\(--pearl-accent-soft\)/s);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd app; npm.cmd test -- src/components/SettingsCenter/SettingsCenter.test.tsx src/components/SettingsCenter/SettingsStyles.test.ts`

Expected: FAIL because the new hooks and tokenized styles do not exist.

- [ ] **Step 3: Add shared page heading markup**

Change the settings header to:

```tsx
<header className="settings-content__header">
  <span className="settings-content__kicker">设置中心</span>
  <h1 className="settings-content__title" ref={pageHeadingRef} tabIndex={-1}>
    {activeItem.title}
  </h1>
  <p className="settings-content__subtitle">{activeItem.description}</p>
</header>
```

Replace hardcoded status icon colors in `SystemDataSettingsPanel.tsx` with CSS classes `system-settings-row__status--ok` and `system-settings-row__status--error`.

Replace the report empty-reason inline gray with `className="report-center__muted"`.

- [ ] **Step 4: Apply the Pearl page layout**

Use these structural rules and update existing descendant selectors to the same tokens:

```css
.settings-center {
  inset: 0;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: 0;
  padding: 14px;
  background: var(--pearl-bg);
}

.settings-nav {
  padding: 18px 14px;
  border: 1px solid var(--pearl-border);
  border-right: 0;
  border-radius: var(--radius-panel) 0 0 var(--radius-panel);
  background: var(--pearl-surface);
}

.settings-content {
  border: 1px solid var(--pearl-border);
  border-radius: 0 var(--radius-panel) var(--radius-panel) 0;
  background: var(--pearl-surface-solid);
  box-shadow: var(--shadow-soft);
}

.settings-nav__item {
  min-height: 52px;
  border-radius: 12px;
}

.settings-nav__item--active,
.settings-nav__item--active:hover {
  background: var(--pearl-accent-soft);
  color: var(--pearl-accent-hover);
}

.settings-content__kicker {
  color: var(--pearl-accent);
  font-size: 12px;
  font-weight: 500;
}
```

Give `.report-center` the same maximum content width, heading rhythm, surface colors, `20px` section radius, and flat non-nested layout.

- [ ] **Step 5: Run settings/report tests and build**

Run: `cd app; npm.cmd test -- src/components/SettingsCenter/SettingsCenter.test.tsx src/components/SettingsCenter/SettingsStyles.test.ts src/components/SettingsCenter/SystemDataSettingsPanel.test.tsx; npm.cmd run build`

Expected: tests pass and build exits 0.

- [ ] **Step 6: Commit the page update**

```bash
git add app/src/App.css app/src/components/SettingsCenter app/src/components/ReportCenter/ReportCenter.tsx
git commit -m "style: unify pearl settings and reports"
```

### Task 5: Jizi Command, Drawer, Chat, and Session Rail

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/components/JiziCommandCenter.tsx`
- Modify: `app/src/components/MasterAgentDrawer.tsx`
- Modify: `app/src/components/MasterAgentDrawer.test.tsx`
- Modify: `app/src/components/MasterAgentPanel/Composer.tsx`
- Modify: `app/src/components/MasterAgentPanel/MessageList.tsx`
- Modify: `app/src/components/MasterAgentPanel/AssistantMarkdown.tsx`
- Modify: `app/src/components/MasterSessionRail.tsx`

**Interfaces:**
- Produces: one Pearl Jizi surface hierarchy and smooth half/fullscreen container transitions.
- Preserves: drawer mode source of truth, session selection, message content, composer state, Skill controls, search toggle, and scrolling.

- [ ] **Step 1: Add a failing drawer presentation test**

Extend `MasterAgentDrawer.test.tsx` to assert the existing drawer root receives the stable presentation class for both display modes:

```ts
expect(html).toContain('master-agent-drawer--pearl');
expect(html).toContain('master-agent-drawer--half');
```

Render the fullscreen state and assert `master-agent-drawer--fullscreen` is present without adding a display-mode button to the drawer.

- [ ] **Step 2: Run the drawer test and verify RED**

Run: `cd app; npm.cmd test -- src/components/MasterAgentDrawer.test.tsx src/components/MasterAgentPanel/Composer.test.tsx`

Expected: FAIL because the Pearl presentation class is absent.

- [ ] **Step 3: Add presentation-only hooks**

Add `master-agent-drawer--pearl` to the drawer root while retaining existing half/fullscreen classes. Add only the following hooks where existing markup lacks a stable selector:

```tsx
className="jizi-message jizi-message--assistant"
className="jizi-message jizi-message--user"
className="jizi-composer__surface"
className="master-session-rail__item"
```

Do not move the fullscreen setting back into the drawer.

- [ ] **Step 4: Apply Jizi Pearl surfaces and transitions**

Update existing rules and use:

```css
.jizi-command-center {
  min-height: 42px;
  margin: 0 12px;
  padding: 6px 12px;
  border: 1px solid var(--pearl-border);
  border-top: 0;
  border-radius: 0 0 16px 16px;
  background: var(--pearl-glass);
  backdrop-filter: blur(var(--glass-blur));
}

.master-agent-drawer--pearl {
  border-left: 1px solid var(--pearl-border);
  background: var(--pearl-glass);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(var(--glass-blur)) saturate(112%);
  transition:
    width var(--motion-page) var(--motion-ease-out),
    inset var(--motion-page) var(--motion-ease-out),
    border-radius var(--motion-page) var(--motion-ease-out);
}

.jizi-composer__surface {
  border: 1px solid var(--pearl-border-strong);
  border-radius: 18px;
  background: rgba(251, 252, 251, 0.9);
  box-shadow: var(--shadow-soft);
}
```

Use flat message groups, light code-block surfaces, `16px` message radius, and tokenized status colors. Do not wrap tool calls, markdown, and suggestions in nested glass cards.

- [ ] **Step 5: Run Jizi tests and build**

Run: `cd app; npm.cmd test -- src/components/MasterAgentDrawer.test.tsx src/components/MasterAgentPanel/Composer.test.tsx src/components/MasterAgentPanel/AssistantMarkdown.test.tsx; npm.cmd run build`

Expected: tests pass and build exits 0.

- [ ] **Step 6: Commit the Jizi update**

```bash
git add app/src/App.css app/src/components/JiziCommandCenter.tsx app/src/components/MasterAgentDrawer.tsx app/src/components/MasterAgentDrawer.test.tsx app/src/components/MasterAgentPanel app/src/components/MasterSessionRail.tsx
git commit -m "style: unify pearl jizi experience"
```

### Task 6: Secondary Dialogs and Command Palette

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/components/AgentConfigModal.tsx`
- Modify: `app/src/components/MasterConfigModal.tsx`
- Modify: `app/src/components/ModelConfigModal.tsx`
- Modify: `app/src/components/SearchConfigModal.tsx`
- Modify: `app/src/components/ToolConfigModal.tsx`
- Modify: `app/src/components/CommandPalette.tsx`
- Modify: `app/src/components/ToolConfigModal.test.tsx`

**Interfaces:**
- Produces: shared `.pearl-dialog`, `.pearl-dialog-copy`, and `.pearl-command-palette` presentation hooks.
- Preserves: modal open/close state, saving, testing, provider/tool operations, keyboard commands, and settings-embedded panel exports.

- [ ] **Step 1: Add a failing modal-shell test**

Extend `ToolConfigModal.test.tsx` so the compatibility modal root must include the shared class:

```ts
expect(html).toContain('pearl-dialog');
expect(html).toContain('tool-config-modal');
```

- [ ] **Step 2: Run the focused modal test and verify RED**

Run: `cd app; npm.cmd test -- src/components/ToolConfigModal.test.tsx`

Expected: FAIL because the shared dialog class is absent.

- [ ] **Step 3: Apply shared dialog hooks and remove inline colors**

Add `pearl-dialog` alongside every existing modal `className`. Replace scoped inline helper colors with `pearl-dialog-copy`, `pearl-dialog-copy--muted`, and status classes. Keep the gold favorite star in `ModelConfigModal.tsx` as `var(--pearl-warning)` through a CSS class instead of an inline hex value.

Add `pearl-command-palette` to the command palette root without changing its keyboard behavior.

- [ ] **Step 4: Implement the common glass dialog system**

```css
.pearl-dialog .ant-modal-mask {
  background: rgba(48, 55, 52, 0.16);
  backdrop-filter: blur(8px);
}

.pearl-dialog .ant-modal-content {
  overflow: hidden;
  border: 1px solid var(--pearl-border);
  border-radius: var(--radius-dialog);
  background: rgba(251, 252, 251, 0.9);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(calc(var(--glass-blur) + 6px)) saturate(115%);
}

.pearl-dialog .ant-modal-header,
.pearl-dialog .ant-modal-footer {
  background: transparent;
}

.pearl-dialog .ant-modal-footer {
  border-top: 1px solid var(--pearl-border);
}

.pearl-command-palette {
  border: 1px solid var(--pearl-border);
  border-radius: var(--radius-dialog);
  background: var(--pearl-glass);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(calc(var(--glass-blur) + 4px));
}
```

Ensure Ant Design modal motion uses the global page duration and reduced-motion fallback. Preserve existing special wide-body layouts for model and tool configuration.

- [ ] **Step 5: Run modal tests, lint, and build**

Run: `cd app; npm.cmd test -- src/components/ToolConfigModal.test.tsx src/components/TitleBar.test.tsx src/components/MasterAgentDrawer.test.tsx; npm.cmd run lint; npm.cmd run build`

Expected: tests pass, lint exits 0, and build exits 0.

- [ ] **Step 6: Commit the dialog update**

```bash
git add app/src/App.css app/src/components/AgentConfigModal.tsx app/src/components/MasterConfigModal.tsx app/src/components/ModelConfigModal.tsx app/src/components/SearchConfigModal.tsx app/src/components/ToolConfigModal.tsx app/src/components/ToolConfigModal.test.tsx app/src/components/CommandPalette.tsx
git commit -m "style: standardize pearl dialogs"
```

### Task 7: Responsive Constraints and Full Visual Verification

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/components/SettingsCenter/SettingsStyles.test.ts`

**Interfaces:**
- Produces: final `1024 x 640`, standard desktop, and wide desktop behavior.
- Preserves: all prior component interfaces.

- [ ] **Step 1: Add failing responsive contracts**

Add to `SettingsStyles.test.ts`:

```ts
it('defines the supported compact desktop layout without shrinking text', () => {
  expect(styles).toMatch(/@media \(max-width: 1199px\)/);
  expect(styles).toContain('grid-template-columns: 196px minmax(0, 1fr);');
  expect(styles).toContain('--compact-workspace-gap: 8px;');
});
```

- [ ] **Step 2: Run the style test and verify RED**

Run: `cd app; npm.cmd test -- src/components/SettingsCenter/SettingsStyles.test.ts`

Expected: FAIL because the final compact layout contract is missing.

- [ ] **Step 3: Implement compact desktop rules**

Add a root compact gap and explicit breakpoints:

```css
:root { --compact-workspace-gap: 8px; }

@media (max-width: 1199px) {
  .app-body { gap: var(--compact-workspace-gap); padding: 8px; }
  .settings-center { grid-template-columns: 196px minmax(0, 1fr); padding: 8px; }
  .settings-nav__item-copy span { display: none; }
  .title-bar { gap: 8px; padding-inline: 12px; }
  .title-bar__name { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}

@media (max-height: 700px) {
  .settings-content__header { padding-block: 16px 12px; }
  .settings-content__body { padding-block: 18px 28px; }
  .ant-modal { padding-bottom: 12px; }
}
```

Do not add mobile navigation or reduce essential font sizes.

- [ ] **Step 4: Run the complete automated verification**

Run: `cd app; npm.cmd test; npm.cmd run lint; npm.cmd run build`

Expected: all tests pass, lint exits 0, and build exits 0.

- [ ] **Step 5: Start or reuse the development server**

Run: `cd app; npm.cmd run dev -- --host 127.0.0.1 --port 5174`

Expected: Vite reports `http://127.0.0.1:5174/`. If `5174` is occupied by the existing valid server, reuse it.

- [ ] **Step 6: Perform browser visual checks**

At `1024 x 640`, `1440 x 900`, and `1920 x 1080`, inspect and capture:

- Workspace with left sidebar, canvas, properties panel, and canvas toolbar visible.
- Settings center on models, Jizi, and system/data sections.
- Report center.
- Jizi half mode and fullscreen mode.
- Agent, model, search, tool, and title-bar confirmation dialogs.
- Opening and closing transitions between workspace, settings, reports, and dialogs.

Expected: no overlap, clipping, unreadable glass text, nested-card appearance, legacy saturated blue dominance, or abrupt full/half-screen jump.

- [ ] **Step 7: Confirm the file boundary**

Run: `git diff --name-only 4047601..HEAD`

Expected: only files named in Tasks 1-7 plus this plan and its approved design specification.

- [ ] **Step 8: Commit final responsive adjustments**

```bash
git add app/src/App.css app/src/components/SettingsCenter/SettingsStyles.test.ts
git commit -m "style: finish pearl responsive polish"
```
