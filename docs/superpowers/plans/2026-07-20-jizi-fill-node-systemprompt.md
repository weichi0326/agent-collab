# 实施计划：姬子造节点时直接写入生成的系统提示词

> 关联 spec：`docs/superpowers/specs/2026-07-20-jizi-fill-node-systemprompt-design.md`
> 方式：TDD（先写测试，再改实现），每步 tsc + lint + test 收口。

## 步骤

### 1. 扩类型 `add-node`（types.ts）
- `app/src/lib/masterActions/types.ts` 的 `add-node` 变体加：
  ```ts
  | {
      type: 'add-node';
      label: string;
      agentQuery?: string;
      outputFormat?: AgentOutputFormat;
      description?: string;
      systemPrompt?: string;
    }
  ```

### 2. 先写解析测试（jiziTurnPlanner.test.ts）
- 用例：
  - add-node JSON 带 `systemPrompt`+`description` → 解析出的 step 保留两字段。
  - 省略两字段 → step 不含 `systemPrompt`/`description`（undefined）。

### 3. 改解析实现（jiziTurnPlanner.ts）
- `normalizeStep` 的 `add-node` 分支多读 `description`、`systemPrompt`（`optionalTextValue`）。
- **不截断**：14000 上限靠第 6 步规划提示词约束姬子生成，解析层原样保留。
- 空/缺省不带该字段。
- 跑测试至第 2 步用例全绿。

### 4. 先写写入测试（helpers.test.ts，若无则新建）
- 用例（`nodeFromAgentSpec`）：
  - spec 带 `systemPrompt` → `node.data.systemPrompt` 等于该值，`node.data.systemPromptSourceName === '姬子生成'`。
  - spec 带 `description` → `node.data.description` 等于该值。
  - spec 不带 → 回退模板/默认；`systemPromptSourceName` 不被设成 '姬子生成'。
  - 注意：`nodeFromAgentSpec` 依赖 `useAgentStore`（`ensureAgentForSpec`），测试需在无匹配 agent 时走 `defaultAgentDraft`；用一个明显不匹配任何预设的 label，或 reset store。

### 5. 改写入实现（helpers.ts）
- 扩 `nodeFromAgentSpec` 的 spec 参数类型加 `description?`、`systemPrompt?`。
- 组装 `data` 后：
  - `if (spec.systemPrompt) { data.systemPrompt = spec.systemPrompt; data.systemPromptSourceName = '姬子生成'; }`
  - `if (spec.description) data.description = spec.description;`
- `addNodeToActiveCanvas` 无需改（已整段传 step）。
- 跑测试至第 4 步用例全绿。

### 6. 更新规划提示词（jiziTurnPlanner.ts `buildPlannerPrompt`）
- 在 action steps 说明处补一句：为每个新 Agent 节点写出完整 `systemPrompt`（真实任务指令，作为系统角色）+ 一句话 `description`（职责），**不要依赖节点名承载任务**；**systemPrompt 必须控制在 14000 字符以内**。
- 更新 action 示例，展示带字段的 add-node：
  `{"type":"add-node","label":"显示名","description":"一句话职责","systemPrompt":"完整任务指令…","outputFormat":"markdown"}`。
- 无独立单测（prompt 文案），靠 tsc + 人工核对。

### 7. 收口校验
- `cd app && npx tsc --noEmit`
- `npm run lint`
- `npm run test -- --run`（全过，含新增用例）
- 若能起 Tauri dev：按 spec 六节实机验证；不能起则声明仅静态+单测。

## 回滚
每步独立小改，git 未提交，异常直接 revert 对应文件。

## 检查清单（映射 spec 决策）
- [ ] add-node 加 description/systemPrompt 字段（覆盖，省略回退）
- [ ] 14000 上限写进规划提示词（约束姬子，不截断）
- [ ] 来源标记 '姬子生成'
- [ ] 规划提示词要求生成 systemPrompt+description、不依赖节点名
- [ ] 老计划（不带新字段）行为不变
- [ ] tsc + lint + test 全绿
