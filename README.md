# Agent 协同工具

在画布上把多个 AI Agent 连成工作流，让它们分工协作、自动跑出结果（文档 / 表格 / 思维导图），并由总管 AI「姬子」用自然语言观察项目、规划和确认操作、执行后验证结果，在失败时诊断、修复或重新规划。

仅面向 Windows 桌面、个人本地使用，数据全部存在本地明文文件，API Key 由用户在应用内自行配置。

## 快速开始

普通用户只需预先安装 **Python 3.12（64 位）**。首次使用时双击根目录的 `环境配置器.bat`，配置器会自动完成：

- 下载项目本地 Node.js LTS，并安装前端依赖；
- 安装 Rust stable、配置 Cargo 镜像并预编译检查；
- 检测或安装 MSVC Build Tools 与 WebView2 Runtime；
- 创建 `python/venv`，安装 Python 后端及测试依赖；
- 校验前端、Rust 与 Python 后端是否可用。

配置过程需要联网；安装 MSVC 时可能出现系统安装窗口。环境完成后，日常只需双击 `启动应用.bat`，它会先检查 Node、Rust、Python 虚拟环境、后端身份和端口占用，能修复的项目会自动修复。

已有完整开发环境时，也可以手动启动：

```bash
cd app
npm install
npm run tauri:dev
```

## 自检

```powershell
cd app
npm.cmd test
npm.cmd run lint
npm.cmd run build

cd ..\python
.\venv\Scripts\python.exe -m pytest -q

cd ..\app\src-tauri
cargo test
cargo clippy -- -D warnings
```

打包使用 `cd app && npm.cmd run tauri:build`。首次打包会组装可重定位的 Python 3.12 后台并校验核心文件和依赖完整性，因此需要联网且耗时较长。

## 技术栈

- 桌面外壳：Tauri 2（Rust）
- 前端：React 19 + Vite + TypeScript + Zustand + Ant Design v6 + @xyflow/react
- 后端：Python FastAPI（localhost:18081），开发时使用 `python/venv`，安装包内使用可重定位的独立 Python，由 Rust `python_manager.rs` 校验身份并管理生命周期
- 数据：本地明文 JSON `data/multi-agent-*.json`，经 Rust `storage_*` 命令读写

## 主要功能

- **多画布工作台**：最多同时打开 20 个画布，并发运行上限 6；运行用只读快照，不写回原画布。
- **Agent 库**：定义（库）与实例（画布节点）两层模型，快照复制、完全独立。
- **工作流引擎**：依赖并行、失败隔离、门控 OR/AND/NOR、节点级重试、上游 JSON 优先流转。
- **姬子总 Agent**：多会话、附件、Markdown 对话、联网搜索、结构化记忆和上下文摘要。采用“观察 → 规划 → 确认 → 事务执行 → 验证 → 必要时重新规划”的受控自主闭环；写操作需要确认，删除操作需要二次确认，并限制单次计划步数、修复次数和无变化循环。
- **Skill 系统**：内置 Skill 与用户 Skill 并存，名称、描述、索引和正文统一保存中文数据。外部 Markdown 可智能拆分或原文照存；智能整理和旧 Skill 复写会应用内置 `skill-creator` 规范，正文最多 20000 个字符，并记录实际调用情况。
- **搜索与模型**：支持安全的深度网页正文读取；模型配置保留预设厂商，同时允许添加自定义公网 HTTPS 端点和 localhost 本地端点。
- **失败自愈**：诊断缺工具 / 缺库并生成候选工具；安装新工具需人工确认。
- **工具系统**：内置 + 自定义工具，安装时做 AST 顶层副作用扫描；事务失败时可用源码快照恢复，应用更新时保留用户工具目录。
- **报告中心**：已结束运行的指标、历史产物、Token 用量统计（按模型 / 按节点 / 姬子按场景细分，仅供参考）。

## 目录结构

```
app/                       前端 + Tauri + Rust 桌面端源码
python/                    Python FastAPI 后端、工具、测试
jizi-agent-architecture/   姬子人格与 Skill 架构文件
docs/                      仍在使用的工程规范与开发错误复盘
data/ outputs/ logs/       运行数据、产物、日志（不入库）
```

## 注意

- `data/multi-agent-models.json`、`data/multi-agent-search.json` 含明文 API Key，不要提交或走公开链接。
- `.bat` 是 GBK + CRLF，适配中文 Windows 的 cmd；不要用 UTF-8 重存。
- 生成的自定义工具必须人工审核后才落盘执行，不弱化 AST 顶层副作用扫描。
- 安装包构建会执行 Python 后台完整性检查；缺少解释器、核心依赖或服务入口时直接阻止发版。

## 更多文档

- [qa-test-cases.md](qa-test-cases.md) — 用户主流程与边界场景的人工验收用例
- [docs/模块化拆分规范.md](docs/模块化拆分规范.md) — 当前模块归属和拆分规则
- [docs/开发错误总结-2026-07-07.md](docs/开发错误总结-2026-07-07.md) — 仍适用的历史缺陷与防回归经验
- [项目审计报告.md](项目审计报告.md) — 以当前源码和实际验证结果为准的问题清单
