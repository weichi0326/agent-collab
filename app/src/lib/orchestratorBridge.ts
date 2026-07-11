import type { ReportInput } from './orchestrator/diagnosis';

interface OrchestratorBridgeHandlers {
  reportNodeFailure: (input: ReportInput) => void;
  clearDiagnosedForRun: (runId: string) => void;
  revertToFailed: (incidentId: string) => void;
  recordToolInstalled: () => void;
  onToolInstalled: (incidentId: string, sessionId: string) => void | Promise<void>;
  finalizeRepair: (incidentId: string, ok: boolean) => void;
}

let handlers: OrchestratorBridgeHandlers | undefined;

export function registerOrchestratorBridge(
  nextHandlers: OrchestratorBridgeHandlers,
): void {
  handlers = nextHandlers;
}

function reportBridgeError(operation: string, error: unknown): void {
  console.error(`[orchestratorBridge] ${operation} failed`, error);
}

export function reportNodeFailureToOrchestrator(input: ReportInput): void {
  try {
    handlers?.reportNodeFailure(input);
  } catch (error) {
    reportBridgeError('reportNodeFailure', error);
  }
}

export function clearOrchestratorRunDiagnosis(runId: string): void {
  try {
    handlers?.clearDiagnosedForRun(runId);
  } catch (error) {
    reportBridgeError('clearDiagnosedForRun', error);
  }
}

export function revertOrchestratorIncident(incidentId: string): void {
  try {
    handlers?.revertToFailed(incidentId);
  } catch (error) {
    reportBridgeError('revertToFailed', error);
  }
}

export function recordOrchestratorToolInstalled(
  incidentId: string | undefined,
  sessionId: string,
): void {
  try {
    handlers?.recordToolInstalled();
    if (handlers && incidentId) {
      void Promise.resolve(handlers.onToolInstalled(incidentId, sessionId)).catch(
        (error) => reportBridgeError('onToolInstalled', error),
      );
    }
  } catch (error) {
    reportBridgeError('recordToolInstalled', error);
  }
}

export function finalizeOrchestratorRepair(
  incidentId: string,
  ok: boolean,
): void {
  try {
    handlers?.finalizeRepair(incidentId, ok);
  } catch (error) {
    reportBridgeError('finalizeRepair', error);
  }
}
