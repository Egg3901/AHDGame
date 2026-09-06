/**
 * Field documentation for the public elections endpoints.
 *
 * Kept out of `page.tsx` because these two tables are the largest on the page and
 * were pushing it past the 1200 LOC architecture warning. Data only, no JSX.
 */

export interface ApiField {
  name: string;
  type: string;
  desc: string;
}

/** GET /api/public/v1/elections?country=CODE */
export const ELECTION_LIST_FIELDS: ApiField[] = [
  { name: "ok", type: "boolean", desc: "Always true" },
  { name: "found", type: "boolean", desc: "Whether elections found" },
  { name: "elections", type: "array", desc: "List of elections" },
  { name: "elections[].id", type: "string", desc: "Election ObjectId" },
  { name: "elections[].seatId", type: "string|null", desc: "Seat identifier" },
  {
    name: "elections[].startTime",
    type: "string|null",
    desc: "ISO 8601 time the race opened. This is when it spawned, not a deadline: for the deadline use phaseEndTime.",
  },
  { name: "elections[].endTime", type: "string|null", desc: "ISO 8601 close of the general" },
  {
    name: "elections[].finalVotes",
    type: "object",
    desc: "Present once the race is over: { totalVotes, finalized }. finalized is false until the result has been resolved.",
  },
  {
    name: "elections[].electionType",
    type: "string",
    desc: "Office contested (senate, house, governor, commons, ...)",
  },
  { name: "elections[].state", type: "string", desc: "State code" },
  { name: "elections[].stateName", type: "string", desc: "State name, falling back to the code" },
  {
    name: "elections[].status",
    type: "string",
    desc: "upcoming, active, completed, resolved, or cancelled",
  },
  {
    name: "elections[].phase",
    type: "string",
    desc: "upcoming, primary, general, ended, or cancelled. Use this to tell a primary from a general: status stays active across both.",
  },
  {
    name: "elections[].phaseEndTurn",
    type: "number|null",
    desc: "Turn the current phase closes on. Null once the race has ended.",
  },
  {
    name: "elections[].phaseEndTime",
    type: "string|null",
    desc: "ISO 8601 close of the current phase, matching phaseEndTurn",
  },
  { name: "elections[].primaryEndTurn", type: "number|null", desc: "Turn the primary closes on" },
  { name: "elections[].primaryEndTime", type: "string|null", desc: "ISO 8601 primary close" },
  { name: "elections[].startTurn", type: "number|null", desc: "Turn the race opened on" },
  { name: "elections[].endTurn", type: "number|null", desc: "Turn the general closes on" },
  {
    name: "elections[].candidates",
    type: "array",
    desc: "Candidates still standing. Withdrawals and primary losers move to formerCandidates.",
  },
  {
    name: "elections[].formerCandidates",
    type: "array",
    desc: "Candidacies that ended: withdrawals and primary losers, most recent departure first. Someone who left and re-entered has one entry here per departure plus their standing row above.",
  },
  {
    name: "elections[].formerCandidates[].withdrawnAt",
    type: "string|null",
    desc: "ISO 8601 time the candidacy ended, or null if unrecorded",
  },
  {
    name: "elections[].candidates[].status",
    type: "string",
    desc: "active or withdrawn. Always active in candidates, withdrawn in formerCandidates.",
  },
  {
    name: "elections[].candidates[].characterId",
    type: "string|null",
    desc: "Character ObjectId, or null for a non-player candidacy",
  },
  { name: "elections[].candidates[].characterName", type: "string", desc: "Candidate name" },
  {
    name: "elections[].candidates[].party",
    type: "string",
    desc: "Party sequential id. The detail endpoint resolves this to a party name instead.",
  },
  { name: "elections[].candidates[].partyColor", type: "string|null", desc: "Party colour hex" },
  { name: "elections[].candidates[].isNPP", type: "boolean", desc: "Non-party member" },
  {
    name: "elections[].results",
    type: "object|null",
    desc: "Present only with results=true: vote standings, optional multi-seat estimate, and candidate stats.",
  },
  {
    name: "elections[].results.seatsEstimate",
    type: "object|null",
    desc: "Multi-seat races only: results.candidates[].id to estimated seat count. Absent for single-seat races, and null on a multi-seat race whose split has not been computed yet.",
  },
  {
    name: "elections[].results.candidates[].id",
    type: "string",
    desc: "Candidacy ObjectId. This is the key seatsEstimate uses. Note it is a candidacy, not a character: the same character holds a separate id for each time they entered the race.",
  },
  {
    name: "elections[].results.candidates[].characterId",
    type: "string",
    desc: "Deprecated alias of results.candidates[].id, kept for existing callers. Despite the name it has never held a character id and does not join against elections[].candidates[].characterId. Use id.",
  },
  {
    name: "elections[].results.candidates[].favorability",
    type: "number|null",
    desc: "Current candidate favorability from the linked character, or the linked NPP for a non-party candidacy. Null when neither record exists.",
  },
  {
    name: "elections[].results.candidates[].politicalInfluence",
    type: "number|null",
    desc: "Current political influence from the linked character, or the linked NPP for a non-party candidacy. Null when neither record exists.",
  },
];

/** GET /api/public/v1/elections/[id] */
export const ELECTION_DETAIL_FIELDS: ApiField[] = [
  { name: "ok", type: "boolean", desc: "Always true" },
  { name: "found", type: "boolean", desc: "Whether found" },
  { name: "election", type: "object", desc: "Full election data" },
  { name: "election.id", type: "string", desc: "Election ObjectId" },
  { name: "election.electionType", type: "string", desc: "Office contested" },
  {
    name: "election.status",
    type: "string",
    desc: "upcoming, active, completed, resolved, or cancelled",
  },
  {
    name: "election.phase",
    type: "string",
    desc: "upcoming, primary, general, ended, or cancelled",
  },
  { name: "election.totalSeats", type: "number", desc: "Seats contested" },
  {
    name: "election.phaseEndTurn",
    type: "number|null",
    desc: "Turn the current phase closes on",
  },
  {
    name: "election.phaseEndTime",
    type: "string|null",
    desc: "ISO 8601 close of the current phase",
  },
  {
    name: "election.startTurn / primaryEndTurn / endTurn",
    type: "number|null",
    desc: "Turn bounds of the race",
  },
  {
    name: "phase",
    type: "object",
    desc: "{ current, inPrimary, inGeneral, isUpcoming, isEnded }",
  },
  {
    name: "incumbent",
    type: "object|null",
    desc: "{ name, party } for whoever holds the seat, or null. Still reported if they have withdrawn or lost their primary.",
  },
  {
    name: "primarySnapshots",
    type: "array",
    desc: "Primary polling over time: { turn, candidates[{ name, sharePct }] }",
  },
  { name: "candidates", type: "array", desc: "Candidates still standing, with details" },
  {
    name: "candidates[].favorability",
    type: "number|null",
    desc: "Current candidate favorability from the linked character, or the linked NPP for a non-party candidacy. Null when neither record exists.",
  },
  {
    name: "candidates[].politicalInfluence",
    type: "number|null",
    desc: "Current political influence from the linked character, or the linked NPP for a non-party candidacy. Null when neither record exists.",
  },
  {
    name: "formerCandidates",
    type: "array",
    desc: "Candidacies that ended, same shape plus withdrawnAt, most recent departure first",
  },
  {
    name: "votes",
    type: "object|null",
    desc: "Vote tallies and snapshots. votes.finalized stays false until the result has been resolved, even after the closing turn has passed.",
  },
  {
    name: "votes.seatsEstimate",
    type: "object|null",
    desc: "Multi-seat races only: candidates[].id to estimated seat count. Same key space and same multi-seat rule as the list endpoint.",
  },
];
