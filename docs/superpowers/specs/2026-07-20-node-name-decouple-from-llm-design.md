# 节点名称与 LLM 生成解耦（名称只做展示/命名，不进提示词）

> 日期：2026-07-20
> 状态：待确认
> 关联：agentRunner 运行链路（modelCalls / inputs / gate&timer 聚合）

## 一、背景与问题

节点名（`label`）目前被当作组织性/展示性字段，但实际被注入进了 LLM 的输入文本。用户指出这是缺陷：**当用户给节点起了与实际任务相悖的名字时，名字会污染生成结果**。

用户的例子：节点命名为「角色设定生成」，但 systemPrompt/职责实际要求「世界观生成」。名字进了 prompt 后，模型会被"角色设定"误导，与真实任务冲突，结果直接出问题。

用户明确原则：**节点名不能对结果产生任何影响——本节点自己的生成、以及喂给下游节点的内容，都不能带节点名。**

## 二、根因（已核实）

真正的任务来源是：
- `data.systemPrompt` → 作为 LLM 的 `system` 角色（`modelCalls.ts:106`）。
- `data.description`（节点职责）→ 拼进 user prompt（`modelCalls.ts:58`）。

节点名（`nodeLabel(node)`）却在以下 **LLM 面向文本**里被额外注入，与真实任务并列，形成干扰源。全部注入点已核准：

**A. 本节点自己的名字进本节点 prompt**
- `modelCalls.ts:57`：`你正在执行 Agent 节点「${nodeLabel(node)}」。`
- `inputs.ts:283`（schema 输入转换 prompt）：`节点「${label}」收到的前序输出不符合它的输入 schema。`

**B. 上游节点的名字进下游输入内容**
- `inputs.ts:340`：`## 前序节点：${output.label}`
- `inputs.ts:264-272` `sourcePayload`：schema 匹配 payload 里的 `label: output.label` 字段
- `agentRunner.ts:497`（门控节点聚合上游）：`=== 「${s.label}」 ===`
- `agentRunner.ts:549`（定时节点聚合上游）：`=== 「${s.label}」 ===`

**C. 无输入退化占位文本（节点名混进喂给 LLM 的 input）**
- `inputs.ts:372`：`画布「${canvas.name}」中的节点「${nodeLabel(node)}」选择了历史产物数据来源，但未选中任何历史文件。`
- `inputs.ts:385`：`画布「${canvas.name}」中的节点「${nodeLabel(node)}」没有前序输入或手动数据源。`

## 三、决策（已与用户确认 — 范围收窄）

> **重要修订（2026-07-20，用户第二轮反馈）**：区分「本节点自名」与「上游节点名」。
> - **本节点自己的名字**：不能进本节点自己的 prompt（这是缺陷，名字与真实任务相悖会毁结果）。**移除**。
> - **上游节点的名字**：要作为「数据来源」标识**显示给下游**，让下游知道每段输入来自哪个上游节点（有用的溯源信息）。**保留原样。**

**只摘 A 类（本节点自名），B 类（上游名做来源标识）全部保留。** 名称仍保留于：产物文件夹命名、Token 统计、报错、`NodeOutput.label` 身份、以及**下游数据来源标题**。

**替换规则：**
- A 类（本节点自名进本节点 prompt）→ 去掉名字，改泛指：`你正在执行一个 Agent 节点。` / `当前节点收到的前序输出不符合它的输入 schema。`。任务语义仍由 systemPrompt + 节点职责(description) 承载。
- B 类（上游名做下游来源标识）→ **不改**：`## 前序节点：{上游名}`、`=== 「{上游名}」 ===`、`sourcePayload.label` 全部保持显示真实上游名。
- C 类（本节点无输入占位文本）→ 去掉本节点自名：`当前节点选择了历史产物数据来源，但未选中任何历史文件。` / `当前节点没有前序输入或手动数据源。`。（画布名同为展示字段，占位文本里一并去掉更干净，作为附带改动。）

**已接受的边界**：若用户把某节点名起错，其错误名字仍会作为「数据来源」溯源标签出现在下游输入中——但它是溯源标签、不是任务指令，下游任务由下游自己的 systemPrompt 决定。用户认可"显示但不当指令"的这一边界。

## 四、机制细节

范围收窄后不再引入位置序号、不再抽 `formatUpstreamSources`、不动 `sourcePayload`、不动门控/定时聚合。改动集中在 `modelCalls.ts` 与 `inputs.ts` 的几处本节点自名文本。

**buildPrompt 可测**：`modelCalls.ts` 的 `buildPrompt(node, input)` 是纯函数，直接单测"返回文本不含 `nodeLabel(node)`、含 description、含 input"。

## 五、文件清单

**修改**
- `app/src/lib/agentRunner/modelCalls.ts` — `buildPrompt` 去掉 `你正在执行 Agent 节点「X」` 名字，改泛指 `你正在执行一个 Agent 节点。`。
- `app/src/lib/agentRunner/inputs.ts` — `convertInputToSchema` prompt（L283）去本节点自名；两处无输入占位文本（L372、L385）去本节点自名。

**新增（测试）**
- `app/src/lib/agentRunner/modelCalls.test.ts`（若无则新建）— `buildPrompt` 不含本节点名、含 description、含 input、含输出指令。

**不涉及（保留原样）**：上游名做下游来源标识（`inputs.ts:340` `## 前序节点：X`、`sourcePayload.label`、`agentRunner.ts:497/549` 门控/定时聚合 `=== 「X」 ===`）；产物文件夹命名（`outputFolderLabelForNode` 走 `nodeLabel`）；Token 统计、报错文案、store schema、后端、持久化版本、路由/连线。

## 六、验证方法

- `npx tsc --noEmit` 通过；`npm run lint`（oxlint）通过；`npm run test -- --run` 全过（含新增用例）。
- 逻辑回归（单测层面）：
  1. `buildPrompt` 对一个 label 与 description 明显不同的节点，输出不含 label 字符串、含 description。
- 实机（Tauri dev，若可起）：
  1. 造一个节点，名字与 systemPrompt 任务相悖 → 运行 → 产物内容贴合 systemPrompt 任务，不被自己的名字带偏。
  2. 上游→下游两节点 → 下游输入里数据来源标题仍显示上游真实节点名（溯源保留）。
  3. 回归：产物文件夹名仍是节点真实名。
  - 无法起 dev 则声明"仅静态 + 单测验证"，不谎报 UI 通过。

## 七、风险

1. **本节点少了自名提示**：`你正在执行一个 Agent 节点` 比带名字泛一点，但任务真正来源是 systemPrompt(system 角色) + 节点职责(description)，名字本就是干扰而非信息，移除是净收益。
2. **错误命名仍出现在下游来源标签**：已接受的边界——上游名作为溯源标签保留，非任务指令，下游任务由下游 systemPrompt 决定。
3. **占位文本去掉画布名**：属附带清理；如需保留画布名可只去节点名，回退成本低。

## 八、待用户确认

1. 只摘「本节点自名」、保留「上游名做下游数据来源标识」——方向已按第二轮反馈锁定。
2. 无输入占位文本是否一并去掉画布名（还是只去本节点名）？
