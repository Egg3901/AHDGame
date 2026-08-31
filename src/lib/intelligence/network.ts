import type { IntelligenceNetwork, OperationCompromise } from "@/lib/db/types/intelligence";
import {
  NETWORK_BURN_COOLDOWN_TURNS,
  NETWORK_FUNDING_PROGRESS,
  NETWORK_LEVEL_PROGRESS,
  NETWORK_MAX_LEVEL,
  SUSPICION_AFTER_BURN,
  SUSPICION_DECAY_IDLE,
  SUSPICION_MAX,
  SUSPICION_PER_OP,
} from "./config";

function clampSuspicion(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(SUSPICION_MAX, v));
}

/** A network can be used only while it is not cooling off from being burned. */
export function isNetworkUsable(net: IntelligenceNetwork, turn: number): boolean {
  if (net.status !== "burned") return true;
  return net.cooledUntilTurn == null || turn > net.cooledUntilTurn;
}

/**
 * One turn of quiet work: funded progress, and suspicion shed only if the network
 * was left alone. That asymmetry is the whole pace-versus-exposure loop — running
 * operations every turn keeps a network permanently hot.
 *
 * A BURNED network still accrues progress while it cools. That is deliberate: the
 * burn already took a level and the operating window, and rebuilding is exactly
 * what a service does after losing a station. Discovery is a setback, not a
 * game over — the same line `covertNuclear` takes with its crackdown.
 */
export function stepNetwork(net: IntelligenceNetwork, turn: number): IntelligenceNetwork {
  const ranThisTurn = net.lastOpTurn === turn;
  const suspicion = ranThisTurn
    ? clampSuspicion(net.suspicion)
    : clampSuspicion(net.suspicion - SUSPICION_DECAY_IDLE);

  let level = net.level;
  let progress = net.progress + (NETWORK_FUNDING_PROGRESS[net.funding] ?? 0);
  while (progress >= NETWORK_LEVEL_PROGRESS && level < NETWORK_MAX_LEVEL) {
    progress -= NETWORK_LEVEL_PROGRESS;
    level += 1;
  }
  // At the cap, progress has nowhere to go: hold it just below a level so a long
  // fully funded run cannot bank an unbounded number down the moment a level is lost.
  if (level >= NETWORK_MAX_LEVEL) progress = Math.min(progress, NETWORK_LEVEL_PROGRESS - 1);

  const cooledOff = net.status === "burned" && isNetworkUsable(net, turn);
  // A network that has reached a level is no longer being stood up. Without this
  // a fully grown network reads "building" forever on the console, which is not
  // what the player is looking at.
  const grewUp = net.status === "building" && level >= 1;

  return {
    ...net,
    level,
    progress,
    suspicion,
    status: cooledOff || grewUp ? "active" : net.status,
    cooledUntilTurn: cooledOff ? null : net.cooledUntilTurn,
    updatedAt: new Date(),
  };
}

/**
 * The compromise half of a resolved operation, applied to the network.
 *
 * Costs are cumulative up the ladder, and NOTHING here touches coverage: what the
 * operation collected stays collected. Compromise costs future access only.
 */
export function applyOperationToNetwork(
  net: IntelligenceNetwork,
  compromise: OperationCompromise,
  turn: number
): IntelligenceNetwork {
  const base: IntelligenceNetwork = {
    ...net,
    suspicion: clampSuspicion(net.suspicion + SUSPICION_PER_OP),
    lastOpTurn: turn,
    updatedAt: new Date(),
  };

  if (compromise === "clean") return base;

  const level = Math.max(0, base.level - 1);
  if (compromise === "blown") return { ...base, level };

  // `detected` and `attributed` additionally burn the network. Attribution's extra
  // cost is diplomatic, applied by the caller, not structural.
  return {
    ...base,
    level,
    status: "burned",
    suspicion: clampSuspicion(SUSPICION_AFTER_BURN),
    cooledUntilTurn: turn + NETWORK_BURN_COOLDOWN_TURNS,
  };
}
