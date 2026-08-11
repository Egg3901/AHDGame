import type { CrisisDecisionNode } from "@/lib/db/types/crisis";

/**
 * Render a crisis interaction's resolutionPath as human-readable narrative
 * lines: one "<node title>: <option label>" per chosen option. Path entries
 * that are terminal node IDs (pushed by the engine on resolve) carry no option
 * and are skipped. An unrecognized step falls back to its raw string so nothing
 * silently disappears.
 */
export function buildDecisionHistory(
  decisionTree: CrisisDecisionNode[],
  resolutionPath: string[]
): string[] {
  const lines: string[] = [];
  for (const step of resolutionPath) {
    const owningNode = decisionTree.find((n) => n.options?.some((o) => o.optionId === step));
    if (!owningNode) {
      // A terminal node ID in the path has no owning option — skip it.
      if (decisionTree.some((n) => n.nodeId === step && n.type === "terminal")) continue;
      lines.push(step);
      continue;
    }
    const option = owningNode.options?.find((o) => o.optionId === step);
    lines.push(`${owningNode.title}: ${option?.label ?? step}`);
  }
  return lines;
}
