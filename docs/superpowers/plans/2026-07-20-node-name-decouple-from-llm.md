# 实施计划：节点名称与 LLM 生成解耦（范围收窄版）

> 日期：2026-07-20
> 关联 spec：`docs/superpowers/specs/2026-07-20-node-name-decouple-from-llm-design.md`
> 范围（第二轮反馈锁定）：**只摘「本节点自名」进本节点 prompt；上游名做下游数据来源标识全部保留。**

## 核心机制

把节点自己的名字从它自己的 prompt / 占位输入文本里移除，改泛指。任务语义由 systemPrompt(system 角色) + 节点职责(description) 承载。上游名在下游「数据来源」处照常显示，作溯源标签。

## 实施步骤（TDD，先测后码）

### 步骤 1（先写测试）：`agentRunner/modelCalls.test.ts`
- 造 node：`data.label='角色设定生成'`, `data.description='生成世界观'`。
- `buildPrompt(node, '输入X')` 断言：
  - 含「生成世界观」（description）、含「输入X」、含输出指令关键字（如「Markdown」）。
  - **不含**「角色设定生成」、**不含**「你正在执行 Agent 节点」。
- `buildPrompt` 已 export（modelCalls.ts:40），直接调用；无需 modelRef。

### 步骤 2：改 `modelCalls.ts` `buildPrompt`
- L57：`你正在执行 Agent 节点「${nodeLabel(node)}」。` → `你正在执行一个 Agent 节点。`
- `nodeLabel` 其余报错处仍用，import 保留。

### 步骤 3：改 `inputs.ts`（本节点自名 → 泛指）
- `convertInputToSchema`（L283）：`节点「${label}」收到的前序输出不符合它的输入 schema。` → `当前节点收到的前序输出不符合它的输入 schema。`（`label` 变量仍用于 `parseJsonReply`/`assertCustomSchema` 报错，保留。）
- 占位文本 L372：`画布「${canvas.name}」中的节点「${nodeLabel(node)}」选择了历史产物数据来源，但未选中任何历史文件。` → 去本节点自名（画布名去留见待确认项）。
- 占位文本 L385：`画布「${canvas.name}」中的节点「${nodeLabel(node)}」没有前序输入或手动数据源。` → 去本节点自名。

### 步骤 4：不动的部分（确认保留）
- `inputs.ts:340` `## 前序节点：${output.label}` — 保留。
- `inputs.ts:264` `sourcePayload` 的 `label: output.label` — 保留。
- `agentRunner.ts:497 / 549` `=== 「${s.label}」 ===` — 保留。

### 步骤 5：静态 + 测试
`npx tsc --noEmit`、`npm run lint`、`npm run test -- --run` 全过。

### 步骤 6：实机验证（Tauri dev）
按 spec 六节场景；起不了 dev 则声明仅静态 + 单测验证。

## 验收标准

- tsc / lint / test 全过（含新增 `buildPrompt` 用例）。
- `buildPrompt` 输出不含本节点名、含 description。
- 下游数据来源标题仍显示上游真实节点名（未被误删）。
- 产物文件夹名仍为节点真实名。

## 风险与回退

- 改动集中在 2 个文件 + 1 测试文件，无 store/接口/后端变更，回退成本低。
- 若发现去掉本节点自名后有意外依赖，回退仅需还原 2 处字符串。

## 不做

- 不改上游名做下游来源标识的任何逻辑。
- 不改产物文件命名、Token 统计、报错文案。
- 不引入位置序号、不抽聚合纯函数、不动 sourcePayload。
- 不引入 store schema、持久化版本、后端、路由/连线改动。
