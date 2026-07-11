import type { AgentOutputFormat } from '../../stores/canvasStore';
import type { MasterAction, MasterPlanStep } from './types';

export function describeMasterAction(action: MasterAction): string {
  switch (action.type) {
    case 'run-active-canvas':
      return '运行当前画布';
    case 'rerun-canvas-node':
      return '就地重跑失败节点及其下游';
    case 'create-canvas':
      return action.name ? `创建画布「${action.name}」` : '创建一个新画布';
    case 'create-workflow-canvas':
      return `创建画布「${action.name ?? '新画布'}」并放入 ${action.nodes.length} 个节点${action.connectSequential ? '，按顺序连接' : ''}`;
    case 'rename-active-canvas':
      return `把当前画布重命名为「${action.name}」`;
    case 'create-agent':
      return `创建 Agent「${action.name}」`;
    case 'create-tool': {
      const deps = action.dependencies.length
        ? `，依赖 ${action.dependencies.join('、')}`
        : '，无第三方依赖';
      return `生成并安装工具「${action.name}」${deps}。请审阅下方完整代码后确认，安装即会落盘并装依赖。`;
    }
    case 'plan':
      return action.summary || `执行 ${action.steps.length} 步操作计划`;
  }
}

function outputFormatLabel(format?: AgentOutputFormat): string {
  switch (format) {
    case 'docx':
      return 'Word';
    case 'xlsx':
      return 'Excel';
    case 'mindmap':
      return '思维导图';
    case 'markdown':
      return 'Markdown';
    default:
      return '';
  }
}

function describePlanStep(step: MasterPlanStep): string {
  switch (step.type) {
    case 'create-canvas':
      return step.name ? `创建画布「${step.name}」` : '创建新画布';
    case 'rename-active-canvas':
      return `重命名当前画布为「${step.name}」`;
    case 'create-agent':
      return `创建 Agent「${step.name}」`;
    case 'add-node': {
      const format = outputFormatLabel(step.outputFormat);
      return `添加节点「${step.label}」${format ? `，输出格式为 ${format}` : ''}`;
    }
    case 'connect-nodes':
      return `连接「${step.source}」→「${step.target}」`;
    case 'delete-node':
      return `删除节点「${step.label}」`;
    case 'set-node-output-format':
      return `把「${step.label}」输出格式改为 ${outputFormatLabel(step.outputFormat)}`;
    case 'update-agent':
      return `修改 Agent [${step.agentId}] 的 ${Object.keys(step.patch).join('、')}`;
    case 'update-node-agent-config':
      return `修改画布 [${step.canvasId}] 节点 [${step.nodeId}] 的 ${Object.keys(step.patch).join('、')}`;
    case 'delete-canvas':
      return `删除画布 [${step.canvasId}]，删除前需要再次确认`;
    case 'overwrite-tool':
      return `覆盖自定义工具「${step.payload.name}」`;
    case 'delete-tool':
      return `删除自定义工具「${step.toolName}」，删除前需要再次确认`;
    case 'run-active-canvas':
      return '运行当前画布';
  }
}

export function masterActionItems(action: MasterAction): string[] {
  if (action.type === 'plan') return action.steps.map(describePlanStep);
  return [describeMasterAction(action)];
}

export function actionRiskNotice(action: MasterAction): string | null {
  switch (action.type) {
    case 'create-tool':
      return '风险提示：安装工具会把 Python 代码写入本机项目，并可能安装依赖库。请确认代码没有读取私人文件、删除文件、上传密钥或访问陌生网络。';
    case 'run-active-canvas':
    case 'rerun-canvas-node':
      return '风险提示：运行画布会调用模型和工具，可能消耗 token、读写产物文件，失败时会留下错误记录。';
    case 'plan':
      return '风险提示：确认后姬子会按计划修改当前项目里的画布或 Agent 配置，请先看清每一步是否符合你的意图。';
    case 'create-canvas':
    case 'create-workflow-canvas':
    case 'create-agent':
    case 'rename-active-canvas':
      return '风险提示：这会修改当前工作区配置，但通常可以再手动改回。';
    default:
      return null;
  }
}
