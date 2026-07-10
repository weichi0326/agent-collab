// 模型引用的打包/解包:Select 用 `configId::modelId` 作为单一字符串值,
// 存储层用 { configId, modelId } 结构。三处选模型的 UI(总控/属性面板/Agent 配置)共用。
// L8 修复：分隔符改为第一个 '::' 切割，防止 modelId 中含 '::' 时解析错误
export interface ModelRef {
  configId: string;
  modelId: string;
}

export function packModelRef(ref: ModelRef | null | undefined): string | undefined {
  return ref ? `${ref.configId}::${ref.modelId}` : undefined;
}

export function unpackModelRef(val: string | undefined): ModelRef | null {
  if (!val) return null;
  const sep = val.indexOf('::');
  if (sep === -1) return null; // 格式不合法，视为无效
  const configId = val.slice(0, sep);
  const modelId = val.slice(sep + 2);
  if (!configId || !modelId) return null; // 任一段为空，视为无效
  return { configId, modelId };
}

// 引用的模型可能已被删除/停用:值不在当前可选项中则视为失效,UI 应回退到「未选」
export function isValidModelRef(
  value: string | undefined,
  options: { value: string }[],
): boolean {
  return !!value && options.some((o) => o.value === value);
}
