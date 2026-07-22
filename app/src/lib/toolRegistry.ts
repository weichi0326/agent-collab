// 工具注册表：工具元数据的唯一来源。
// BUILTIN_TOOL_TAGS 从这里派生最小 { value, label } 供 Select 使用。

export type ToolStatus = 'planned' | 'ready';

export interface ToolCapability {
  label: string;       // 能力标题，如「新建工作簿」
  description: string; // 一句话说明
}

export interface ToolDef {
  value: string;           // 与工具标签 value 完全一致
  label: string;           // 展示名
  icon: string;            // emoji 图标
  status: ToolStatus;      // planned = 计划中；ready = 已落地
  summary: string;         // 一句话简介
  implementation: {
    language: string;      // 如「Python 3.10+」「TypeScript（已接入）」
    libraries: string[];   // 依赖库列表
    note?: string;         // 补充说明（可选）
  };
  capabilities: ToolCapability[];
}

export const TOOL_REGISTRY: ToolDef[] = [
  {
    value: 'excel',
    label: 'Excel',
    icon: '📊',
    status: 'ready',
    summary: '对 Excel 工作簿进行读取、写入、修改与格式化操作',
    implementation: {
      language: 'Python 3.10+',
      libraries: ['openpyxl'],
      note: 'openpyxl 负责工作簿创建、工作表管理、单元格读写、样式控制与 CSV 导出',
    },
    capabilities: [
      { label: '新建工作簿', description: '创建空白 .xlsx 文件并指定工作表名称' },
      { label: '读取工作表数据', description: '按行/列/区域读取单元格数值，支持跨工作表' },
      { label: '读取单元格批注', description: '提取单元格附带的审阅批注文本与作者，随正文一并交给模型' },
      { label: '提取内嵌图片', description: '把工作簿里的美术示意图等内嵌图片抽成 base64，供多模态模型识别' },
      { label: '写入与修改单元格', description: '向指定坐标写入字符串、数字、公式或日期' },
      { label: '新增 / 删除工作表', description: '在已有工作簿中增删工作表，支持重命名' },
      { label: '设置单元格样式', description: '修改字体、颜色、边框、背景色、对齐方式' },
      { label: '批量填充数据', description: '将二维数组或 DataFrame 一次性写入连续区域' },
      { label: '合并与拆分单元格', description: '合并指定矩形区域，或拆分已合并的单元格' },
      { label: '冻结行列', description: '冻结首行或首列，便于长表格阅读' },
      { label: '导出为 CSV', description: '将指定工作表另存为 UTF-8 编码的 CSV 文件' },
      { label: '生成简单图表', description: '基于单元格数据插入柱状图、折线图等基础图表' },
    ],
  },

  {
    value: 'file',
    label: '文件',
    icon: '📄',
    status: 'ready',
    summary: '对本地文件进行读取、写入与删除的统一工具（文本与二进制）',
    implementation: {
      language: 'Python 3.10+',
      libraries: ['pathlib', 'chardet'],
      note: 'action 参数分派 read / write / delete / meta；写入采用「临时文件 → 原子替换」防止半成品；chardet 自动检测编码',
    },
    capabilities: [
      { label: '读取纯文本文件', description: '将 .txt/.md/.csv/.log 等文本文件读入字符串（action=read）' },
      { label: '自动检测编码', description: '识别 UTF-8 / GBK / GB2312 等常见编码后正确解码' },
      { label: '按行读取', description: '逐行读取大文件（mode=lines），避免一次性加载导致内存溢出' },
      { label: '读取二进制内容', description: '以 base64 形式读取图片、压缩包等非文本文件（mode=binary_b64）' },
      { label: '获取文件元信息', description: '返回文件大小、创建时间、最后修改时间（action=meta）' },
      { label: '创建 / 覆盖写入', description: '新建或覆盖文件写入文本内容（action=write, mode=overwrite）' },
      { label: '追加写入', description: '在已有文件末尾追加内容，不清空原有数据（mode=append）' },
      { label: '写入二进制内容', description: '把 base64 内容解码为 bytes 写入文件（binary_b64=true），适配图片/压缩包' },
      { label: '原子写入', description: '先写临时文件再重命名替换，确保写入不产生半成品' },
      { label: '自动创建目录', description: '写入路径不存在时自动递归创建父级目录' },
      { label: '指定编码写入', description: '支持指定 UTF-8 / GBK 等输出编码，适配下游系统' },
      { label: '删除产物文件', description: '删除已知产物文件并可清理空父目录（action=delete，内部使用）' },
    ],
  },

  {
    value: 'docx',
    label: 'Word',
    icon: '📝',
    status: 'ready',
    summary: '对 Word .docx 文档进行读取与生成的统一工具',
    implementation: {
      language: 'Python 3.10+',
      libraries: ['zipfile', 'xml.etree.ElementTree'],
      note: 'action 参数分派 read / write / meta；直接解析 / 生成 Office Open XML 包，不依赖 python-docx；旧版 .doc 暂不支持',
    },
    capabilities: [
      { label: '提取正文段落', description: '读取 .docx 文档中的普通段落并按顺序合并（action=read）' },
      { label: '提取表格文本', description: '把 Word 表格转为按行排列的文本，便于交给 Agent 分析' },
      { label: '读取文档元信息', description: '返回文件名、大小、创建时间与修改时间（action=meta）' },
      { label: '生成 Word 文档', description: '把标题、章节、段落和表格渲染为 .docx 文件（action=write）' },
      { label: '写入表格', description: '在文档章节中插入简单表格，适合测试用例与报告摘要' },
      { label: '自动创建目录', description: '输出路径不存在时自动创建父级目录' },
      { label: '路径沙箱保护', description: '读写前校验路径范围，避免访问未授权目录' },
    ],
  },

  {
    value: 'pdf-read',
    label: 'PDF 读取',
    icon: '📑',
    status: 'ready',
    summary: '从 PDF 文件中提取文本、表格与元信息',
    implementation: {
      language: 'Python 3.10+',
      libraries: ['PyMuPDF (fitz)', 'pdfplumber'],
      note: 'PyMuPDF 负责高性能文本与图片提取；pdfplumber 负责表格结构解析',
    },
    capabilities: [
      { label: '提取全文文本', description: '将 PDF 所有页面的文本合并为纯字符串输出' },
      { label: '按页读取', description: '指定起止页码，只提取目标页范围的文本内容' },
      { label: '提取表格数据', description: '识别 PDF 内的表格并转换为二维数组或 CSV' },
      { label: '读取文档元信息', description: '获取标题、作者、创建时间、总页数等元数据' },
      { label: '提取嵌入图片', description: '将 PDF 内嵌的图片导出为 PNG/JPG 文件' },
      { label: '处理多栏布局', description: '识别双栏/三栏排版并按阅读顺序重组文本' },
    ],
  },

  {
    value: 'llm-calling',
    label: 'LLM 调用',
    icon: '🤖',
    status: 'ready',
    summary: '调用已配置的 LLM 模型完成文本生成、推理与对话任务',
    implementation: {
      language: 'TypeScript + Python',
      libraries: ['llmClient.ts', 'Python requests/urllib3'],
      note:
        '总 Agent 与 Agent Runner 对话统一经 Python llm-calling 的固定 IP 网络层代理；' +
        '支持 OpenAI 兼容 / Anthropic Messages / Gemini 风格接口',
    },
    capabilities: [
      { label: '调用任意已配置模型', description: '对接模型配置中心，按 configId + modelId 路由到对应厂商' },
      { label: '系统提示词注入', description: '在请求中携带 system prompt，控制模型角色与行为边界' },
      { label: '多轮对话上下文', description: '携带历史消息列表，支持连续追问与上下文感知' },
      { label: '图片多模态输入', description: '将 base64 图片作为 vision 内容块发送给支持视觉的模型' },
      { label: '超时与取消控制', description: '内置 120s 超时，支持 AbortSignal 手动取消正在进行的请求' },
      { label: '错误分类处理', description: '区分网络错误、鉴权失败（401/403）、限流（429）并给出对应提示' },
      { label: '连接测试与延迟检测', description: '通过拉取模型列表探活，测量往返延迟并分低/高延迟档' },
    ],
  },
];

export function getToolDef(value: string): ToolDef | undefined {
  return TOOL_REGISTRY.find((t) => t.value === value);
}

// 内置工具派生的标签选项（唯一来源，供无 store 上下文的纯逻辑兜底）。
export const BUILTIN_TOOL_TAGS: { value: string; label: string }[] =
  TOOL_REGISTRY.map(({ value, label }) => ({ value, label }));

// 合并内置 + 自定义工具为标签选项（按 value 去重，内置优先）。
// 自定义工具以其 name 作为可选值，Agent 打上该标签即代表需要此工具。
export function mergeToolTags(
  custom: { name: string; description?: string }[],
): { value: string; label: string }[] {
  const seen = new Set(BUILTIN_TOOL_TAGS.map((t) => t.value));
  const merged = [...BUILTIN_TOOL_TAGS];
  for (const t of custom) {
    if (!t.name || seen.has(t.name)) continue;
    seen.add(t.name);
    merged.push({ value: t.name, label: t.name });
  }
  return merged;
}
