// UI-facing query surface for parliamentary government calculations.
//
// Re-exports from @/lib/turn/parliamentaryGovernment so UK/JP/DE executive
// hubs don't reach into the turn engine directly.

export {
  checkAppointmentEligibility,
  processParliamentaryGovernmentVotes,
  resolveGoverningPartyIdsFromDocuments,
  resolveOppositionLeader,
} from "@/lib/turn/parliamentaryGovernment";
