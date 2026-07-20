# 姬子造节点时直接写入生成的系统提示词

> 日期：2026-07-20
> 状态：待确认
> 关联：姬子动作规划链路（jiziTurnPlanner / masterActions.add-node / helpers）

## 一、背景与问题

姬子（MasterAgent）能规划出画布、节点、连线，但**新建节点的系统提示词（systemPrompt）填不进去**，用户还得手动导入文件。用户表述：「因为节点的提示词是导入制的，所以无法将生成的提示词填入」。

## 二、根因（已核实）

不是"导入制"本身挡路，而是姬子造节点的通道太窄：

1. `add-node` 计划步骤只能带 `label / agentQuery / outputFormat`（`types.ts:20-25`、`jiziTurnPlanner.ts:137-146`）——**没有 systemPrompt / description 的口子**。
2. 新节点的 systemPrompt 只有两个来源：命中预设 Agent 模板用模板自带的；没命中则 `defaultAgentDraft` 给**空字符串**（`helpers.ts:26`、`nodeFromAgentSpec` L95）。
3. 唯一能写 systemPrompt 的步骤是 `update-node-agent-config`，但它要求确切 `nodeId`（`types.ts:35-38`），而 nodeId 是运行时 `addNodeToActiveCanvas` 里 `uid('node')` 生成的（`helpers.ts:90`），**姬子在规划阶段拿不到刚造出来节点的 id**，无法回填。
4. 规划提示词 `buildPlannerPrompt`（`jiziTurnPlanner.ts:291-338`）从头到尾**没要求姬子生成 systemPrompt/description**，add-node 示例也没展示这两个字段。

净效果：姬子摆好结构，但每个新节点提示词为空，需人工导文件。这正是用户说的"填不进去"。

> 补充关联：本改动与「节点名不进 prompt」的解耦（2026-07-20 前序 spec）方向一致——任务语义只由 systemPrompt + 节点职责(description) 承载，节点名不参与生成。所以让姬子把真实任务写进 systemPrompt/description 才是正解。

## 三、决策（已与用户口头确认方向）

- 给 `add-node` 步骤**加可选字段** `systemPrompt` 与 `description`，让姬子造节点时**一次性把生成好的提示词写进节点**，绕开"运行时 nodeId 拿不到"的死结。
- 姬子生成的 systemPrompt/description **覆盖**模板/默认值（她是显式生成的，优先级高于模板兜底）；**省略则回退**到模板/默认（向后兼容，老计划不受影响）。
- systemPrompt 写入时标记来源 `systemPromptSourceName = '姬子生成'`，让属性面板显示「已导入 · 姬子生成」而不是误导性的「早期手动编辑（无关联文件）」（`nodePromptImport.ts:16-22`）。
- systemPrompt 长度上限 **14000 字符，作为要求写进姬子的规划提示词**（让她生成时就控制在限内），**不做"生成后静默截断"**（用户明确否定截断）。对齐手动导入的 `NODE_PROMPT_CHAR_CAP`（`nodePromptImport.ts:1`）作为同一约束值。
- 手动"选择文件导入"入口**照旧保留**，不动 UI。
- 现有节点改配置（`update-node-agent-config`）本就支持 systemPrompt patch 且能拿到已存在节点的 nodeId，**不在本次范围**，无需改。

## 四、机制细节

**类型（types.ts）**：`add-node` 变体加 `description?: string; systemPrompt?: string;`。

**解析（jiziTurnPlanner.ts `normalizeStep` add-node 分支）**：多读 `description`、`systemPrompt` 两个字段，走 `optionalTextValue`；**不截断**（14000 上限靠规划提示词约束姬子）。空/缺省则不带该字段。

**写入（helpers.ts `nodeFromAgentSpec`）**：在模板/默认组装出的 `data` 之上，若 spec 带了 `systemPrompt` 则覆盖 `data.systemPrompt` 并置 `data.systemPromptSourceName='姬子生成'`；若带了 `description` 则覆盖 `data.description`。`addNodeToActiveCanvas` 已把整个 step 传给 `nodeFromAgentSpec`，只需扩 spec 类型与取值。

**提示词（jiziTurnPlanner.ts `buildPlannerPrompt`）**：
- 在 add-node 说明处明确：为每个新 Agent 节点写出**完整的 systemPrompt（真实任务指令，作为该节点的系统角色）**和一句话 `description`（节点职责），**不要依赖节点名承载任务**。
- 更新 action 示例，展示带 `systemPrompt`/`description` 的 add-node：
  `{"type":"add-node","label":"节点显示名","description":"一句话职责","systemPrompt":"完整任务指令…","outputFormat":"markdown"}`。

**可测点**：
- `parseJiziTurnDecision`（纯函数）：喂含 systemPrompt/description 的 add-node JSON → 解析出的 step 带这两个字段；超长 systemPrompt 被截断；省略时不带。
- `nodeFromAgentSpec`（纯函数）：spec 带 systemPrompt → 节点 `data.systemPrompt` 为该值且 `systemPromptSourceName='姬子生成'`；spec 不带 → 回退模板/默认，`systemPromptSourceName` 不被强设。

## 五、文件清单

**修改**
- `app/src/lib/masterActions/types.ts` — `add-node` 加 `description?` `systemPrompt?`。
- `app/src/lib/jiziTurnPlanner.ts` — `normalizeStep` add-node 解析两字段（含截断）；`buildPlannerPrompt` 加生成要求 + 更新示例。
- `app/src/lib/masterActions/helpers.ts` — `nodeFromAgentSpec` 覆盖写入 systemPrompt/description + 置来源标记；spec 参数类型扩展。

**新增/补充（测试）**
- `app/src/lib/jiziTurnPlanner.test.ts` — add-node 解析带/不带/超长 systemPrompt、description。
- `app/src/lib/masterActions/helpers.test.ts`（若无则新建）— `nodeFromAgentSpec` 覆盖/回退 + 来源标记。

**不涉及**：`planExecutor.ts`（add-node 分支已把 step 交给 `addNodeToActiveCanvas`，逻辑不变）；`update-node-agent-config`；PropertiesPanel UI；后端；持久化版本；store schema（`systemPromptSourceName` 字段已存在于 `canvas/types.ts:47`）。

## 六、验证方法

- `npx tsc --noEmit` 通过；`npm run lint`（oxlint）通过；`npm run test -- --run` 全过（含新增用例）。
- 逻辑回归（单测层面）：
  1. 解析：add-node 带 systemPrompt/description → step 保留；超 14000 截断；省略不带。
  2. 写入：`nodeFromAgentSpec` 覆盖模板 systemPrompt 并标 `姬子生成`；省略则回退。
- 实机（Tauri dev，若可起）：
  1. 让姬子建一个多节点画布 → 每个节点属性面板系统提示词显示「已导入 · 姬子生成」，预览有真实任务文本，非空。
  2. 运行该画布 → 产物贴合姬子写入的 systemPrompt。
  3. 手动"选择文件导入"仍可覆盖姬子写入的提示词（回归 UI 未坏）。
  - 无法起 dev 则声明"仅静态 + 单测验证"，不谎报 UI 通过。

## 七、风险

1. **姬子生成的 systemPrompt 质量参差**：由模型质量决定；用户仍可事后手动导入覆盖。提示词里给"写完整任务指令、不依赖节点名"的准则降低跑偏。
2. **planner 层引 UI 常量耦合**：截断逻辑若直接 import `nodePromptImport` 会让 lib 依赖 components。规避：在 jiziTurnPlanner 内联 14000 常量与截断，或把常量下沉到 lib（本次先内联，避免扩散）。
3. **覆盖 vs 回退语义**：省略字段必须"不带"而非"带空串覆盖"，否则会把模板提示词冲空——`optionalTextValue` 返回 undefined 即不带，已规避。
4. **老计划兼容**：不带新字段的 add-node 行为完全不变。

## 八、待用户确认

1. systemPrompt 超 14000 字符：截断（对齐手动导入上限）——采用。
2. 来源标记文案用「姬子生成」——可否。
3. 是否也需要姬子写 `toolTags`/`modelRef` 进 add-node？（本次先只做 systemPrompt+description，工具标签沿用现有能力门控/自动补齐链路。）
