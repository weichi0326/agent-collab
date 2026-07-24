import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import { NODE_PORTS } from './nodePorts';

const canvasSource = readFileSync(new URL('../CanvasArea.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../App.css', import.meta.url), 'utf8');

describe('NODE_PORTS', () => {
  it('defines exactly one spatial port on each side of a node', () => {
    expect(NODE_PORTS).toEqual([
      { id: 'port-left', position: Position.Left },
      { id: 'port-right', position: Position.Right },
      { id: 'port-top', position: Position.Top },
      { id: 'port-bottom', position: Position.Bottom },
    ]);
    expect(new Set(NODE_PORTS.map((port) => port.id)).size).toBe(4);
  });
});

describe('node port interaction', () => {
  it('uses loose connection mode so every port can start or receive an edge', () => {
    expect(canvasSource).toContain('connectionMode={ConnectionMode.Loose}');
  });

  it('hides ports by default and shows them on hover or node selection', () => {
    expect(styles).toMatch(
      /\.agent-node__handle\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s,
    );
    expect(styles).toContain(':is(.agent-node, .gate-node, .timer-node):hover .agent-node__handle');
    expect(styles).toContain('.agent-node--selected .agent-node__handle');
    expect(styles).toContain('.gate-node--selected .agent-node__handle');
    expect(styles).toContain('.timer-node--selected .agent-node__handle');
    expect(styles).toMatch(/opacity:\s*1;[^}]*pointer-events:\s*all;/s);
  });

  it('keeps node inspection clickable on read-only canvases', () => {
    expect(canvasSource).toContain('const onNodeClick = useCallback');
    expect(canvasSource).toContain('if (!currentCanvas?.readOnly) return;');
    expect(canvasSource).toContain('onNodeClick={onNodeClick}');
  });
});
