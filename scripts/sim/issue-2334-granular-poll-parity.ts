/**
 * Deterministic poll-to-tally qualification for issue #2334.
 *
 * Runs the real granular poll builder and the real swing-flow vote engine on
 * the same pinned granular-electorate substrate. Every dimension is held equal
 * except the case being measured: office options, NPP status, favorability, or
 * uniform targeted-ad exposure.
 */
import assert from "node:assert/strict";
import { buildGranularPollPayloadForState } from "@/lib/actions/granularPollPayload";
import { buildGranularElectorateSubstrate } from "@/lib/demographics/granularElectorate";
import { targetedAdBonuses } from "@/lib/campaignTargeting/rules";
import type { DistributeVotesOptions, EnrichedCandidate } from "@/lib/electionEngine/types";
import { distributeVotesBySwingFlow } from "@/lib/electionEngine/voteDistributionSwingFlow";
import { personalStatTenureRetentionForCandidate } from "@/lib/electionEngine/rules/tenureRetention";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

const SOURCE_REVISION = "98ffb6ded3a4110e94598e98ce582ad2c0ba9eeb";
const stateId = "CT";
const countryId = "US";
const population = 100_000;
const legacyCategories = [
  {
    _id: "legacy-all",
    name: "Legacy substrate placeholder",
    groups: [
      {
        id: "legacy-all",
        name: "All voters",
        defaultEconomicLean: 0,
        defaultSocialLean: 0,
        defaultTurnout: 60,
      },
    ],
  },
] as unknown as DemographicCategory[];
const legacyDemographics = {
  _id: stateId,
  categoryWeights: { "legacy-all": 100 },
  groups: {
    "legacy-all": { population: 100, turnout: 60, economicLean: 0, socialLean: 0 },
  },
} as unknown as StateDemographics;

const offices = [
  { label: "governor", options: { votingSystem: "fptp" as const }, incumbency: undefined },
  {
    label: "house",
    options: {
      votingSystem: "fptp" as const,
      houseIncumbentTenureTermsByCandidateId: new Map([["player", 6]]),
    },
    incumbency: { houseTenureTermsByCandidateId: new Map([["player", 6]]) },
  },
  {
    label: "senate",
    options: {
      votingSystem: "fptp" as const,
      legislativeIncumbentPartyId: "party-player",
      legislativeIncumbentTenureTerms: 7,
    },
    incumbency: {
      legislativePartyId: "party-player",
      legislativeTenureTermsSought: 7,
    },
  },
  {
    label: "president",
    options: {
      votingSystem: "fptp" as const,
      useAveragedPositions: true,
      partyPositionWeight: 1 / 3,
      useNationalInfluenceForReach: true,
      incumbentPartyId: "party-player",
      // Zeroes the separate approval shield/drag so this fixture isolates
      // personal-stat tenure retention, the subject of #2334 parity.
      incumbentApproval: 46,
      incumbentConsecutiveTerms: 6,
    },
    incumbency: { executivePartyId: "party-player", executiveConsecutiveTerms: 6 },
  },
] as const;
const actorMixes = ["human-human", "human-npp"] as const;
const favorabilityCases = [
  { label: "tie", player: 50, opponent: 50 },
  { label: "player-up-60", player: 80, opponent: 20 },
  { label: "opponent-up-60", player: 20, opponent: 80 },
  { label: "player-up-30", player: 70, opponent: 40 },
] as const;
const campaignPhases = [
  { label: "before-campaign", pollTurn: 19, tallyTurn: 20, hasAd: false },
  { label: "after-campaign", pollTurn: 20, tallyTurn: 21, hasAd: true },
] as const;

function makeCandidate(
  candidateId: string,
  party: string,
  favorability: number,
  isNPP: boolean,
  archetypeApprovals: Record<string, number>
): EnrichedCandidate {
  return {
    candidateId,
    characterId: candidateId,
    characterName: candidateId,
    party,
    isNPP,
    charEP: 0,
    charSP: 0,
    partyEcon: 0,
    partySocial: 0,
    favorability,
    politicalInfluence: 50,
    nationalInfluence: 50,
    support: 50,
    archetypeApprovals,
    infamy: 0,
  };
}

function aggregatePollPlayerShare(payload: ReturnType<typeof buildGranularPollPayloadForState>) {
  let player = 0;
  let opponents = 0;
  let undecided = 0;
  for (const cell of payload.cells) {
    const shares = payload.candidateShares[cell.id];
    const votePoolWeight = cell.share * cell.turnout;
    player += votePoolWeight * shares.you;
    opponents += votePoolWeight * shares.opponents.reduce((sum, entry) => sum + entry.share, 0);
    undecided += votePoolWeight * shares.undecided;
  }
  return {
    playerPct: (player / (player + opponents)) * 100,
    undecidedPct: (undecided / (player + opponents + undecided)) * 100,
  };
}

const rows: string[] = [
  "source_revision,office,actor_mix,favorability_case,campaign_phase,poll_pct,vote_pct,delta_pp,undecided_pct",
];
let maxAbsDelta = 0;
let tenureComparisonCount = 0;
let maxTenureRetentionDelta = 0;
for (const office of offices) {
  for (const actorMix of actorMixes) {
    for (const favorability of favorabilityCases) {
      for (const campaignPhase of campaignPhases) {
        const opponentIsNpp = actorMix === "human-npp";
        const player = makeCandidate("player", "party-player", favorability.player, false, {
          retirees: 24,
          young_renters: -8,
        });
        const opponent = makeCandidate(
          "opponent",
          "party-opponent",
          favorability.opponent,
          opponentIsNpp,
          { retirees: -12, young_renters: 16 }
        );
        const targetedAds = campaignPhase.hasAd
          ? [
              {
                stateId,
                dimension: "age",
                bucket: "senior",
                bonus: 0.1,
                lastPurchaseTurn: 20,
              },
            ]
          : [];
        player.targetedAds = targetedAds;
        opponent.targetedAds = [];
        const candidates = [player, opponent];
        const buildSubstrate = (currentTurn: number) =>
          buildGranularElectorateSubstrate({
            countryId,
            stateId,
            preset: "2019-default",
            campaignRulesVersion: 1,
            currentTurn,
            statePopulation: population,
            demographics: legacyDemographics,
            categories: legacyCategories,
            liveTurnouts: { "legacy-all": 60 },
            enriched: candidates,
            cache: "shared",
          });
        const pollSubstrate = buildSubstrate(campaignPhase.pollTurn);
        const tallySubstrate = buildSubstrate(campaignPhase.tallyTurn);
        assert.ok(pollSubstrate?.campaignCells, `${office.label}: poll substrate missing`);
        assert.ok(tallySubstrate, `${office.label}: tally substrate missing`);

        const bonusesByCandidate = Object.fromEntries(
          candidates.map((candidate) => [
            candidate.candidateId,
            targetedAdBonuses(
              pollSubstrate.campaignCells!,
              { economicLean: candidate.charEP, socialLean: candidate.charSP },
              candidate.targetedAds ?? [],
              stateId,
              campaignPhase.pollTurn
            ),
          ])
        );
        const campaign = {
          myCandidateId: "player",
          totalPool: pollSubstrate.totalPool,
          votes: {},
          cells: pollSubstrate.campaignCells,
          bonusesByCandidate,
        };
        const poll = buildGranularPollPayloadForState({
          campaign,
          countryId,
          stateId,
          preset: "2019-default",
          character: {
            candidateId: player.candidateId,
            party: player.party,
            economicPosition: player.charEP,
            socialPosition: player.charSP,
            favorability: player.favorability,
            archetypeApprovals: player.archetypeApprovals,
            politicalInfluence: player.politicalInfluence,
            nationalInfluence: player.nationalInfluence,
          },
          opponents: [
            {
              candidateId: opponent.candidateId,
              name: opponent.characterName,
              party: opponent.party,
              economicPosition: opponent.charEP,
              socialPosition: opponent.charSP,
              favorability: opponent.favorability,
              archetypeApprovals: opponent.archetypeApprovals,
              politicalInfluence: opponent.politicalInfluence,
              nationalInfluence: opponent.nationalInfluence,
              isNPP: opponent.isNPP,
            },
          ],
          incumbency: office.incumbency,
          useNationalInfluenceForReach: office.label === "president",
        });
        const pollResult = aggregatePollPlayerShare(poll);

        const voteOptions: DistributeVotesOptions = {
          isGeneralElection: true,
          hasPlayerInRace: true,
          countryId,
          currentStateId: stateId,
          ...office.options,
        };
        const pollIncumbency = office.incumbency;
        const voteIncumbency = {
          executivePartyId:
            "incumbentPartyId" in voteOptions ? voteOptions.incumbentPartyId : undefined,
          executiveConsecutiveTerms:
            "incumbentConsecutiveTerms" in voteOptions
              ? voteOptions.incumbentConsecutiveTerms
              : undefined,
          legislativePartyId:
            "legislativeIncumbentPartyId" in voteOptions
              ? voteOptions.legislativeIncumbentPartyId
              : undefined,
          legislativeTenureTermsSought:
            "legislativeIncumbentTenureTerms" in voteOptions
              ? voteOptions.legislativeIncumbentTenureTerms
              : undefined,
          houseTenureTermsByCandidateId:
            "houseIncumbentTenureTermsByCandidateId" in voteOptions
              ? voteOptions.houseIncumbentTenureTermsByCandidateId
              : undefined,
        };
        for (const candidate of [player, opponent]) {
          const candidateIdentity = {
            candidateId: candidate.candidateId,
            partyId: candidate.party,
          };
          const pollRetention = personalStatTenureRetentionForCandidate(
            candidateIdentity,
            pollIncumbency
          );
          const voteRetention = personalStatTenureRetentionForCandidate(
            candidateIdentity,
            voteIncumbency
          );
          tenureComparisonCount += 1;
          maxTenureRetentionDelta = Math.max(
            maxTenureRetentionDelta,
            Math.abs(pollRetention - voteRetention)
          );
          assert.equal(
            pollRetention,
            voteRetention,
            `${office.label}/${candidate.candidateId}: poll and vote tenure retention disagree`
          );
        }
        const voteResult = distributeVotesBySwingFlow(
          tallySubstrate.enriched,
          tallySubstrate.totalPool,
          tallySubstrate.totalPool,
          population,
          tallySubstrate.demographics,
          tallySubstrate.categories,
          new Map(),
          voteOptions
        );
        const votePct = voteResult.sharesPct.player;
        const delta = pollResult.playerPct - votePct;
        maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
        rows.push(
          `${SOURCE_REVISION},${office.label},${actorMix},${favorability.label},${campaignPhase.label},${pollResult.playerPct.toFixed(3)},${votePct.toFixed(3)},${delta.toFixed(3)},${pollResult.undecidedPct.toFixed(3)}`
        );
      }
    }
  }
}

console.log(rows.join("\n"));
console.log(`max_abs_delta_pp,${maxAbsDelta.toFixed(3)}`);
console.log(`personal_stat_tenure_comparisons,${tenureComparisonCount}`);
console.log(`personal_stat_tenure_max_delta,${maxTenureRetentionDelta.toFixed(3)}`);
const originalCasesMaxAbsDelta = Number(
  rows
    .slice(1)
    .filter((row) => row.includes(",governor,"))
    .map((row) => Math.abs(Number(row.split(",")[7])))
    .reduce((max, delta) => Math.max(max, delta), 0)
);
assert.ok(
  originalCasesMaxAbsDelta <= 0.5,
  `original non-incumbent cases differ by ${originalCasesMaxAbsDelta.toFixed(3)}pp, above 0.5pp`
);
assert.equal(maxTenureRetentionDelta, 0, "poll/vote personal-stat retention inputs must match");
