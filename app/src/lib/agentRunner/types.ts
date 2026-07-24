import type { ChatImage } from '../llmClient';

export type JsonObject = Record<string, unknown>;
export type JsonSchema = JsonObject;

// 节点收集到的输入:文本(正文/批注/上游输出)+ 图像(拖入的图片、Excel 抽出的示意图)。
// 多模态链路的载体——images 非空时会按 provider 协议构造多模态 content 发给视觉模型。
export interface CollectedInput {
  text: string;
  images: ChatImage[];
}

export interface NodeOutput {
  label: string;
  content: string;
  structuredData?: JsonObject;
  summary?: string;
  path?: string;
  dataPath?: string;
  nodeId?: string;
  resultRole?: string;
}

export interface RunOutputRef {
  nodeId: string;
  resultRole?: string;
  outputFormat: string;
  label: string;
  summary?: string;
  path?: string;
  dataPath?: string;
  content: string;
}

export interface OutputSpec {
  extension: string;
  tool: string;
  title: string;
}

export interface RunCanvasResult {
  runId: string;
  runCanvasId: string;
  nodeCount: number;
  writtenCount: number;
  outputs: RunOutputRef[];
}

export interface RunArtifact {
  nodeId: string;
  path: string;
}

export class RunAbortedError extends Error {
  artifacts: RunArtifact[];
  runId?: string;
  canvasId?: string;

  constructor(artifacts: RunArtifact[], runId?: string, canvasId?: string) {
    super('任务已中止');
    this.name = 'RunAbortedError';
    this.artifacts = artifacts;
    this.runId = runId;
    this.canvasId = canvasId;
  }
}

// 无法就地重跑失败子节点(运行副本已关/节点缺失/上游产物不可恢复)时抛出,由上层回落整图重跑。
export class RerunUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RerunUnavailableError';
  }
}
