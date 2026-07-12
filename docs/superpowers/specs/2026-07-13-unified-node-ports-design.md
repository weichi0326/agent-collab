# Unified Node Ports Design

## Scope

Every agent, gate, and timer node exposes four spatial ports: left, right, top, and bottom. A port has no fixed input/output role. The node where a drag starts is the edge source, the node where it ends is the edge target, and the arrow communicates direction.

## Connection Model

Use React Flow `ConnectionMode.Loose` so the same handle can start or receive a connection. Replace the duplicated source/target routing handles with four unified ids: `port-left`, `port-right`, `port-top`, and `port-bottom`. Dynamic routing chooses these same ids according to node geometry. Existing cycle, duplicate-edge, and endpoint validation remains unchanged because it already evaluates edge source and target node ids.

## Visibility

All four ports are hidden by default with opacity and pointer events disabled. They become visible and connectable when the node root is hovered or selected. The rule applies identically to agent, gate, and timer nodes. A short opacity/scale transition keeps the appearance smooth without delaying pointer availability.

## Compatibility

Stored edge handle ids are not migrated because `routeEdgesForNodes` derives and replaces handle ids whenever edges are rendered. Node and edge persistence schemas remain unchanged.

## Tests

Tests verify that the shared port definition contains exactly four unique spatial handles, dynamic routing selects the new ids in all directions, the canvas enables loose connection mode, and CSS contains hidden/default plus hover/selected visible states. The full test, lint, build, and browser checks remain required.
