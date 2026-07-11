export type JiziEvaluationCategory =
  | 'canvas'
  | 'agent'
  | 'tool'
  | 'recovery'
  | 'search'
  | 'memory'
  | 'correction'
  | 'cancellation'
  | 'rollback';

export interface JiziEvaluationCase {
  id: string;
  category: JiziEvaluationCategory;
  goal: string;
  expectedTerminalStatus: 'completed' | 'failed' | 'cancelled';
  expectedEvidenceCode: string;
  maxSteps: number;
  requiresConfirmation: boolean;
  requiresSecondConfirmation: boolean;
}
