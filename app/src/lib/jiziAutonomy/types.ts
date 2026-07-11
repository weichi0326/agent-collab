export type JiziAutonomyStatus =
  | 'observing'
  | 'planning'
  | 'awaiting-confirmation'
  | 'awaiting-destructive-confirmation'
  | 'executing'
  | 'verifying'
  | 'replanning'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JiziAutonomyTask {
  goal: string;
  status: JiziAutonomyStatus;
  executedSteps: number;
  currentStepRepairs: number;
  replans: number;
  destructivePlan: boolean;
  lastObservationFingerprint: string | null;
  unchangedObservations: number;
  evidence: string[];
  error?: string;
}

export type JiziAutonomyEvent =
  | { type: 'observed'; fingerprint: string }
  | { type: 'plan-ready'; destructive: boolean }
  | { type: 'confirmed' }
  | { type: 'step-succeeded'; evidence: string; count?: number }
  | { type: 'step-failed'; retryable: boolean; error: string }
  | { type: 'verified'; ok: boolean; evidence: string }
  | { type: 'replan-failed'; error: string }
  | { type: 'cancelled' };
