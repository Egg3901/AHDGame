import { topoSort } from "../topoSort";
import type { RegistryNode } from "../types";
import { ECONOMIC_NODES } from "./economic";
import { EDUCATION_NODES } from "./education";
import { ENVIRONMENT_NODES } from "./environment";
import { GOVERNANCE_NODES } from "./governance";
import { HEALTHCARE_NODES } from "./healthcare";
import { INFRASTRUCTURE_NODES } from "./infrastructure";
import { MEDIA_INFORMATION_NODES } from "./mediaInformation";
import { PUBLIC_SAFETY_NODES } from "./publicSafety";
import { SOCIAL_NODES } from "./social";

/** All registry nodes. P0 ports gdpGrowth + unemployment; P1+ append more. */
export const METRIC_REGISTRY: RegistryNode[] = [
  ...ECONOMIC_NODES,
  ...EDUCATION_NODES,
  ...ENVIRONMENT_NODES,
  ...GOVERNANCE_NODES,
  ...HEALTHCARE_NODES,
  ...INFRASTRUCTURE_NODES,
  ...MEDIA_INFORMATION_NODES,
  ...PUBLIC_SAFETY_NODES,
  ...SOCIAL_NODES,
];

/**
 * Topo-sorted once at module load so the per-turn phase doesn't re-sort for
 * every state (perf — spec R4). Throws at import time if the registry has a
 * same-turn cycle (an authoring bug), failing fast rather than mid-turn.
 */
export const METRIC_REGISTRY_SORTED: RegistryNode[] = topoSort(METRIC_REGISTRY);
