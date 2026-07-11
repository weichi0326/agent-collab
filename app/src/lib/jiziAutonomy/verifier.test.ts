import { describe, expect, it } from 'vitest';
import type { JiziProjectObservation } from '../jiziProjectObservation';
import { verifyPlanStep } from './verifier';

function observation(): JiziProjectObservation {
  return {
    activeCanvasId: 'canvas-1',
    activeCanvas: null,
    canvases: [{
      id: 'canvas-1', name: '研究画布', readOnly: false, runId: null,
      run: { status: 'success', message: '完成' }, nodes: [], edges: [],
    }],
    agents: [{
      id: 'agent-1', name: '研究助手', description: '检索资料',
      systemPrompt: '核对来源', toolTags: ['file'], modelRef: null,
      inputSchemaText: '', outputSchemaText: '',
    }],
    models: [], selectedMasterModel: null,
    tools: [{ name: 'file', description: '', tags: ['file'], dependencies: [], builtin: true, internal: false, loadError: null }],
    serviceStatus: 'running', searchProviderIds: [], enabledSkillIds: [],
  };
}

describe('verifyPlanStep', () => {
  it('verifies canvas creation, Agent updates, and deletion from observed state', () => {
    const state = observation();
    expect(verifyPlanStep({ type: 'create-canvas', name: '研究画布' }, state).ok).toBe(true);
    expect(verifyPlanStep({
      type: 'update-agent', agentId: 'agent-1', patch: { systemPrompt: '核对来源', toolTags: ['file'] },
    }, state).ok).toBe(true);
    expect(verifyPlanStep({ type: 'delete-canvas', canvasId: 'old-canvas' }, state).ok).toBe(true);
  });

  it('uses actual run state and reports failed evidence', () => {
    const state = observation();
    expect(verifyPlanStep({ type: 'run-active-canvas' }, state).ok).toBe(true);
    state.canvases[0].run = { status: 'failed', message: 'timeout' };
    state.activeCanvas = state.canvases[0];
    const result = verifyPlanStep({ type: 'run-active-canvas' }, state);
    expect(result.ok).toBe(false);
    expect(result.evidence).toContain('timeout');
  });
});
