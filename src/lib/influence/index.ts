export {
  INFLUENCE_ACTIONS,
  INFLUENCE_LIMITS,
  INFLUENCE_MODIFIERS,
  type InfluenceActionConfig,
} from "./constants";

export {
  getSimpleInfluenceInfo,
  executeSimpleInfluence,
  BASE_INFLUENCE_COST,
  type TargetType,
  type SimpleInfluenceInfo,
  type SimpleInfluenceResult,
} from "./simpleInfluence";

export {
  calculateInfluenceChance,
  rollInfluence,
  determineOutcome,
  getOutcomeMessage,
  getRelationshipChange,
  type InfluenceCalculation,
  type InfluenceCalculationInput,
} from "./calculator";

export {
  executeInfluence,
  validateInfluenceAttempt,
  getInfluenceOptions,
  type ExecuteInfluenceInput,
  type ExecuteInfluenceResult,
} from "./executor";

export {
  executeStatePartyInfluence,
  executeNationalPartyInfluence,
  validateStatePartyInfluence,
  validateNationalPartyInfluence,
  getStatePartyInfluenceOptions,
  getNationalPartyInfluenceOptions,
  hasActivePlayersInState,
  getStatesWithoutPlayers,
  calculatePartyInfluenceChance,
  type PartyInfluenceCalculation,
  type ExecutePartyInfluenceInput,
  type ExecutePartyInfluenceResult,
} from "./partyExecutor";
