// Coalition types now live in src/lib/coalitions/types so that domain helpers
// (e.g. priorityApi) don't have to import from the app layer. This file remains
// as a re-export shim — UI imports of `@/app/country/[code]/parties/coalitionTypes`
// keep working.
export type {
  CoalitionMemberParty,
  CoalitionListItem,
  CoalitionDetail,
  CoalitionPriorityType,
  CoalitionPriorityVisibility,
  CoalitionPriorityStatus,
  CoalitionPriorityVote,
  CoalitionPriorityPartyStance,
  CoalitionPriorityItem,
  CoalitionPrioritiesPayload,
} from "@/lib/coalitions/types";
