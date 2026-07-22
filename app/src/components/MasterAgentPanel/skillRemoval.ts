interface SkillRemovalTarget {
  title: string;
  capabilities: string[];
}

interface SkillRemovalCopy {
  title: string;
  content: string;
  okText: string;
}

export function skillRemovalCopy(
  skill: SkillRemovalTarget,
  restore: boolean,
): SkillRemovalCopy {
  if (restore) {
    return {
      title: '恢复内置 Skill',
      content: `将移除「${skill.title}」的用户覆盖版本，并恢复应用内置内容。用户修改的能力与做事方法会丢失，内置 Skill 仍可继续使用。`,
      okText: '恢复内置版本',
    };
  }

  const capabilities = skill.capabilities.length > 0
    ? skill.capabilities.join('、')
    : '此 Skill 定义的专属工作流程';
  return {
    title: '移除 Skill',
    content: `移除「${skill.title}」后无法撤销。姬子将失去此 Skill 提供的能力：${capabilities}。`,
    okText: '确认移除',
  };
}
