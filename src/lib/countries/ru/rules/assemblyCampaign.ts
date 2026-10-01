/**
 * A ratified Assembly decision opens campaigns and fills their bounded NPC slates.
 * planRussianAssemblyCampaign opens only the next failed-poll generation and
 * closes admission at filing or the original seated chamber term.
 */
import { planRussianDumaBallot } from "./assemblySchedule";
export function planRussianAssemblyCampaign(input: {
  turn: number;
  rootId?: string;
  activeAssembly: boolean;
  originalTermEndTurn?: number;
  firstNpcAdmitted: boolean;
  latestResult?: { generation: number; resolvedOnTurn: number; failedPolls: number };
  nextOpening?: { generation: number; openedOnTurn: number; npcAdmitted: boolean };
}) {
  const none = {
    openFirst: false,
    admitFirst: false,
    openRepeatGeneration: null,
    admitRepeatGeneration: null,
  };
  if (!Number.isSafeInteger(input.turn) || input.turn < 1)
    throw new Error("Assembly campaigns need a safe current turn");
  if (!input.rootId) {
    if (input.activeAssembly) throw new Error("A seated Assembly cannot invent an original root");
    return { ...none, openFirst: true };
  }
  if (input.activeAssembly) {
    if (!Number.isSafeInteger(input.originalTermEndTurn) || input.originalTermEndTurn! < 1)
      throw new Error("A seated Assembly campaign needs its original term");
    if (input.turn >= input.originalTermEndTurn!) return none;
  }
  const result = input.latestResult;
  if (!result) {
    if (input.activeAssembly)
      throw new Error("A seated Assembly campaign needs its certified predecessor");
    return { ...none, admitFirst: !input.firstNpcAdmitted };
  }
  if (
    !Number.isSafeInteger(result.generation) ||
    result.generation < 0 ||
    result.generation >= Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(result.resolvedOnTurn) ||
    result.resolvedOnTurn < 1 ||
    result.resolvedOnTurn > input.turn ||
    !Number.isSafeInteger(result.failedPolls) ||
    result.failedPolls < 0 ||
    result.failedPolls > 226
  )
    throw new Error("Assembly campaigns need a safe certified predecessor");
  if (!result.failedPolls) return none;
  const generation = result.generation + 1;
  const opening = input.nextOpening;
  if (!opening) {
    if (
      input.activeAssembly &&
      planRussianDumaBallot(input.turn).endTurn >= input.originalTermEndTurn!
    )
      return none;
    return { ...none, openRepeatGeneration: generation };
  }
  if (
    opening.generation !== generation ||
    !Number.isSafeInteger(opening.openedOnTurn) ||
    opening.openedOnTurn < result.resolvedOnTurn ||
    opening.openedOnTurn > input.turn
  )
    throw new Error("Assembly repeat campaign needs its exact next opening");
  const timing = planRussianDumaBallot(opening.openedOnTurn);
  if (
    input.turn >= timing.primaryEndTurn ||
    opening.npcAdmitted ||
    (input.activeAssembly && timing.endTurn >= input.originalTermEndTurn!)
  )
    return none;
  return { ...none, admitRepeatGeneration: generation };
}
