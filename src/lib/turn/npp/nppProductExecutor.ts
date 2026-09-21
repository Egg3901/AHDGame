import type { Db } from "mongodb";
import {
  addOperatingModelPersistent,
  retireProductPersistent,
  startProductPersistent,
} from "@/lib/products/persistence";
import type { NppProductAction } from "./nppProductDecision";

export type NppProductExecutionResult =
  | { kind: "noop" }
  | { kind: "operating_model"; ok: boolean }
  | { kind: "product_started"; ok: boolean }
  | { kind: "product_retired"; ok: boolean };

/**
 * Executes one already-gated V4+ product intent through the same atomic,
 * idempotent persistence commands used by player routes. The deterministic
 * product id makes a repeated turn safe after an interrupted response.
 */
export async function executeNppProductDecision(
  db: Db,
  args: {
    enabled: boolean;
    corporationId: string;
    turn: number;
    decision?: NppProductAction;
  }
): Promise<NppProductExecutionResult> {
  const decision = args.decision;
  if (
    !args.enabled ||
    !decision ||
    decision.kind === "none" ||
    decision.kind === "continue_product"
  ) {
    return { kind: "noop" };
  }

  if (decision.kind === "acquire_operating_model") {
    const result = await addOperatingModelPersistent(db, {
      enabled: true,
      corporationId: args.corporationId,
      operatingModel: decision.operatingModel,
      turn: args.turn,
    });
    return { kind: "operating_model", ok: result.ok };
  }

  if (decision.kind === "retire_product") {
    const result = await retireProductPersistent(db, {
      productId: decision.productId,
      turn: args.turn,
    });
    return { kind: "product_retired", ok: result.ok };
  }

  const result = await startProductPersistent(db, {
    enabled: true,
    draft: {
      id: `npp:${args.corporationId}:${args.turn}:${decision.kindId}`,
      corporationId: args.corporationId,
      kindId: decision.kindId,
      name: decision.name,
      startedTurn: args.turn,
    },
  });
  return { kind: "product_started", ok: result.ok };
}
