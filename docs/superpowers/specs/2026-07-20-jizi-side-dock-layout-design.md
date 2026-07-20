# 姬子侧边栏布局模式（可切换顶部抽屉 / 右侧常驻栏）

> 日期：2026-07-20
> 状态：待确认
> 关联：MasterAgentDrawer / MasterSessionRail / MasterAgentPanel / PropertiesPanel / uiStore / SettingsCenter

## 一、背景与问题

用户反馈：姬子当前的**唤出与布局方式与画布功能太过割裂**，不如 Cursor 方便。

现状（已核实）：
- 姬子是**顶部下拉抽屉**（`MasterAgentDrawer`）。pill 徽章触发，展开为 50vh 全宽（下推画布）或全屏（盖住一切）。抽屉内 `MasterSessionRail(208px) + MasterAgentPanel` 横排。收起超过 5 分钟卸载内容。
- 右侧 `PropertiesPanel`（`.right-panel`）在 `App.tsx:205` **无条件常驻**，宽度 `rightWidth`（默认 340，clamp `RIGHT_MIN=280`~`RIGHT_MAX=560`），可拖拽。

割裂感根因：姬子"从天而降盖住/下推画布"，是覆盖式交互，而非与画布并列共存的常驻侧栏。Cursor 的聊天是右侧竖向 dock，与编辑器同屏共存、可拖拽——这是它"不割裂"的关键。

## 二、目标

给姬子一个 **Cursor 式右侧常驻竖栏**模式，与画布并列共存；同时**保留现有顶部抽屉模式**，用户在设置中心自由切换。

## 三、决策（已与用户确认）

采用「方案 A（右栏共存）」的细化版本：

1. **姬子常驻右侧，属性按需出现**
   - 侧栏模式下姬子占一列，**常驻**（不走顶部 pill 收起那套）。
   - 属性面板改为**仅选中节点时渲染**（`node ? <PropertiesPanel/> : null`），出现时插在姬子**右边**（最右）。
   - 未选中节点：`[左栏 | 画布列 | 姬子]`
   - 选中节点：`[左栏 | 画布列 | 姬子 | 属性]`

2. **会话列表收成顶部下拉**
   - 侧栏窄（~360px）塞不下 208px 会话栏。侧栏模式下 `MasterSessionRail` 收成面板顶部的"会话切换"下拉/按钮，平时只显示当前会话名，点开才展开会话列表。
   - 顶部抽屉模式下会话栏保持现状（208px 横排）。

3. **模式开关放设置中心**
   - uiStore 新增持久化字段 `jiziPlacement: 'top' | 'side'`。
   - 开关放**设置中心 → 姬子配置（`jizi` 分区）**，Segmented「顶部抽屉 / 右侧边栏」。

4. **默认仍是顶部抽屉**
   - `jiziPlacement` 默认 `'top'`，保持现有行为、不惊动现有用户。想要侧栏的人去设置里切。

5. **侧栏可折叠成窄条**
   - 侧栏保留折叠按钮，可收成一条窄条/图标把画布宽度还回来，点图标再展开。类 Cursor。

6. **全屏只属于顶部模式**
   - `drawerFullscreen` 语义只在顶部抽屉模式生效；侧栏模式不提供全屏。

## 四、架构与改动点

### 4.1 状态（uiStore）
- 新增 `jiziPlacement: 'top' | 'side'`（默认 `'top'`）+ `setJiziPlacement`。
- 新增 `jiziWidth: number`（侧栏宽度，默认 ~360，clamp 独立上下限，如 `JIZI_MIN=300`~`JIZI_MAX=560`）+ `setJiziWidth`。
- 新增 `jiziSideCollapsed: boolean`（侧栏折叠态，默认 `false`）+ setter。
- `partializeUiState` 加入 `jiziPlacement`、`jiziWidth`、`jiziSideCollapsed`（都是显示偏好，需持久化）。persist `version` 升级 + migrate 补默认值。
- 现有 `drawerExpanded` / `drawerFullscreen` 语义不变，仅在顶部模式使用。

### 4.2 布局（App.tsx workspace-layer）
- 顶部模式：现状不动（`<MasterAgentDrawer/>` 在 app-body 之上，app-body = `[LeftSidebar | canvas-column | PropertiesPanel]`）。
- 侧栏模式：
  - 不渲染顶部 `MasterAgentDrawer` 的下拉外壳（或其内容），改为在 app-body 内画布列右侧渲染姬子侧栏组件。
  - app-body 结构按 `jiziPlacement==='side'` 分支：`[LeftSidebar | canvas-column | <JiziSideDock/> | (node ? <PropertiesPanel/> : null)]`。
  - `PropertiesPanel` 的"选中才渲染"逻辑：优先在 App 层按 `node` 判断（`useSelectedNodeContext`），避免面板内部再判空。

### 4.3 姬子侧栏组件（新增 JiziSideDock，复用 MasterAgentPanel）
- 结构：顶部「会话切换下拉 + 折叠按钮」+ `MasterAgentPanel`（消息区/输入区完全复用）。
- 会话切换下拉复用 `MasterSessionRail` 的数据与动作（会话列表/切换/新建/诊断会话置顶保护），仅换一套紧凑 UI 呈现。
- 折叠态：只渲染一条窄条（图标 + 未读/状态点），点击展开。
- 常驻 → **不做 5 分钟卸载**（顶部模式的 `UNMOUNT_DELAY_MS` 卸载逻辑仅在顶部模式生效）。代价：侧栏模式下姬子面板一直挂载，会话/消息常驻内存，可接受。
- 宽度可拖拽（复用 `ResizeHandle`，写 `jiziWidth`）。

### 4.4 会话栏抽象（MasterSessionRail）
- 抽出会话数据/动作的公共 hook 或让 `MasterSessionRail` 支持 `variant: 'rail' | 'dropdown'`，顶部模式用 `rail`（208px 横排），侧栏模式用 `dropdown`（紧凑下拉）。诊断会话置顶保护、输入只读等既有行为保持一致。

### 4.5 设置中心（SettingsCenter → jizi 分区）
- jizi 分区实际渲染 `MasterConfigModal.tsx` 导出的 `JiziSettingsPanel`（`SettingsCenter.tsx:168-169`）。在该面板加一节「面板位置」Segmented：顶部抽屉 / 右侧边栏，绑 `jiziPlacement`。
- `settingsCatalog` 的 `jizi` 项 keywords 补「布局」「侧边栏」「位置」便于搜索。

## 五、文件清单

**新增**
- `app/src/components/MasterAgentPanel/JiziSideDock.tsx` — 侧栏外壳（会话下拉 + 折叠 + 复用 MasterAgentPanel + ResizeHandle）
- 对应 CSS（`.jizi-side-dock` 系列，App.css）

**修改**
- `app/src/stores/uiStore.ts` — 加 `jiziPlacement` / `jiziWidth` / `jiziSideCollapsed` + setters + partialize + version/migrate
- `app/src/App.tsx` — workspace-layer 按 `jiziPlacement` 分支；侧栏模式下 app-body 插入 JiziSideDock，PropertiesPanel 改选中才渲染
- `app/src/components/MasterAgentDrawer.tsx` — 顶部模式行为不变；侧栏模式下不渲染（由 App 决定挂哪个）
- `app/src/components/MasterSessionRail.tsx` — 支持 `variant`（rail / dropdown）或抽出公共 hook 供侧栏下拉复用
- `app/src/components/MasterConfigModal.tsx`（`JiziSettingsPanel`）— 加「面板位置」Segmented
- `app/src/settings/settingsCatalog.ts` — jizi keywords 补词
- `app/src/App.css` — 侧栏样式；属性面板由常驻改按需的相关样式微调

## 六、验证方法

- **默认顶部**：全新/迁移后 `jiziPlacement==='top'`，姬子行为与现在完全一致（pill、50vh/全屏、5 分钟卸载）。
- **切侧栏**：设置中心切「右侧边栏」→ 姬子变右侧常驻竖栏，画布与之并列；顶部 pill 不再出现。
- **属性按需**：侧栏模式下未选中节点只有姬子；选中节点后属性栏出现在姬子右边；取消选中后属性栏消失。
- **会话下拉**：侧栏模式下会话切换走顶部下拉，能新建/切换；诊断会话仍置顶保护、输入只读。
- **折叠**：侧栏折叠成窄条，画布变宽；点图标恢复。
- **宽度持久化**：拖姬子侧栏与属性栏宽度，刷新后保持；`jiziPlacement`/折叠态刷新后保持。
- **内存**：侧栏模式下姬子常驻挂载（不 5 分钟卸载）；顶部模式卸载逻辑不受影响。
- **tsc / lint / vitest 全绿**（含 uiStore、masterDrawerDisplay、MasterSessionRail 既有测试不回归）。

## 七、风险点

1. **两种模式共存的挂载/卸载语义分叉**：顶部模式靠 `drawerExpanded` + 5 分钟卸载；侧栏模式常驻。需保证同一时刻只挂一份姬子面板，避免双挂载导致重复 in-flight 请求 / abort 串扰。App 层按 `jiziPlacement` 二选一渲染。
2. **切换模式时 in-flight 请求**：用户在切换瞬间若有 sending 消息，卸载旧壳会 abort。需评估：切换是否也套用"有 sending 时延后卸载"逻辑，或切换时不卸载底层面板（仅换外壳）。倾向让 MasterAgentPanel 实例尽量稳定。
3. **属性栏由常驻改按需**：现有代码/测试是否假设 `.right-panel` 常在？需检查引用（onboarding data-onboarding="properties-panel" 的引导步骤在无选中节点时会指向不存在的元素）。
4. **会话栏两套 UI 的行为一致性**：置顶保护、只读、诊断会话等既有约束在 dropdown 变体里必须等价，靠抽公共 hook 降低分叉。
5. **persist 迁移**：version 升级后 migrate 必须补齐三个新字段默认值，旧数据不炸。
6. **画布横向空间**：侧栏 + 选中时属性栏（~360 + 340）在小屏会挤画布。折叠能力 + 属性按需出现缓解；必要时加窄屏媒体查询（现有 `@media (max-width:1199px)` 已把左栏收窄，可对齐）。

## 八、关键文件

- `app/src/components/MasterAgentPanel/JiziSideDock.tsx`（新建）
- `app/src/stores/uiStore.ts`（jiziPlacement / jiziWidth / jiziSideCollapsed + migrate）
- `app/src/App.tsx`（按模式分支布局 + 属性按需）
- `app/src/components/MasterAgentDrawer.tsx`（顶部模式保持）
- `app/src/components/MasterSessionRail.tsx`（variant / 公共 hook）
- `app/src/components/SettingsCenter/`（姬子配置加位置开关）
- `app/src/settings/settingsCatalog.ts`（keywords）
- `app/src/App.css`（侧栏样式）
