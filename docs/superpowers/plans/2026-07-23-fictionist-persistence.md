# 小说作品与章节持久化实施计划

> 状态：已完成（2026-07-23）。任务 1-6 均已实现、验证、提交并推送到 `origin/fictionist`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将小说家现有假数据界面接入真实本地存储，使用户可以新建作品和章节、编辑保存正文，并在应用重启后恢复，同时保证保存失败和未保存离开不会静默丢稿。

**架构：** 复用 master 已有的 Tauri/localStorage 存储门面。小说索引使用一个带版本的轻量 JSON，章节正文按章节 ID 分开保存；跨正文和索引的写入使用恢复记录。React 组件只消费小说领域 store，不直接操作存储。

**技术栈：** React 19、TypeScript 6、Zustand 5、Vitest 4、Tauri 2、Rust。

## 全局约束

- 不改变小说家现有布局、颜色、密度、导航结构和主要文案。
- 不实现续写画布、结果回传、设定库或时间线持久化。
- 存储键仅使用 `multi-agent-fictionist-*` ASCII 命名空间。
- 每章正文单独保存，单章 UTF-8 正文上限为 8 MiB。
- 只有存储操作成功后才显示成功并更新“已保存”状态。
- 离开章节、作品或小说家工作区前先保存；失败时阻止离开。
- `.superpowers/` 保持未跟踪且不提交。

---

### 任务 1：小说领域模型和可恢复仓储

**文件：**
- 新建：`app/src/features/fictionist/domain.ts`
- 新建：`app/src/features/fictionist/fixtures.ts`
- 新建：`app/src/features/fictionist/repository.ts`
- 新建：`app/src/features/fictionist/repository.test.ts`
- 修改：`app/src/lib/tauriStorage.ts`

**接口：**
- 产出 `FictionistIndex`、`FictionProject`、`FictionVolume`、`FictionChapter`。
- 产出 `FictionistRepository`，提供 `loadOrInitialize`、`createProject`、`createChapter`、`saveChapter`、`readChapter`、`saveSelection`。
- 产出 `chapterStorageKey(chapterId)`、`countWords(content)` 和 `isSafeFictionistId(id)`。

- [x] 先编写失败测试，覆盖安全 ID、正文键生成、字数、首次初始化、创建作品、创建章节、章节保存、8 MiB 限制和恢复记录重放。
- [x] 运行 `npm.cmd test -- src/features/fictionist/repository.test.ts`，确认因模块不存在或接口缺失而失败。
- [x] 在 `tauriStorage.ts` 暴露原始的 `getProjectStorageItem`、`setProjectStorageItem` 和 `removeProjectStorageItem`，原有 Zustand 适配器改为复用它们。
- [x] 实现版本 1 索引和演示数据种子。卷中的 `chapterIds` 是唯一章序来源，正文键不写入实体。
- [x] 实现恢复事务：先写 `multi-agent-fictionist-recovery`，再写正文、索引，最后删除恢复记录；加载时先重放未完成事务。
- [x] 重新运行聚焦测试，确认全部通过。
- [x] 提交：`功能：增加小说作品与章节仓储`

### 任务 2：小说领域状态和重启恢复

**文件：**
- 新建：`app/src/features/fictionist/fictionistStore.ts`
- 新建：`app/src/features/fictionist/fictionistStore.test.ts`
- 修改：`app/src/App.tsx`

**接口：**
- 产出 `useFictionistStore`。
- 状态包含索引、当前作品、当前章节、编辑正文、已保存正文、加载状态和保存状态。
- 操作包含 `hydrate`、`createProject`、`openProject`、`createChapter`、`selectChapter`、`updateChapterContent`、`saveCurrentChapter`、`discardCurrentChanges`。

- [x] 先编写失败测试，覆盖首次恢复、重启恢复选择、编辑变脏、保存成功、保存失败保持变脏、切章前自动保存和无章节作品。
- [x] 运行 `npm.cmd test -- src/features/fictionist/fictionistStore.test.ts`，确认测试因 store 缺失而失败。
- [x] 使用可注入仓储的 Zustand state creator 实现最小状态机；测试使用内存仓储，不模拟 store 自身。
- [x] 在 `App.tsx` 启动阶段调用 `hydrate()`；小说数据加载失败不能阻止 master 工作台启动，但小说家页必须显示可重试错误。
- [x] 重新运行聚焦测试，确认全部通过。
- [x] 提交：`功能：增加小说编辑状态与重启恢复`

### 任务 3：接入现有小说家界面

**文件：**
- 修改：`app/src/components/FictionistWorkspace/FictionistWorkspace.tsx`
- 修改：`app/src/components/FictionistWorkspace/FictionistWorkspace.css`
- 修改：`app/src/components/FictionistWorkspace/FictionistWorkspace.test.tsx`

**接口：**
- UI 从 `useFictionistStore` 读取作品、章节、正文、加载和保存状态。
- 新建作品、新建章节、编辑和保存按钮调用领域操作。

- [x] 先扩展表征测试，要求页面不再出现“界面演示”和“关闭软件后不会保留”，并出现真实本地保存文案、加载失败重试文案和无章节空状态。
- [x] 运行聚焦测试，确认新断言失败。
- [x] 将书架统计改为从索引派生；新建作品成功后保留在书架；打开无章节作品时显示空状态和“新建章节”。
- [x] 将编辑器正文和保存按钮接入 store；保存中禁用重复提交，失败显示错误并保持“有未保存修改”。
- [x] 保留设定库、时间线、工作流和续写按钮为下一阶段演示，不更改其布局。
- [x] 重新运行组件与领域测试，确认通过。
- [x] 提交：`功能：接入真实小说作品与章节`

### 任务 4：统一未保存导航保护

**文件：**
- 新建：`app/src/settings/appNavigation.ts`
- 新建：`app/src/settings/appNavigation.test.ts`
- 修改：`app/src/App.tsx`
- 修改：`app/src/components/TitleBar.tsx`
- 修改：`app/src/components/Onboarding/OnboardingController.tsx`
- 修改：其他直接调用 `useUiStore.getState().setView` 的导航入口。
- 修改：`app/src/components/FictionistWorkspace/FictionistWorkspace.tsx`

**接口：**
- 产出 `registerAppViewGuard(guard)` 和 `requestAppView(nextView)`。
- 小说家注册离开守卫：有修改时保存，保存失败返回 `false`。

- [x] 先编写失败测试，覆盖无守卫导航、守卫允许、守卫拒绝、守卫异常和注销守卫。
- [x] 运行 `npm.cmd test -- src/settings/appNavigation.test.ts`，确认因模块缺失而失败。
- [x] 实现单一当前守卫和异步导航门面，异常默认拒绝离开。
- [x] 将所有用户可达的一级页面跳转改为经过 `requestAppView`。
- [x] 小说家内部切换章节、作品、分区和返回书架同样先调用保存；保存失败保留原页面。
- [x] 浏览器或 WebView 关闭时若仍有未保存正文，注册 `beforeunload` 防止静默退出。
- [x] 运行导航、标题栏、引导和小说家相关测试，确认通过。
- [x] 提交：`功能：保护小说未保存内容`

### 任务 5：动态数据扫描、清理和交接

**文件：**
- 修改：`app/src-tauri/src/storage.rs`
- 修改：`app/src/lib/systemInfo.ts`
- 修改：`app/src/lib/systemInfo.test.ts`
- 修改：`app/src/lib/tauriStorage.ts`
- 修改：`小说家与工作台集成规划.md`

**接口：**
- 系统清理新增 `fictionist` 分类。
- Rust 端只扫描和删除文件名以 `multi-agent-fictionist-` 开头的 `.json`、`.bak` 和临时残留。

- [x] 先在 Rust 测试中创建小说索引、章节、备份和临时文件，要求扫描能统计、清理能删除且不影响其他 `multi-agent-*` 数据。
- [x] 运行 `cargo test storage::tests::cleanable_scan_includes_fictionist_data`，确认测试失败。
- [x] 实现受控前缀扫描和删除，并把 `fictionist` 加入前端清理类型及测试。
- [x] 确保 ErrorBoundary 的全项目数据重置也能清理小说动态键；桌面端通过受控前缀命令处理，浏览器端继续按 `multi-agent-` 清理。
- [x] 更新《小说家与工作台集成规划》交接区：总体阶段、已完成、本轮改动、验证结果、已知限制、下一步。
- [x] 运行 `cargo test` 和前端相关测试，确认通过。
- [x] 提交：`功能：纳入小说数据清理与交接`

### 任务 6：最终验收

**文件：**
- 仅验证，不新增范围。

- [x] 运行 `npm.cmd test`，全部 78 个测试文件、422 条 Vitest 用例通过。
- [x] 运行 `npm.cmd run lint`，退出码 0。
- [x] 运行 `npm.cmd run build`，生产构建成功；保留现有大包警告。
- [x] 在 `app/src-tauri` 运行 `cargo test`，全部 32 条 Rust 测试通过。
- [x] 运行 `cargo clippy -- -D warnings`，退出码 0。
- [x] 运行 `git diff --check` 和 `git status --short`，确认仅保留原有未跟踪 `.superpowers/`。
- [x] 检查《小说家与工作台集成规划》的交接状态与实际提交、测试结果一致。
