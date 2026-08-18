import type { NodeSpec } from "../nodes";

/** Decade id → six NodeSpecs (slots 10–15 positionally). */
export type V3LaneContent = Record<string, NodeSpec[]>;
