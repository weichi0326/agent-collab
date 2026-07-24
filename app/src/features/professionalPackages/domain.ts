import type { ModelRef } from '../../lib/modelRef';
import type {
  AgentNodeCapabilities,
  AgentNodeData,
  AgentOutputFormat,
} from '../../stores/canvasStore';

export interface ProfessionalAgentDefinition {
  id: string;
  packageId: string;
  packageName: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolTags: readonly string[];
  outputFormat: AgentOutputFormat;
  resultRole?: string;
  capabilities?: AgentNodeCapabilities;
  inputSchemaText?: string;
  outputSchemaText?: string;
}

export interface ProfessionalAgentGroup {
  packageId: string;
  packageName: string;
  agents: readonly ProfessionalAgentDefinition[];
}

export function professionalAgentNodeData(
  definition: ProfessionalAgentDefinition,
  modelRef: ModelRef | null = null,
  overrides: Partial<AgentNodeData> = {},
): AgentNodeData {
  return {
    professionalAgentId: definition.id,
    professionalPackageId: definition.packageId,
    label: definition.name,
    description: definition.description,
    systemPrompt: definition.systemPrompt,
    systemPromptSourceName: `${definition.packageName}专业包`,
    toolTags: [...definition.toolTags],
    modelRef,
    outputFormat: definition.outputFormat,
    resultRole: definition.resultRole,
    capabilities: definition.capabilities,
    inputSchemaText: definition.inputSchemaText ?? '',
    outputSchemaText: definition.outputSchemaText ?? '',
    ...overrides,
  };
}
