import type { Node } from '@xyflow/react';
import type { AgentNodeData } from '../../stores/canvasStore';
import { useModelStore } from '../../stores/modelStore';
import { useTokenStatsStore } from '../../stores/tokenStatsStore';
import type { ChatImage } from '../llmClient';
import { getProvider } from '../providers';
import { executeTool, unwrapToolResult } from '../pythonClient';
import { nodeLabel } from '../agentNode';
import { outputFormatForNode } from './outputFormats';
import { schemaTextFromNode } from './schema';
import type { CollectedInput } from './types';

// 按厂商协议把文本 + 图片拼成一条 user message 的 content。
// 复用 llmClient.chat 的两套结构:anthropic 用 image source.base64;openai/gemini 用 image_url 的 data URL。
// 无图时退回纯字符串(维持既有纯文本行为与 prompt 缓存)。
function buildUserContent(
  prompt: string,
  images: ChatImage[],
  api: string,
): unknown {
  if (images.length === 0) return prompt;
  if (api === 'anthropic') {
    return [
      ...images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      })),
      { type: 'text', text: prompt },
    ];
  }
  return [
    { type: 'text', text: prompt },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    })),
  ];
}

export function buildPrompt(node: Node, input: string): string {
  const data = node.data as AgentNodeData;
  const format = outputFormatForNode(node);
  const outputSchemaText = schemaTextFromNode(node, 'outputSchemaText');
  const outputInstruction =
    format === 'markdown'
      ? '请根据输入完成该节点任务，并输出可直接保存为 Markdown 的结果。'
      : format === 'docx'
        ? '请根据输入完成该节点任务，并且只输出合法 JSON，不要使用 Markdown 代码块。JSON 格式为 {"title":"文档标题","sections":[{"heading":"章节标题","paragraphs":["段落"],"table":{"headers":["列名"],"rows":[["单元格"]]}}]}。没有表格时可以省略 table。'
        : format === 'xlsx'
          ? '请根据输入完成该节点任务，并且只输出合法 JSON，不要使用 Markdown 代码块。JSON 格式为 {"sheet":"工作表名称","headers":["列名"],"rows":[["单元格"]]}。如果是测试用例，优先使用列：编号、标题、前置条件、步骤、预期结果、优先级。'
          : '请根据输入完成该节点任务，并且只输出合法 JSON，不要使用 Markdown 代码块。JSON 格式为 {"title":"中心主题","children":[{"title":"分支","children":[{"title":"子分支"}]}]}。';
  const promptParts = [
    `你正在执行 Agent 节点「${nodeLabel(node)}」。`,
    data.description ? `节点职责：${data.description}` : '',
    outputInstruction,
    outputSchemaText
      ? `输出还必须匹配以下 JSON Schema。请优先返回可直接解析的 JSON：\n${outputSchemaText}`
      : '',
    `输入：\n${input}`,
  ].filter(Boolean);
  return promptParts.join('\n\n');
}

export async function callNodeModelWithPrompt(
  node: Node,
  prompt: string,
  signal?: AbortSignal,
  images: ChatImage[] = [],
): Promise<string> {
  const data = node.data as AgentNodeData;
  const ref = data.modelRef;
  if (!ref) throw new Error(`节点「${nodeLabel(node)}」未选择 LLM。`);

  const config = useModelStore.getState().configs.find((c) => c.id === ref.configId);
  if (!config) throw new Error(`节点「${nodeLabel(node)}」引用的模型配置不存在。`);
  if (!config.apiKey) throw new Error(`模型配置「${config.name}」未填写密钥。`);

  // 视觉硬拦:带了图像输入但所选模型未标记 vision,直接拒绝(配置类错误,不进重试)。
  // 正面回应"图被安静跳过、却以为全看了"——宁可报错也不静默丢图。
  if (images.length > 0) {
    const vision = config.models.find((m) => m.id === ref.modelId)?.caps?.vision;
    if (vision !== true) {
      throw new Error(
        `节点「${nodeLabel(node)}」带了图像输入，但所选模型「${ref.modelId}」未标记支持视觉。` +
          '请在模型配置中为该模型勾选「视觉」能力，或改用支持视觉的多模态模型。',
      );
    }
  }

  const provider = getProvider(config.providerId);
  const api = provider?.api ?? 'openai';
  const res = await executeTool(
    'llm-calling',
    {
      api,
      base_url: config.baseURL,
      api_key: config.apiKey,
      model: ref.modelId,
      system: data.systemPrompt || undefined,
      messages: [{ role: 'user', content: buildUserContent(prompt, images, api) }],
      max_tokens: 4096,
    },
    signal,
  );
  const result = unwrapToolResult<{ reply?: unknown; usage?: { total?: unknown } }>(
    res,
    `节点「${nodeLabel(node)}」调用 LLM 失败。`,
  );
  const reply = result.reply;
  if (typeof reply !== 'string') throw new Error(`节点「${nodeLabel(node)}」LLM 返回格式异常。`);
  // Token 用量记录:主调用与 schema 转换都经此函数,记在这里可覆盖节点所有 LLM 消耗。
  // usage 缺失(某些厂商不返回)时 total=0,recordNode 内部会静默跳过。
  const total = typeof result.usage?.total === 'number' ? result.usage.total : 0;
  if (total > 0) {
    useTokenStatsStore.getState().recordNode(node.id, nodeLabel(node), ref.modelId, total);
  }
  return reply;
}

export async function callNodeModel(
  node: Node,
  input: CollectedInput,
  signal?: AbortSignal,
): Promise<string> {
  return callNodeModelWithPrompt(
    node,
    buildPrompt(node, input.text),
    signal,
    input.images,
  );
}
