import { cleanJsonFence } from '../masterPlanner';

export type FailureCategory =
  | 'missing-tool'
  | 'tool-parameters'
  | 'node-configuration'
  | 'missing-input'
  | 'model-call'
  | 'network-or-service'
  | 'unknown';

export interface FailureDiagnosis {
  category: FailureCategory;
  confidence: number;
  evidence: string;
  summary: string;
  capability: string;
  suggestedQuery: string;
  reason: string;
  consequence: string;
  fixCost: string;
  nextStep: string;
  severity: string;
  likelyCause: string;
  worthFixing: string;
}

const CATEGORIES = new Set<FailureCategory>([
  'missing-tool',
  'tool-parameters',
  'node-configuration',
  'missing-input',
  'model-call',
  'network-or-service',
  'unknown',
]);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function unknownFailureDiagnosis(): FailureDiagnosis {
  return {
    category: 'unknown',
    confidence: 0,
    evidence: '',
    summary: '',
    capability: '',
    suggestedQuery: '',
    reason: '',
    consequence: '',
    fixCost: '',
    nextStep: '',
    severity: '',
    likelyCause: '',
    worthFixing: '',
  };
}

export function parseFailureDiagnosis(reply: string): FailureDiagnosis {
  try {
    const parsed = JSON.parse(cleanJsonFence(reply));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return unknownFailureDiagnosis();
    }
    const value = parsed as Record<string, unknown>;
    const rawCategory = text(value.category);
    const category = CATEGORIES.has(rawCategory as FailureCategory)
      ? (rawCategory as FailureCategory)
      : 'unknown';
    const rawConfidence = value.confidence;
    const confidence =
      typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
        ? Math.max(0, Math.min(1, rawConfidence))
        : 0;
    const diagnosis: FailureDiagnosis = {
      category,
      confidence,
      evidence: text(value.evidence),
      summary: text(value.summary),
      capability: text(value.capability),
      suggestedQuery: text(value.suggestedQuery),
      reason: text(value.reason),
      consequence: text(value.consequence),
      fixCost: text(value.fixCost),
      nextStep: text(value.nextStep),
      severity: text(value.severity),
      likelyCause: text(value.likelyCause),
      worthFixing: text(value.worthFixing),
    };
    if (
      diagnosis.category === 'missing-tool' &&
      (diagnosis.confidence < 0.7 || !diagnosis.evidence)
    ) {
      return unknownFailureDiagnosis();
    }
    return diagnosis;
  } catch {
    return unknownFailureDiagnosis();
  }
}
