export const SKILL_INSTRUCTION_CHAR_LIMIT = 20_000;
export const SKILL_DESCRIPTION_CHAR_LIMIT = 1_000;
export const SKILL_TITLE_CHAR_LIMIT = 100;
export const SKILL_CAPABILITY_CHAR_LIMIT = 100;
export const SKILL_CAPABILITY_MIN = 3;
export const SKILL_CAPABILITY_MAX = 8;

export type JiziSkillCategory = 'workflow' | 'tool' | 'diagnosis' | 'model' | 'skill';

export interface ParsedSkillDocument {
  frontmatter: string;
  body: string;
}

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function sliceUnicode(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}

export function normalizeSkillId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generatedSkillId(seed: string): string {
  return `jz-${hashText(seed).slice(0, 8)}`;
}

export function parseSkillDocument(text: string): ParsedSkillDocument | null {
  const match = text.trim().match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return null;
  return {
    frontmatter: match[1] ?? '',
    body: (match[2] ?? '').trim(),
  };
}

function unquoteFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

export function skillFrontmatterValue(frontmatter: string, key: string): string {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  if (index < 0) return '';
  const line = lines[index]!;
  const raw = line.slice(line.indexOf(':') + 1).trim();
  if (!['|', '>', '|-', '>-'].includes(raw)) {
    return unquoteFrontmatterValue(raw);
  }

  const values: string[] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const next = lines[i]!;
    if (next && !/^\s/.test(next)) break;
    values.push(next.replace(/^\s{1,4}/, ''));
  }
  return (raw.startsWith('>') ? values.join(' ').replace(/\s+/g, ' ') : values.join('\n')).trim();
}

export function skillFrontmatterList(frontmatter: string, key: string): string[] {
  const raw = skillFrontmatterValue(frontmatter, key);
  if (raw) {
    if (raw.startsWith('[') && raw.endsWith(']')) {
      return raw.slice(1, -1)
        .split(',')
        .map((item) => unquoteFrontmatterValue(item))
        .filter(Boolean);
    }
    return raw.split('|').map((item) => item.trim()).filter(Boolean);
  }

  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
  if (index < 0) return [];
  const values: string[] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const match = lines[i]!.match(/^\s+-\s+(.+)$/);
    if (!match) break;
    values.push(unquoteFrontmatterValue(match[1]!));
  }
  return values;
}

export function assertSkillTextLimits(input: {
  title?: string;
  description: string;
  capabilities?: string[];
  instructions: string;
}): void {
  if (input.title && unicodeLength(input.title.trim()) > SKILL_TITLE_CHAR_LIMIT) {
    throw new Error(`skill 名称过长，请控制在 ${SKILL_TITLE_CHAR_LIMIT} 个字符以内`);
  }
  if (unicodeLength(input.description.trim()) > SKILL_DESCRIPTION_CHAR_LIMIT) {
    throw new Error(`skill 描述过长，请控制在 ${SKILL_DESCRIPTION_CHAR_LIMIT} 个字符以内`);
  }
  if (unicodeLength(input.instructions.trim()) > SKILL_INSTRUCTION_CHAR_LIMIT) {
    throw new Error(`skill 正文过长，请控制在 ${SKILL_INSTRUCTION_CHAR_LIMIT} 个字符以内`);
  }
  if (input.capabilities) {
    if (
      input.capabilities.length < SKILL_CAPABILITY_MIN ||
      input.capabilities.length > SKILL_CAPABILITY_MAX
    ) {
      throw new Error(`skill 具体能力应保持在 ${SKILL_CAPABILITY_MIN}-${SKILL_CAPABILITY_MAX} 条`);
    }
    if (
      input.capabilities.some(
        (item) => unicodeLength(item.trim()) > SKILL_CAPABILITY_CHAR_LIMIT,
      )
    ) {
      throw new Error(`skill 单条能力请控制在 ${SKILL_CAPABILITY_CHAR_LIMIT} 个字符以内`);
    }
  }
}
