import type { AgentNodeData, Canvas } from '../stores/canvasStore';
import { nodeLabel as sharedNodeLabel } from './agentNode';

export interface CanvasAdviceItem {
  level: 'good' | 'warn' | 'bad';
  title: string;
  detail: string;
  action: string;
}

function nodeLabel(node: Canvas['nodes'][number]): string {
  return sharedNodeLabel(node, '未命名节点');
}

export function buildCanvasAdvice(canvas: Canvas | undefined | null): CanvasAdviceItem[] {
  if (!canvas) {
    return [{ level: 'warn', title: '没有打开画布', detail: '当前工作台没有可分析的画布。', action: '先新建或打开一个画布。' }];
  }
  const advice: CanvasAdviceItem[] = [];
  if (canvas.nodes.length === 0) {
    advice.push({ level: 'warn', title: '画布还是空的', detail: '没有节点就无法形成工作流。', action: '先添加一个负责处理输入的 Agent 节点。' });
    return advice;
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of canvas.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }

  const sourceNodes = canvas.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  const sinkNodes = canvas.nodes.filter((node) => (outgoing.get(node.id) ?? 0) === 0);
  const isolated = canvas.nodes.filter((node) => !incoming.has(node.id) && !outgoing.has(node.id));

  if (isolated.length > 0 && canvas.nodes.length > 1) {
    advice.push({
      level: 'bad',
      title: '有节点没有接入流程',
      detail: `这些节点既没有输入也没有输出：${isolated.map(nodeLabel).join('、')}。`,
      action: '把它们连接到前后节点，或者确认它们就是独立运行的节点。',
    });
  }

  const sourceWithoutInput = sourceNodes.filter((node) => {
    const data = node.data as AgentNodeData;
    if (data.dataSourceMode === 'url') return !data.dataSourceUrl?.trim();
    if (data.dataSourceMode === 'history') {
      return !Array.isArray(data.dataSourceHistoryPaths) || data.dataSourceHistoryPaths.length === 0;
    }
    return !Array.isArray(data.dataSourceFiles) || data.dataSourceFiles.length === 0;
  });
  if (sourceWithoutInput.length > 0) {
    advice.push({
      level: 'warn',
      title: '入口节点可能缺输入',
      detail: `这些起点节点没有上游，也没有明显的数据来源：${sourceWithoutInput.map(nodeLabel).join('、')}。`,
      action: '给入口节点选择文件/网页/历史产物，或把它接到上游节点。',
    });
  }

  const noModel = canvas.nodes.filter((node) => !(node.data as { modelRef?: unknown }).modelRef);
  if (noModel.length > 0) {
    advice.push({
      level: 'warn',
      title: '部分节点没有选模型',
      detail: `未选模型的节点：${noModel.map(nodeLabel).slice(0, 6).join('、')}。`,
      action: '给这些节点选择模型，否则运行时容易失败或效果不可控。',
    });
  }

  if (sinkNodes.length > 1) {
    advice.push({
      level: 'good',
      title: '画布有多个最终出口',
      detail: `当前有 ${sinkNodes.length} 个末端节点，适合并行产出多份结果。`,
      action: '如果你只想要一个最终报告，可以增加一个汇总节点。',
    });
  }

  if (advice.length === 0) {
    advice.push({ level: 'good', title: '画布结构看起来正常', detail: '节点连接、入口和模型配置没有明显问题。', action: '可以先运行一次，用报告中心观察耗时和失败点。' });
  }
  return advice;
}
