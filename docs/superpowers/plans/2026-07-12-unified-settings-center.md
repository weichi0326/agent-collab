# Unified Settings Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered model, search, Jizi, and tool configuration entry points with one five-section settings center that overlays a still-mounted workspace and adds a safe system/data status page.

**Architecture:** Keep `uiStore` as the transient view source of truth, add a pure settings catalog for navigation/search, and render `SettingsCenter` as an opaque layer above a permanently mounted workspace. Existing Modal components become thin compatibility shells around reusable settings panels, while a Rust `system_snapshot` command supplies whitelisted paths, directory sizes, versions, and environment checks to the final page.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Ant Design 6, Vitest 4, Tauri 2/Rust 2021.

## Global Constraints

- The settings center contains exactly five pages: model services, web search, Jizi configuration, tool library, and system/data.
- Skill management, canvas/Agent/run/report operations, destructive bulk deletion, themes, shortcuts, accounts, and mobile layouts remain out of scope.
- `MasterAgentPanel`, canvas state, request controllers, composer draft, attachments, scroll position, and web-search toggle must survive opening and closing settings.
- Model and Jizi drafts require explicit confirmation before switching section or returning to the workspace.
- Search settings continue to mutate `useSearchStore` immediately.
- Tool polling and metadata synchronization run only while the tool page is active.
- Minimum supported viewport remains `1024 x 640`.
- Do not add a clear-all-data action or expose arbitrary filesystem deletion.

---

### Task 1: Settings State, Catalog, and Navigation Decisions

**Files:**
- Create: `app/src/settings/settingsCatalog.ts`
- Create: `app/src/settings/settingsCatalog.test.ts`
- Create: `app/src/settings/settingsNavigation.ts`
- Create: `app/src/settings/settingsNavigation.test.ts`
- Modify: `app/src/stores/uiStore.ts`
- Modify: `app/src/stores/uiStore.test.ts`

**Interfaces:**
- Produces: `SettingsSection`, `SETTINGS_CATALOG`, `filterSettingsCatalog(query)`, `requiresSettingsLeaveConfirmation(dirty)`, `AppView = 'workspace' | 'reports' | 'settings'`, `settingsSection`, `settingsDirty`, and their setters.
- Persistence: `view`, `settingsSection`, and `settingsDirty` remain excluded from `partializeUiState`.

- [ ] **Step 1: Write the failing catalog and store tests**

```ts
it('finds settings by title, description, and predefined keywords without exposing Skill', () => {
  expect(filterSettingsCatalog('API Key').map((item) => item.id)).toEqual([
    'models',
    'search',
  ]);
  expect(filterSettingsCatalog('人格').map((item) => item.id)).toEqual(['jizi']);
  expect(filterSettingsCatalog('Skill')).toEqual([]);
});

it('keeps settings navigation transient', () => {
  const persisted = partializeUiState({
    ...useUiStore.getState(),
    view: 'settings',
    settingsSection: 'tools',
    settingsDirty: true,
  });
  expect(persisted).not.toHaveProperty('view');
  expect(persisted).not.toHaveProperty('settingsSection');
  expect(persisted).not.toHaveProperty('settingsDirty');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd app; npm.cmd test -- src/settings/settingsCatalog.test.ts src/settings/settingsNavigation.test.ts src/stores/uiStore.test.ts`

Expected: FAIL because the settings modules and state fields do not exist.

- [ ] **Step 3: Implement the pure catalog and transient state**

```ts
export type SettingsSection = 'models' | 'search' | 'jizi' | 'tools' | 'system';

export interface SettingsCatalogItem {
  id: SettingsSection;
  group: 'AI 能力' | '姬子' | '扩展' | '系统';
  title: string;
  description: string;
  keywords: readonly string[];
}

export function filterSettingsCatalog(query: string): SettingsCatalogItem[] {
  const keyword = query.trim().toLocaleLowerCase('zh-CN');
  if (!keyword) return SETTINGS_CATALOG;
  return SETTINGS_CATALOG.filter((item) =>
    [item.title, item.description, ...item.keywords]
      .join('\n')
      .toLocaleLowerCase('zh-CN')
      .includes(keyword),
  );
}

export function requiresSettingsLeaveConfirmation(dirty: boolean): boolean {
  return dirty;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cd app; npm.cmd test -- src/settings/settingsCatalog.test.ts src/settings/settingsNavigation.test.ts src/stores/uiStore.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/settings app/src/stores/uiStore.ts app/src/stores/uiStore.test.ts
git commit -m "feat(settings): add navigation state and catalog"
```

### Task 2: Persistent Workspace Layer and Settings Shell

**Files:**
- Create: `app/src/components/SettingsCenter/SettingsCenter.tsx`
- Create: `app/src/components/SettingsCenter/SettingsCenter.test.tsx`
- Create: `app/src/components/SettingsCenter/SettingsPanelErrorBoundary.tsx`
- Create: `app/src/settings/appView.ts`
- Create: `app/src/settings/appView.test.ts`
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/TitleBar.tsx`
- Modify: `app/src/App.css`

**Interfaces:**
- Consumes: `SettingsSection`, `filterSettingsCatalog`, `view`, `settingsSection`, `settingsDirty`.
- Produces: `SettingsCenter`, an opaque overlay with grouped navigation/search, and `workspaceLayerState(view)` for mount/inert decisions.

- [ ] **Step 1: Write failing view and shell tests**

```ts
it('keeps the workspace mounted but inert under settings', () => {
  expect(workspaceLayerState('settings')).toEqual({ mounted: true, inert: true });
  expect(workspaceLayerState('workspace')).toEqual({ mounted: true, inert: false });
  expect(workspaceLayerState('reports')).toEqual({ mounted: false, inert: false });
});

it('renders all five settings destinations and no Skill destination', () => {
  const html = renderToStaticMarkup(<SettingsCenterContent query="" section="models" />);
  expect(html).toContain('模型服务');
  expect(html).toContain('联网搜索');
  expect(html).toContain('姬子配置');
  expect(html).toContain('工具库');
  expect(html).toContain('系统与数据');
  expect(html).not.toContain('Skill 管理');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd app; npm.cmd test -- src/settings/appView.test.ts src/components/SettingsCenter/SettingsCenter.test.tsx`

Expected: FAIL because the shell and view helper do not exist.

- [ ] **Step 3: Implement the overlay and title-bar entry**

```tsx
const workspaceState = workspaceLayerState(view);

{workspaceState.mounted && (
  <div
    className={`workspace-layer${workspaceState.inert ? ' workspace-layer--inactive' : ''}`}
    inert={workspaceState.inert}
    aria-hidden={workspaceState.inert}
  >
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
  </div>
)}
{view === 'settings' && <SettingsCenter />}
```

Replace the title-bar Dropdown with a direct `setView('settings')` button. In settings mode render one `ArrowLeftOutlined` button that confirms when `settingsDirty` is true, clears the dirty flag on discard, and returns to `workspace`.

- [ ] **Step 4: Add panel-level error containment**

`SettingsPanelErrorBoundary` renders an Ant Design `Result` in the right content area and offers a retry button by remounting the active panel. It must not replace the navigation shell.

- [ ] **Step 5: Run focused tests and build**

Run: `cd app; npm.cmd test -- src/settings/appView.test.ts src/components/SettingsCenter/SettingsCenter.test.tsx src/stores/uiStore.test.ts; npm.cmd run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/src/App.tsx app/src/App.css app/src/components/TitleBar.tsx app/src/components/SettingsCenter app/src/settings/appView.ts app/src/settings/appView.test.ts
git commit -m "feat(settings): add persistent settings shell"
```

### Task 3: Search and Model Settings Panels

**Files:**
- Modify: `app/src/components/SearchConfigModal.tsx`
- Modify: `app/src/components/ModelConfigModal.tsx`
- Create: `app/src/settings/modelDraft.ts`
- Create: `app/src/settings/modelDraft.test.ts`
- Modify: `app/src/components/SettingsCenter/SettingsCenter.tsx`
- Modify: `app/src/App.css`

**Interfaces:**
- Produces: named exports `SearchSettingsPanel` and `ModelSettingsPanel`.
- `ModelSettingsPanel` accepts `onDirtyChange(dirty: boolean)` and reports changes relative to the selected/created provider baseline.
- Default Modal exports remain thin compatibility shells until all old callers are removed.

- [ ] **Step 1: Write the failing model draft tests**

```ts
it('does not mark a freshly selected provider dirty', () => {
  expect(isModelDraftDirty(providerDraft(config), providerDraft(config))).toBe(false);
});

it('marks name, BaseURL, or API key edits dirty', () => {
  const baseline = providerDraft(config);
  expect(isModelDraftDirty({ ...baseline, apiKey: 'changed' }, baseline)).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd app; npm.cmd test -- src/settings/modelDraft.test.ts`

Expected: FAIL because `modelDraft.ts` does not exist.

- [ ] **Step 3: Extract the search panel**

Move the current Modal body into `SearchSettingsPanel`. Keep direct `useSearchStore` writes and key-test state. The default `SearchConfigModal` becomes only `<Modal><SearchSettingsPanel /></Modal>`.

- [ ] **Step 4: Extract the model panel and dirty baseline**

```ts
export interface ModelProviderDraft {
  name: string;
  baseURL: string;
  apiKey: string;
}

export function isModelDraftDirty(
  draft: ModelProviderDraft,
  baseline: ModelProviderDraft,
): boolean {
  return draft.name !== baseline.name ||
    draft.baseURL !== baseline.baseURL ||
    draft.apiKey !== baseline.apiKey;
}
```

Set the baseline in `startAdd`, `selectConfig`, and after a successful save. Report dirty state with an effect. The settings-center section change uses Ant Design confirmation with buttons `放弃修改` and `继续编辑`.

- [ ] **Step 5: Run focused tests and build**

Run: `cd app; npm.cmd test -- src/settings/modelDraft.test.ts src/settings/settingsNavigation.test.ts; npm.cmd run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ModelConfigModal.tsx app/src/components/SearchConfigModal.tsx app/src/components/SettingsCenter app/src/settings/modelDraft.ts app/src/settings/modelDraft.test.ts app/src/App.css
git commit -m "feat(settings): embed model and search panels"
```

### Task 4: Jizi and Tool Settings Panels

**Files:**
- Modify: `app/src/components/MasterConfigModal.tsx`
- Modify: `app/src/components/ToolConfigModal.tsx`
- Modify: `app/src/components/MasterAgentDrawer.tsx`
- Modify: `app/src/components/MasterSessionRail.tsx`
- Modify: `app/src/components/MasterAgentDrawer.test.tsx`
- Create: `app/src/settings/jiziDraft.ts`
- Create: `app/src/settings/jiziDraft.test.ts`
- Create: `app/src/settings/toolPolling.ts`
- Create: `app/src/settings/toolPolling.test.ts`
- Modify: `app/src/components/SettingsCenter/SettingsCenter.tsx`
- Modify: `app/src/App.css`

**Interfaces:**
- Produces: named exports `JiziSettingsPanel` and `ToolSettingsPanel`.
- `JiziSettingsPanel` accepts `onDirtyChange(dirty: boolean)`; only persona draft/source changes count as dirty.
- `JiziSettingsPanel` reads and updates persisted `drawerFullscreen`; display-mode changes do not affect dirty state.
- `ToolSettingsPanel` accepts `active: boolean`; status polling and `syncFromService()` are active only while true.

- [ ] **Step 1: Write failing Jizi dirty and polling tests**

```ts
it('treats imported persona text or source changes as dirty', () => {
  expect(isJiziDraftDirty({ text: 'new', sourceName: 'a.md' }, { text: 'old', sourceName: null })).toBe(true);
});

it('stops polling when the disposer runs', () => {
  vi.useFakeTimers();
  const check = vi.fn();
  const dispose = startToolStatusPolling(check, 3000);
  vi.advanceTimersByTime(6000);
  dispose();
  vi.advanceTimersByTime(6000);
  expect(check).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd app; npm.cmd test -- src/settings/jiziDraft.test.ts src/settings/toolPolling.test.ts src/components/MasterAgentDrawer.test.tsx`

Expected: FAIL because the helpers do not exist and the gear entry is still rendered.

- [ ] **Step 3: Extract Jizi content and remove the gear entry**

Move persona import/reset/save, diagnosis switch, and memory manager into `JiziSettingsPanel`. Save without closing the settings center. Remove `configOpen`, `MasterConfigModal`, `onOpenConfig`, and `SettingOutlined` from the drawer/session rail while preserving Skill, model selection, health check, and web-search controls.

Move the existing half/fullscreen `Switch` into `JiziSettingsPanel` as a “显示模式” settings row. Continue reading and writing `drawerFullscreen` through `useUiStore`, apply changes immediately, and remove the duplicate switch from the drawer control bar.

- [ ] **Step 4: Extract the tool panel with active lifecycle**

```ts
export function startToolStatusPolling(
  check: () => void | Promise<void>,
  intervalMs: number,
): () => void {
  void check();
  const timer = window.setInterval(() => void check(), intervalMs);
  return () => window.clearInterval(timer);
}
```

The panel effect returns immediately when `active` is false. When active, start polling and sync metadata once; cleanup cancels the interval and prevents post-unmount state writes.

- [ ] **Step 5: Run focused tests and build**

Run: `cd app; npm.cmd test -- src/settings/jiziDraft.test.ts src/settings/toolPolling.test.ts src/components/MasterAgentDrawer.test.tsx; npm.cmd run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/MasterConfigModal.tsx app/src/components/ToolConfigModal.tsx app/src/components/MasterAgentDrawer.tsx app/src/components/MasterSessionRail.tsx app/src/components/MasterAgentDrawer.test.tsx app/src/components/SettingsCenter app/src/settings/jiziDraft.ts app/src/settings/jiziDraft.test.ts app/src/settings/toolPolling.ts app/src/settings/toolPolling.test.ts app/src/App.css
git commit -m "feat(settings): migrate jizi and tool configuration"
```

### Task 5: System and Data Snapshot

**Files:**
- Modify: `app/src-tauri/src/storage.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Create: `app/src/lib/systemInfo.ts`
- Create: `app/src/lib/systemInfo.test.ts`
- Create: `app/src/components/SettingsCenter/SystemDataSettingsPanel.tsx`
- Modify: `app/src/components/SettingsCenter/SettingsCenter.tsx`
- Modify: `app/src/App.css`

**Interfaces:**
- Rust produces `system_snapshot() -> SystemSnapshot` with application version, backend version, OS/arch, whitelisted data/output/log paths, byte usage, and environment checks.
- Frontend produces `getSystemSnapshot()`, `openSystemPath(path)`, and `formatByteSize(bytes)`.
- The page also consumes `getHealth`, `getServiceStatus`, `EXPECTED_PYTHON_SERVICE_VERSION`, and `restartPythonService`.

- [ ] **Step 1: Write failing formatter and Rust helper tests**

```ts
it('formats byte counts for the storage overview', () => {
  expect(formatByteSize(0)).toBe('0 B');
  expect(formatByteSize(1536)).toBe('1.5 KB');
  expect(formatByteSize(5 * 1024 * 1024)).toBe('5 MB');
});
```

```rust
#[test]
fn directory_size_counts_nested_files() {
    let root = temp_test_dir("system-snapshot-size");
    fs::create_dir_all(root.join("nested")).unwrap();
    fs::write(root.join("a.bin"), [0_u8; 3]).unwrap();
    fs::write(root.join("nested").join("b.bin"), [0_u8; 5]).unwrap();
    assert_eq!(directory_size(&root), 8);
    fs::remove_dir_all(root).unwrap();
}
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd app; npm.cmd test -- src/lib/systemInfo.test.ts; cargo test --manifest-path src-tauri/Cargo.toml directory_size_counts_nested_files`

Expected: FAIL because the frontend module and Rust helper do not exist.

- [ ] **Step 3: Implement the whitelisted snapshot command**

```rust
#[derive(Serialize)]
pub struct SystemSnapshot {
    app_version: String,
    backend_version: String,
    os: String,
    arch: String,
    data_dir: String,
    output_dir: String,
    log_dir: String,
    data_bytes: u64,
    output_bytes: u64,
    log_bytes: u64,
    checks: Vec<SystemCheck>,
}
```

Checks cover Python interpreter presence, `python/app.py`, data/output/log directory readiness, environment configurator presence, and launch preflight script presence. Register only `storage::system_snapshot`; continue using the existing `open_path` command for the exact returned directories.

- [ ] **Step 4: Implement the system page**

Show service state and restart action, expected/current Python service versions, app/backend/platform details, three path rows with open buttons, three byte totals, environment check results, and repair guidance. Do not render any delete/clear button.

- [ ] **Step 5: Run focused frontend and Rust verification**

Run: `cd app; npm.cmd test -- src/lib/systemInfo.test.ts; npm.cmd run build; cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS and both builds/tests exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/storage.rs app/src-tauri/src/lib.rs app/src/lib/systemInfo.ts app/src/lib/systemInfo.test.ts app/src/components/SettingsCenter app/src/App.css
git commit -m "feat(settings): add system and data status"
```

### Task 6: Full Regression and Visual Acceptance

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Validates all nine acceptance requirements from the approved design.

- [ ] **Step 1: Run the complete frontend gate**

Run: `cd app; npm.cmd test; npm.cmd run lint; npm.cmd run build`

Expected: all tests pass, lint reports zero errors, production build exits 0.

- [ ] **Step 2: Run the complete Rust gate**

Run: `cd app/src-tauri; cargo test; cargo clippy -- -D warnings`

Expected: all tests pass and clippy reports zero warnings.

- [ ] **Step 3: Exercise the browser-preview workflow**

Start: `cd app; npm.cmd run dev -- --host 127.0.0.1`

Verify at `1024 x 640`, `1440 x 900`, and `1920 x 1080`:

- Settings opens directly from the title bar and shows all five sections.
- Search filters destinations and never exposes Skill.
- The workspace remains mounted and cannot receive pointer or keyboard focus under the overlay.
- Returning preserves the Jizi draft, attachments, web-search toggle, and active canvas.
- Model/Jizi dirty drafts prompt on section change and return.
- Tool polling starts only on the tool page and stops after leaving.
- System page contains no clear-all-data action.
- Navigation, dual-pane panels, independent scrolling, and title bar do not overlap.

- [ ] **Step 4: Inspect the final diff and requirement coverage**

Run: `git diff --check; git status --short; git diff --stat`

Expected: no whitespace errors; only settings-center implementation, tests, plan, and directly required Rust command files changed.

- [ ] **Step 5: Commit verification fixes**

```bash
git add app docs/superpowers/plans/2026-07-12-unified-settings-center.md
git commit -m "test(settings): verify unified settings center"
```
