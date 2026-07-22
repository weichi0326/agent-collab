import { asObject } from './jsonGuards';

export interface UserChoiceOption {
  id: string;
  title: string;
  description: string;
  recommended?: boolean;
}

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
