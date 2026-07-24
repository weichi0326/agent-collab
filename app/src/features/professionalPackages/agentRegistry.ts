import { FICTIONIST_AGENTS } from '../fictionist/agents';
import { FICTIONIST_PACKAGE_ID, FICTIONIST_PACKAGE_NAME } from '../fictionist/package';
import type { ProfessionalAgentDefinition, ProfessionalAgentGroup } from './domain';

// 小说家目前随 fictionist 分支内置。未来包安装器只需把已启用包注册到这里，
// Agent 库和画布拖放逻辑不需要了解具体专业包。
export const INSTALLED_PROFESSIONAL_AGENT_GROUPS: readonly ProfessionalAgentGroup[] = [
  {
    packageId: FICTIONIST_PACKAGE_ID,
    packageName: FICTIONIST_PACKAGE_NAME,
    agents: FICTIONIST_AGENTS,
  },
];

const AGENT_BY_ID = new Map(
  INSTALLED_PROFESSIONAL_AGENT_GROUPS.flatMap((group) => group.agents)
    .map((agent) => [agent.id, agent]),
);

export function findProfessionalAgent(id: string): ProfessionalAgentDefinition | undefined {
  return AGENT_BY_ID.get(id);
}
