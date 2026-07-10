# Agent 协同工具

在画布上把多个 AI Agent 连成工作流，让它们分工协作、自动跑出结果（文档 / 表格 / 思维导图），并由总管 AI「姬子」用自然语言帮你操作画布、诊断失败、补工具。

仅面向 Windows 桌面、个人本地使用，数据全部存在本地明文文件，API Key 由用户在应用内自行配置。

## 快速开始

需要 Node.js（npm 11.x）、Rust（rustup 稳定版）、Python 3.12、Windows WebView2 Runtime。

```bash
cd app
npm install
npm run tauri:dev
```

或直接双击根目录的 `.bat`：

- `环境配置器.bat` — 首次使用，自动检测并安装 Python / Node / Rust。
- `启动应用.bat` — 环境就绪后的日常启动。

## 自检

```bash
npm run lint
npm run test -- --run
npm run build
```

## 技术栈

- 桌面外壳：Tauri 2（Rust）
- 前端：React 19 + Vite + TypeScript + Zustand + Ant Design v6 + @xyflow/react
- 后端：Python FastAPI（localhost:18081），由 Rust `python_manager.rs` 管生命周期
- 数据：本地明文 JSON `data/multi-agent-*.json`，经 Rust `storage_*` 命令读写

## 主要功能

- **多画布工作台**：最多同时打开 20 个画布，并发运行上限 6；运行用只读快照，不写回原画布。
- **Agent 库**：定义（库）与实例（画布节点）两层模型，快照复制、完全独立。
- **工作流引擎**：依赖并行、失败隔离、门控 OR/AND/NOR、节点级重试、上游 JSON 优先流转。
- **姬子总 Agent**：多会话、附件、联网搜索、记忆、上下文摘要、自然语言操作画布、多步确认。
- **失败自愈**：诊断缺工具 / 缺库并生成候选工具；安装新工具需人工确认。
- **工具系统**：内置 + 自定义工具，安装时做 AST 顶层副作用扫描。
- **报告中心**：已结束运行的指标、历史产物、Token 用量统计（仅供参考）。

## 目录结构

```
app/                       前端 + Tauri + Rust 桌面端源码
python/                    Python FastAPI 后端、工具、测试
jizi-agent-architecture/   姬子人格与 Skill 架构文件
docs/                      辅助文档（审计待办 / 错误总结 / 拆分规范）
data/ outputs/ logs/       运行数据、产物、日志（不入库）
```

## 注意

- `data/multi-agent-models.json`、`data/multi-agent-search.json` 含明文 API Key，不要提交或走公开链接。
- `.bat` 是 GBK + CRLF，适配中文 Windows 的 cmd；不要用 UTF-8 重存。
- 生成的自定义工具必须人工审核后才落盘执行，不弱化 AST 顶层副作用扫描。

## 更多文档

- [开发清单.md](开发清单.md) — 功能全景、技术栈、开发时间线、待办
- [交接注意事项.md](交接注意事项.md) — 迁移、启动、打包发版、关键约束
