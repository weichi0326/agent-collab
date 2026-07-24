import { FICTIONIST_PACKAGE_ID } from '../features/fictionist/package';
import type { Canvas } from '../stores/canvasStore';

export const FICTIONIST_TABS_DEFAULT_EXPANDED = false;

type PackageCanvas = Pick<Canvas, 'name' | 'origin' | 'workflowRef'>;

export function isFictionistCanvas(canvas: PackageCanvas): boolean {
  return canvas.origin?.packageId === FICTIONIST_PACKAGE_ID
    || canvas.workflowRef?.packageId === FICTIONIST_PACKAGE_ID;
}

export function fictionistCanvasDisplayName(canvas: PackageCanvas): string {
  const name = canvas.name.replaceAll('AI 起草本章', 'AI 起草');
  const systemWorkflow = canvas.workflowRef?.systemWorkflow;
  if (!systemWorkflow || canvas.workflowRef?.packageId !== FICTIONIST_PACKAGE_ID) return name;
  const baseName = name.replace(
    /\s*·\s*(?:[12]\s*号)?(?:主|备用|保底)流程$/u,
    '',
  );
  return `${baseName} · ${systemWorkflow.version === 1 ? '主流程' : '备用流程'}`;
}

export function partitionCanvasTabs<T extends PackageCanvas>(canvases: readonly T[]): {
  ordinary: T[];
  fictionist: T[];
} {
  const ordinary: T[] = [];
  const fictionist: T[] = [];
  canvases.forEach((canvas) => {
    (isFictionistCanvas(canvas) ? fictionist : ordinary).push(canvas);
  });
  return { ordinary, fictionist };
}
