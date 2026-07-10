import type { ModelCaps } from '../stores/modelStore';

const VISION_HINTS = [
  'vision',
  'visual',
  'vl',
  'omni',
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'gemini',
  'claude-3',
  'claude-4',
  'qwen-vl',
  'qvq',
  'internvl',
  'llava',
  'glm-4v',
];

const LONG_CONTEXT_HINTS = [
  '1m',
  '1-million',
  'long',
  '128k',
  '200k',
  '256k',
  '1m-context',
  'gemini-1.5',
  'gemini-2',
  'claude-3',
  'claude-4',
  'gpt-4.1',
  'gpt-5',
  'qwen-long',
  'mimo-v2.5',
];

const AUDIO_HINTS = ['audio', 'realtime', 'omni', 'gpt-4o-audio', 'gemini-live'];

function hasHint(modelId: string, hints: string[]): boolean {
  const id = modelId.toLowerCase();
  return hints.some((hint) => id.includes(hint));
}

export function inferModelCaps(modelId: string): ModelCaps {
  const id = modelId.toLowerCase();
  if (id.includes('mimo-v2.5-pro')) {
    return { longContext: true, vision: false, audio: false };
  }
  if (id === 'mimo-v2.5' || id.includes('mimo-v2.5-omni')) {
    return { longContext: true, vision: true, audio: true };
  }
  return {
    longContext: hasHint(modelId, LONG_CONTEXT_HINTS),
    vision: hasHint(modelId, VISION_HINTS),
    audio: hasHint(modelId, AUDIO_HINTS),
  };
}

export function mergeInferredModelCaps(current: ModelCaps | undefined, modelId: string): ModelCaps {
  const inferred = inferModelCaps(modelId);
  return {
    longContext: current?.longContext || inferred.longContext,
    vision: current?.vision || inferred.vision,
    audio: current?.audio || inferred.audio,
  };
}
