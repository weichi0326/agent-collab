import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  MarkerType,
  useReactFlow,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Node,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { App, Button, Input, Modal } from 'antd';
import {
  PlusOutlined,
  PartitionOutlined,
} from '@ant-design/icons';
import AgentNode from './AgentNode';
import GateNode from './GateNode';
import TimerNode from './TimerNode';
import {
  canvasLimitMessage,
  useCanvasStore,
  type AgentNodeData,
} from '../stores/canvasStore';
import { useAgentStore } from '../stores/agentStore';
import { uid } from '../lib/id';
import { normalizeToolTags } from '../lib/toolTagMigration';
import { formatTimerLabel } from '../lib/timerLabel';
import {
  DEFAULT_ZOOM,
  ZOOM_MAX,
  ZOOM_MIN,
} from './CanvasArea/zoom';
import { ZoomSlider } from './CanvasArea/ZoomSlider';
import { CanvasToolbar } from './CanvasArea/CanvasToolbar';
import { RunStatusCard } from './CanvasArea/RunStatusCard';
import { SearchPanel } from './CanvasArea/SearchPanel';
import { useCanvasSearch } from './CanvasArea/useCanvasSearch';
import { useCanvasHotkeys } from './CanvasArea/useCanvasHotkeys';
import { useUiStore } from '../stores/uiStore';
import { workspaceInteractionState } from '../settings/appView';
import {
  routeEdgesForNodes,
  validateConnection,
} from './CanvasArea/edgeRouting';
import { straightenConnectedNodes } from './CanvasArea/edgeStraighten';
import { EditableOrthogonalEdge } from './CanvasArea/EditableOrthogonalEdge';
import { AlignmentGuides } from './CanvasArea/AlignmentGuides';
import {
  snapNodeChangesToAlignment,
  type AlignmentGuide,
} from '../lib/alignmentSnap';

const nodeTypes = { agent: AgentNode, gate: GateNode, timer: TimerNode };
const edgeTypes = { orthogonal: EditableOrthogonalEdge };

const defaultEdgeOptions = {
  type: 'orthogonal',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { stroke: 'var(--pearl-accent)', strokeWidth: 1.6 },
};

function Flow() {
  const { message } = App.useApp();
  const view = useUiStore((state) => state.view);
  const interaction = workspaceInteractionState(view);
  const activeId = useCanvasStore((s) => s.activeId);
  const canvas = useCanvasStore((s) =>
    s.canvases.find((c) => c.id === s.activeId),
  );
  const applyNodes = useCanvasStore((s) => s.applyNodes);
  const applyEdges = useCanvasStore((s) => s.applyEdges);
  const connect = useCanvasStore((s) => s.connect);
  const addNode = useCanvasStore((s) => s.addNode);
  const pushHistory = useCanvasStore((s) => s.pushHistory);
  const recompute = useCanvasStore((s) => s.recompute);
  const setAllCollapsed = useCanvasStore((s) => s.setAllCollapsed);
  const renameCanvas = useCanvasStore((s) => s.renameCanvas);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const activeDragNodeId = useRef<string | null>(null);
  const { screenToFlowPosition, fitView, setCenter, getZoom } = useReactFlow();
  const {
    searchOpen,
    searchInputRef,
    query,
    setQuery,
    matchIds,
    activeIdx,
    displayNodes,
    openSearch,
    gotoNext,
    gotoPrev,
    closeSearch,
  } = useCanvasSearch({ canvas, setCenter, getZoom });
  const { onMouseMove } = useCanvasHotkeys({
    activeId,
    enabled: interaction.hotkeysEnabled,
    openSearch,
    screenToFlowPosition,
    onCrossCanvasPaste: () =>
      message.info('已从其他画布粘贴节点,请检查数据来源与连线是否需要调整'),
  });

  // 删除会同时触发 onNodesChange(remove) 与 onEdgesChange(remove),
  // 在这两处 pushHistory 会导致要按两次撤销;因此删除的快照统一由下方
  // 捕获阶段 keydown 在 React Flow 处理前记录,change 回调只负责刷新折叠派生态。
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const snapped = snapNodeChangesToAlignment({
        changes,
        nodes: displayNodes,
        activeNodeId: activeDragNodeId.current,
        tolerance: 8 / getZoom(),
        padding: 20 / getZoom(),
      });
      setAlignmentGuides(snapped.guides);
      applyNodes(activeId, snapped.changes);
      if (changes.some((c) => c.type === 'remove')) recompute(activeId);
    },
    [activeId, applyNodes, displayNodes, getZoom, recompute],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removedIds = changes
        .filter((c) => c.type === 'remove')
        .map((c) => c.id);
      // 删除连线前先记录这些连线的下游节点,删除后若某下游彻底失去前序则提示补数据来源
      const before = useCanvasStore
        .getState()
        .canvases.find((c) => c.id === activeId);
      const affectedTargets = before
        ? before.edges
            .filter((e) => removedIds.includes(e.id))
            .map((e) => e.target)
        : [];
      applyEdges(activeId, changes);
      if (removedIds.length > 0) {
        recompute(activeId);
        if (affectedTargets.length > 0) {
          const after = useCanvasStore
            .getState()
            .canvases.find((c) => c.id === activeId);
          const orphaned = after
            ? [...new Set(affectedTargets)].filter(
                (t) =>
                  after.nodes.some((n) => n.id === t) &&
                  !after.edges.some((e) => e.target === t),
              )
            : [];
          if (orphaned.length > 0) {
            message.info('该节点已无前序，需要补充数据来源');
          }
        }
      }
    },
    [activeId, applyEdges, recompute, message],
  );
  const onConnect = useCallback(
    (params: Connection) => {
      if (!canvas) return;
      const validationMessage = validateConnection(
        canvas.nodes,
        canvas.edges,
        params,
      );
      if (validationMessage) {
        message.warning(validationMessage);
        return;
      }
      connect(activeId, params);
    },
    [activeId, canvas, connect, message],
  );

  // 拖动开始前记录位置快照,支撑「撤销移动」
  const onNodeDragStart = useCallback<OnNodeDrag>(
    (_event, node: Node) => {
      activeDragNodeId.current = node.id;
      setAlignmentGuides([]);
      pushHistory(activeId);
    },
    [activeId, pushHistory],
  );
  const onNodeDragStop = useCallback(() => {
    // 拖拽收尾:相连边中心几像素错位则拉直(移下方/右侧节点),共用拖拽起始的撤销快照
    const moves = straightenConnectedNodes({
      draggedId: activeDragNodeId.current,
      nodes: displayNodes,
      edges: canvas?.edges ?? [],
      threshold: 8,
    });
    if (moves.length > 0) applyNodes(activeId, moves);
    activeDragNodeId.current = null;
    setAlignmentGuides([]);
  }, [activeId, applyNodes, displayNodes, canvas?.edges]);

  useEffect(() => {
    activeDragNodeId.current = null;
    setAlignmentGuides([]);
  }, [activeId]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (useCanvasStore.getState().canvases.find((c) => c.id === activeId)?.readOnly)
        return; // 只读快照 tab 不接受拖入

      // 门控节点拖入:纯路由节点,落点即建,不涉及 Agent 定义
      const gateRaw = event.dataTransfer.getData('application/gate');
      if (gateRaw) {
        let gate: { gateType?: string };
        try {
          gate = JSON.parse(gateRaw) as { gateType?: string };
        } catch {
          return;
        }
        const gateType = gate.gateType;
        if (gateType !== 'or' && gateType !== 'and' && gateType !== 'nor') return;
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const label = gateType === 'or' ? '或门' : gateType === 'and' ? '与门' : '非门';
        addNode(activeId, {
          id: uid('node'),
          type: 'gate',
          position,
          data: { gateType, label },
        });
        return;
      }

      // 定时节点拖入:纯控制节点,默认 5 分钟(300s)倒计时,落点即建。
      const timerRaw = event.dataTransfer.getData('application/timer');
      if (timerRaw) {
        let timer: { timerSeconds?: number };
        try {
          timer = JSON.parse(timerRaw) as { timerSeconds?: number };
        } catch {
          return;
        }
        const timerSeconds =
          typeof timer.timerSeconds === 'number' && timer.timerSeconds > 0
            ? Math.min(86400, Math.floor(timer.timerSeconds))
            : 300;
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        addNode(activeId, {
          id: uid('node'),
          type: 'timer',
          position,
          data: { timerSeconds, label: `定时 ${formatTimerLabel(timerSeconds)}` },
        });
        return;
      }

      const raw = event.dataTransfer.getData('application/agent');
      if (!raw) return;
      let agent: { agentId?: string; name: string };
      try {
        agent = JSON.parse(raw) as { agentId?: string; name: string };
      } catch {
        return;
      }
      if (!agent.name) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      // 快照复制:落点时从定义拷贝各字段进节点 data,之后与定义解耦
      const def = agent.agentId
        ? useAgentStore.getState().agents.find((a) => a.id === agent.agentId)
        : undefined;
      const node: Node = {
        id: uid('node'),
        type: 'agent',
        position,
        data: {
          agentId: agent.agentId,
          label: def?.name ?? agent.name,
          description: def?.description ?? '',
          systemPrompt: def?.systemPrompt ?? '',
          toolTags: normalizeToolTags(def?.toolTags),
          modelRef: def?.modelRef ?? null,
          inputSchemaText: def?.inputSchemaText ?? '',
          outputSchemaText: def?.outputSchemaText ?? '',
        },
      };
      addNode(activeId, node);
    },
    [screenToFlowPosition, addNode, activeId],
  );

  const collapsibleNodes =
    canvas?.nodes.filter((n) => (n.data as AgentNodeData)?.collapsible) ?? [];
  const allCollapsed =
    collapsibleNodes.length > 0 &&
    collapsibleNodes.every((n) => (n.data as AgentNodeData)?.collapsed);
  const readOnly = !!canvas?.readOnly;
  const routedEdges = useMemo(
    () => routeEdgesForNodes(displayNodes, canvas?.edges ?? []),
    [canvas?.edges, displayNodes],
  );

  if (!canvas) return null;

  const openRename = () => {
    setRenameValue(canvas.name);
    setRenameOpen(true);
  };

  const confirmRename = () => {
    const name = renameValue.trim();
    if (name) renameCanvas(activeId, name);
    setRenameOpen(false);
  };

  return (
    <div
      className="canvas-flow anim-fade"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onMouseMove={onMouseMove}
    >
      <ReactFlow
        nodes={displayNodes}
        edges={routedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        nodesDraggable={interaction.hotkeysEnabled && !readOnly}
        nodesConnectable={interaction.hotkeysEnabled && !readOnly}
        edgesFocusable={interaction.hotkeysEnabled && !readOnly}
        deleteKeyCode={readOnly ? null : interaction.deleteKeyCode}
        selectionKeyCode="Control"
        selectionOnDrag
        defaultViewport={{ x: 0, y: 0, zoom: DEFAULT_ZOOM }}
        minZoom={ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          id="grid-fine"
          variant={BackgroundVariant.Lines}
          gap={20}
          size={1}
          color="rgba(111, 120, 116, 0.12)"
        />
        <Background
          id="grid-bold"
          variant={BackgroundVariant.Lines}
          gap={100}
          size={1}
          color="rgba(111, 137, 128, 0.24)"
        />
        <Controls showInteractive={false} />
        <AlignmentGuides guides={alignmentGuides} />
        <CanvasToolbar
          allCollapsed={allCollapsed}
          canCollapse={collapsibleNodes.length > 0}
          readOnly={readOnly}
          setAllCollapsed={() => setAllCollapsed(activeId, !allCollapsed)}
          fitView={() => fitView({ padding: 0.2, duration: 300 })}
          renameCanvas={openRename}
        />
        {canvas && <RunStatusCard canvas={canvas} />}
        <ZoomSlider />
        {searchOpen && (
          <SearchPanel
            inputRef={searchInputRef}
            query={query}
            setQuery={setQuery}
            matchCount={matchIds.length}
            activeIdx={activeIdx}
            gotoNext={gotoNext}
            gotoPrev={gotoPrev}
            closeSearch={closeSearch}
          />
        )}
      </ReactFlow>
      <Modal
        title="重命名画布"
        open={renameOpen}
        onOk={confirmRename}
        onCancel={() => setRenameOpen(false)}
        okText="重命名"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={confirmRename}
          maxLength={40}
          placeholder="请输入画布名称"
        />
      </Modal>
    </div>
  );
}

function CanvasArea() {
  const { message } = App.useApp();
  const activeId = useCanvasStore((s) => s.activeId);
  const hasActive = useCanvasStore((s) =>
    s.canvases.some((c) => c.id === s.activeId),
  );
  const addCanvas = useCanvasStore((s) => s.addCanvas);
  const maxCanvases = useCanvasStore((s) => s.maxCanvases);

  if (!hasActive) {
    return (
      <div
        className="canvas-area canvas-area--empty"
        data-onboarding="canvas-surface"
      >
        <div className="canvas-empty">
          <PartitionOutlined className="canvas-empty__icon" />
          <div className="canvas-empty__text">当前没有打开的画布</div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              if (!addCanvas()) message.warning(canvasLimitMessage(maxCanvases));
            }}
          >
            新建画布
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-area" data-onboarding="canvas-surface">
      <ReactFlowProvider key={activeId}>
        <Flow />
      </ReactFlowProvider>
    </div>
  );
}

export default CanvasArea;
