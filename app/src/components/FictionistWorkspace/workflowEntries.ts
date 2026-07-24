import type { ProfessionalTask } from '../../features/professionalTasks/domain';
import { FICTIONIST_PACKAGE_ID } from '../../features/fictionist/continuation';
import type {
  Canvas,
  SavedCanvas,
} from '../../stores/canvasStore';

export interface FictionWorkflowEntry {
  id: string;
  name: string;
  savedId?: string;
  canvasId?: string;
  savedAt?: string;
  nodeCount: number;
  taskCanvas?: boolean;
  systemWorkflow?: {
    key: string;
    version: 1 | 2;
  };
  locked?: boolean;
  legacyProjectId?: string;
}

interface FictionWorkflowSources {
  savedCanvases: SavedCanvas[];
  openCanvases: Canvas[];
  professionalTasks?: Record<string, ProfessionalTask>;
  projectId?: string | null;
}

export function buildFictionWorkflowEntries({
  savedCanvases,
  openCanvases,
}: FictionWorkflowSources): FictionWorkflowEntry[] {
  const entries = new Map<string, FictionWorkflowEntry>();
  const addSaved = (saved: SavedCanvas) => {
    const ref = saved.workflowRef;
    if (saved.origin
      || !ref
      || ref.packageId !== FICTIONIST_PACKAGE_ID
      || ref.sourceWorkflow
      || (ref.systemWorkflow && ref.projectId !== undefined)) return;
    entries.set(ref.workflowId, {
      id: ref.workflowId,
      name: saved.name,
      savedId: saved.id,
      savedAt: saved.savedAt,
      nodeCount: saved.nodes.length,
      systemWorkflow: ref.systemWorkflow,
      locked: ref.systemWorkflow?.version === 2,
      legacyProjectId: ref.systemWorkflow ? undefined : ref.projectId,
    });
  };
  const addOpen = (canvas: Canvas) => {
    const ref = canvas.workflowRef;
    if (canvas.origin
      || !ref
      || ref.packageId !== FICTIONIST_PACKAGE_ID
      || ref.sourceWorkflow
      || (ref.systemWorkflow && ref.projectId !== undefined)
      || canvas.runId) return;
    const existing = entries.get(ref.workflowId);
    entries.set(ref.workflowId, {
      id: ref.workflowId,
      name: canvas.name,
      savedId: canvas.savedId ?? existing?.savedId,
      canvasId: canvas.id,
      savedAt: existing?.savedAt,
      nodeCount: canvas.nodes.length,
      systemWorkflow: ref.systemWorkflow ?? existing?.systemWorkflow,
      locked: ref.systemWorkflow?.version === 2 || existing?.locked,
      legacyProjectId: ref.systemWorkflow ? undefined : ref.projectId,
    });
  };
  savedCanvases.forEach(addSaved);
  openCanvases.forEach(addOpen);
  return Array.from(entries.values()).sort((left, right) =>
    (right.savedAt ?? '').localeCompare(left.savedAt ?? '')
    || left.name.localeCompare(right.name, 'zh-CN'));
}
