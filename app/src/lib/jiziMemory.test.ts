import { describe, expect, it } from 'vitest';
import { parseMemoryDraft, parseRelevantMemoryReply } from './jiziMemory';

describe('parseMemoryDraft', () => {
  it('parses memory arrays', () => {
    const draft = parseMemoryDraft(
      JSON.stringify({
        profile: ['non technical user'],
        preferences: ['plain language answers'],
        resources: ['multi agent canvas app'],
      }),
    );

    expect(draft).toEqual({
      profile: ['non technical user'],
      preferences: ['plain language answers'],
      resources: ['multi agent canvas app'],
    });
  });

  it('accepts fenced json and drops empty items', () => {
    const draft = parseMemoryDraft(
      '```json\n{"profile":[""],"preferences":["no keyword matching"],"resources":[]}\n```',
    );

    expect(draft).toEqual({
      profile: [],
      preferences: ['no keyword matching'],
      resources: [],
    });
  });
});

describe('parseRelevantMemoryReply', () => {
  const candidates = [
    { id: 'm1', kind: 'profile' as const, text: 'non technical user' },
    { id: 'm2', kind: 'preferences' as const, text: 'plain language answers' },
    { id: 'm3', kind: 'resources' as const, text: 'multi agent canvas app' },
  ];

  it('keeps valid model-selected memory ids in order', () => {
    const selected = parseRelevantMemoryReply(
      '{"selected":["m2","unknown","m1","m2"]}',
      candidates,
      10,
    );
    expect(selected).toEqual(['plain language answers', 'non technical user']);
  });

  it('respects the memory selection limit', () => {
    const selected = parseRelevantMemoryReply(
      '{"selected":["m1","m2","m3"]}',
      candidates,
      2,
    );
    expect(selected).toEqual(['non technical user', 'plain language answers']);
  });
});