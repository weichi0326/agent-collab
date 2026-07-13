# 实施计划：极小折线自动拉直

> 日期：2026-07-13
> 关联 spec：`docs/superpowers/specs/2026-07-13-edge-tiny-dogleg-straighten-design.md`
> 已确认：竖直+水平都处理；阈值 8（flow 几何、与缩放无关）；多父冲突不动；仅被拖节点直接相连边、不递归；拖拽结束触发；不额外 pushHistory。

## 核心机制

拖拽结束 → 对被拖节点的相连边逐条判定：竖直连接且中心 x 偏移 `∈(0,8)` → 移下方节点 x 对齐上方中心；水平连接且中心 y 偏移 `∈(0,8)` → 移右侧节点 y 对齐左侧中心。冲突（同节点同轴多目标）整组丢弃。用 `applyNodes` 落地，共用拖拽起始的撤销快照。

## 关键函数签名

```ts
// app/src/components/CanvasArea/edgeStraighten.ts
import type { Node, NodeChange, Edge } from '@xyflow/react';

interface StraightenInput {
  draggedId: string | null;
  nodes: Node[];
  edges: Edge[];
  threshold: number; // flow 坐标，默认调用处传 8
}

export function straightenConnectedNodes(input: StraightenInput): NodeChange[];
// 返回 position 型 NodeChange 数组；无可拉直项返回 []
```

内部逻辑：
1. `draggedId` 为空或找不到节点 → 返回 `[]`。
2. `nodeCenter(node)`：`w = measured?.width ?? width`，`h = measured?.height ?? height`；任一非有限或 ≤0 → 该节点无中心。
3. 遍历 `edges` 中 source/target 命中 `draggedId` 的边；两端任一无中心 → 跳过。
4. 判方向：`|dx| >= |dy|` 视水平，否则竖直（对齐 edgeRouting）。
5. 竖直：`offset = |cxA − cxB|`；`0 < offset < threshold` → mover = center.y 较大者；`deltaX = cxOther − cxMover`；候选 `{ moverId, axis:'x', newPos:{x: mover.pos.x + deltaX, y: mover.pos.y} }`。
6. 水平：`offset = |cyA − cyB|`；`0 < offset < threshold` → mover = center.x 较大者；`deltaY = cyOther − cyMover`；候选 axis:'y'。
7. 冲突去重：按 `moverId+axis` 分组；组内出现不同 newPos 目标值 → 丢弃整组；一致 → 留一个。
8. 输出 `{ id: moverId, type:'position', position: newPos, dragging:false }`。

## 实施步骤

### 步骤 1（先写测试）：`edgeStraighten.test.ts`
覆盖：
- 竖直近似对齐 → 移下方节点 x，断言输出 position 与目标一致。
- 水平近似对齐 → 移右侧节点 y。
- 偏移 = 8（边界）→ 不动（`< threshold` 严格小于）。
- 偏移 = 0（已对齐）→ 不动。
- 下方节点连两个 x 不同父、都在阈值内 → 冲突丢弃、返回 `[]`。
- 端点缺 measured → 跳过、返回 `[]`。
- draggedId=null → `[]`。

### 步骤 2：实现 `edgeStraighten.ts`
按上述签名与逻辑。纯函数、无 store 依赖。

### 步骤 3：接线 `CanvasArea.tsx`
`onNodeDragStop`：
```ts
const onNodeDragStop = useCallback(() => {
  const draggedId = activeDragNodeId.current;
  const moves = straightenConnectedNodes({
    draggedId,
    nodes: displayNodes,
    edges: canvas?.edges ?? [],
    threshold: 8,
  });
  if (moves.length > 0) applyNodes(activeId, moves);
  activeDragNodeId.current = null;
  setAlignmentGuides([]);
}, [activeId, applyNodes, displayNodes, canvas?.edges]);
```
补齐依赖数组；导入 `straightenConnectedNodes`。

### 步骤 4：静态 + 测试
`npx tsc --noEmit`、`npm run lint`、`npm run test -- --run` 全过。

### 步骤 5：实机验证（Tauri dev）
按 spec 六节 6 个场景逐一验证；起不了 dev 则声明仅静态验证。

## 验收标准

- tsc / lint / test 全过（含新增用例）。
- 实机：小台阶消失、下方节点微移到位；>8px 台阶保留；多父冲突不乱移；一次撤销回退。

## 风险与回退

- 若实机发现拖下方节点被 snap 到父中心造成困扰 → 可加"仅移动非被拖节点"约束（拖谁不动谁）。改动集中在纯函数，回退成本低。
- 改动仅 2 新文件 + 1 处 onNodeDragStop，无 store/接口/路由变更。

## 不做

- 不改 orthogonalRoute / nodePorts / edgeRouting / alignmentSnap。
- 不递归传播到下游更远节点。
- 不引入 store schema、持久化版本、后端改动。
