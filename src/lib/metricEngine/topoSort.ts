import type { MetricRegistry, NodeId, RegistryNode } from "./types";
import { sameTurnDeps } from "./types";

/**
 * Kahn topological sort over same-turn edges only. {lagged} edges read the
 * previous turn's value, so they are deliberately excluded — that is how the
 * spec breaks DAG cycles (P0 "DAG + cycles"). A residual SAME-TURN cycle is a
 * registry authoring bug and throws.
 */
export function topoSort(nodes: RegistryNode[]): RegistryNode[] {
  const byId: MetricRegistry = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map<NodeId, number>();
  const dependents = new Map<NodeId, NodeId[]>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const n of nodes) {
    for (const dep of sameTurnDeps(n.inputs)) {
      // External / not-yet-registered inputs are not ordering edges.
      if (!byId.has(dep)) continue;
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), n.id]);
    }
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: RegistryNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const d of dependents.get(id) ?? []) {
      const left = (indeg.get(d) ?? 0) - 1;
      indeg.set(d, left);
      if (left === 0) queue.push(d);
    }
  }
  if (order.length !== nodes.length) {
    const stuck = nodes.filter((n) => !order.includes(n)).map((n) => n.id);
    throw new Error(
      `metricEngine: same-turn dependency cycle among [${stuck.join(", ")}] — use a {lagged} edge`
    );
  }
  return order;
}
