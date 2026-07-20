import { asObject } from './jsonGuards';
import { cleanJsonFence } from './masterPlanner';

export interface UserChoiceOption {
  id: string;
  title: string;
  description: string;
  recommended?: boolean;
}

export type JiziIntentDecision =
  | { kind: 'generate-tool'; requirement: string; reason: string }
  | {
      kind: 'ask-choice';
      title: string;
      summary: string;
      options: UserChoiceOption[];
      customPlaceholder: string;
    }
  | { kind: 'system-check'; reason: string }
  | { kind: 'chat'; reason: string };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeChoiceOptions(value: unknown): UserChoiceOption[] {
  const rawOptions = Array.isArray(value) ? value : [];
  const options = rawOptions
    .map((item, index): UserChoiceOption | null => {
      const obj = asObject(item);
      if (!obj) return null;
      const title = textValue(obj.title);
      const description = textValue(obj.description);
      if (!title || !description) return null;
      return {
        id: textValue(obj.id) || `option-${index + 1}`,
        title,
        description,
        recommended: obj.recommended === true,
      };
    })
    .filter((item): item is UserChoiceOption => !!item)
    .slice(0, 4);

  if (options.length > 0 && !options.some((option) => option.recommended)) {
    options[0] = { ...options[0], recommended: true };
  }
  return options.sort(
    (a, b) => Number(!!b.recommended) - Number(!!a.recommended),
  );
}

export function parseJiziIntentDecision(reply: string): JiziIntentDecision {
  const root = asObject(JSON.parse(cleanJsonFence(reply)));
  const kind = textValue(root?.kind);
  const reason = textValue(root?.reason);

  if (kind === 'generate-tool') {
    const requirement = textValue(root?.requirement);
    if (requirement) return { kind, requirement, reason };
  }

  if (kind === 'ask-choice') {
    const options = normalizeChoiceOptions(root?.options);
    if (options.length >= 2) {
      return {
        kind,
        title: textValue(root?.title) || '请选择一种处理方式',
        summary: textValue(root?.summary),
        options,
        customPlaceholder:
          textValue(root?.customPlaceholder) || '输入你的自定义方案',
      };
    }
  }

  if (kind === 'system-check') {
    return { kind, reason };
  }

  return { kind: 'chat', reason };
}
