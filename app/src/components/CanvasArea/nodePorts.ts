import { Position } from '@xyflow/react';

export const NODE_PORTS = [
  { id: 'port-left', position: Position.Left },
  { id: 'port-right', position: Position.Right },
  { id: 'port-top', position: Position.Top },
  { id: 'port-bottom', position: Position.Bottom },
] as const;
