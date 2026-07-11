export interface JiziTransactionResult {
  ok: boolean;
  completedSteps: number;
  failedStep?: number;
  error?: string;
  rollback: 'not-needed' | 'succeeded' | 'partial' | 'failed';
  rollbackDetails: string[];
}

interface StepTransactionOptions<TStep, TSnapshot> {
  steps: TStep[];
  capture: () => TSnapshot | Promise<TSnapshot>;
  execute: (step: TStep, index: number) => void | Promise<void>;
  restore: (snapshot: TSnapshot) => void | Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executeStepTransaction<TStep, TSnapshot>(
  options: StepTransactionOptions<TStep, TSnapshot>,
): Promise<JiziTransactionResult> {
  const snapshot = await options.capture();
  let completedSteps = 0;
  for (let index = 0; index < options.steps.length; index += 1) {
    try {
      await options.execute(options.steps[index], index);
      completedSteps += 1;
    } catch (error) {
      const originalError = errorText(error);
      try {
        await options.restore(snapshot);
        return {
          ok: false,
          completedSteps,
          failedStep: index,
          error: originalError,
          rollback: 'succeeded',
          rollbackDetails: ['已恢复执行前状态。'],
        };
      } catch (restoreError) {
        return {
          ok: false,
          completedSteps,
          failedStep: index,
          error: originalError,
          rollback: 'failed',
          rollbackDetails: [errorText(restoreError)],
        };
      }
    }
  }
  return {
    ok: true,
    completedSteps,
    rollback: 'not-needed',
    rollbackDetails: [],
  };
}
