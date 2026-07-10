import type { Node } from '@xyflow/react';
import type { AgentNodeData } from '../../stores/canvasStore';
import type { JsonObject, JsonSchema } from './types';

export function schemaTextFromNode(
  node: Node,
  key: 'inputSchemaText' | 'outputSchemaText',
): string {
  const value = (node.data as AgentNodeData)[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function parseSchemaText(text: string, label: string): JsonSchema | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonSchema;
    }
  } catch {
    // The caller needs a concise, user-visible reason.
  }
  throw new Error(`节点「${label}」的 JSON Schema 不是合法 JSON 对象`);
}

function schemaType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(value: unknown, expected: unknown): boolean {
  const current = schemaType(value);
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => {
    if (type === 'number') return current === 'number' || current === 'integer';
    return type === current;
  });
}

export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path = '$',
): string[] {
  const errors: string[] = [];
  const expectedType = schema.type;
  if (expectedType && !typeMatches(value, expectedType)) {
    const expected = Array.isArray(expectedType) ? expectedType.join('|') : String(expectedType);
    errors.push(`${path} 类型应为 ${expected}`);
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} 不在 enum 允许值内`);
  }
  if (schema.const !== undefined && !Object.is(schema.const, value)) {
    errors.push(`${path} 不等于 const 指定值`);
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const objectValue = value as JsonObject;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === 'string' && objectValue[key] === undefined) {
        errors.push(`${path}.${key} 缺失`);
      }
    }
    const properties =
      schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (objectValue[key] === undefined) continue;
      if (childSchema && typeof childSchema === 'object' && !Array.isArray(childSchema)) {
        errors.push(...validateAgainstSchema(objectValue[key], childSchema as JsonSchema, `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(item, schema.items as JsonSchema, `${path}[${index}]`));
    });
  }

  return errors;
}

export function assertCustomSchema(
  value: unknown,
  schema: JsonSchema | undefined,
  label: string,
  kind: string,
): void {
  if (!schema) return;
  const errors = validateAgainstSchema(value, schema);
  if (errors.length > 0) {
    throw new Error(`节点「${label}」${kind}不符合 schema：${errors.slice(0, 8).join('；')}`);
  }
}
