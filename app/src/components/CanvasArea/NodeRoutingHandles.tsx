import { Handle } from '@xyflow/react';
import { NODE_PORTS } from './nodePorts';

export function NodeRoutingHandles() {
  return (
    <>
      {NODE_PORTS.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={port.position}
          className="agent-node__handle"
        />
      ))}
    </>
  );
}
