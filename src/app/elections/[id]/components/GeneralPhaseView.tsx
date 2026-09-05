"use client";

import React from "react";
import dynamic from "next/dynamic";
import { RunningMateSelector } from "./RunningMateSelector";
import { GeneralElectionPanel, GeneralElectionNoTallyPanel } from "./ElectionDetailPanels";
import { GeneralElectionShellClient } from "./GeneralElectionShellClient";
import { buildGeneralElectionViewModel } from "@/lib/elections/generalViewModel";
import { countryHasPresidentialRunningMate } from "@/lib/elections/runningMateEligibility";
import {
  assessContingentEvRisk,
  collegeSizeFromEvByState,
  electoralMajorityFor,
} from "@/lib/elections/presidentialResolutionDisplay";
import { ContingentRiskBanner } from "./ContingentRiskBanner";
import { CampaignSeasonBanner } from "./CampaignSeasonBanner";
import type { DriverDisplayInputs } from "@/lib/elections/computePersuasionDriverDisplay";
import {
  PersuasionDrivers,
  type PersuasionDriverCandidate,
} from "@/components/elections/general/PersuasionDrivers";
import { NationalMoodGauge } from "@/components/elections/general/NationalMoodGauge";
import { FactorLedgerCard } from "@/components/elections/general/FactorLedgerCard";
import { states as referenceStates } from "@/lib/seeds/reference/states";
import { getSubdivisionMode } from "@/lib/maps/subdivisionConfig";
import { UK_REGION_NAMES, RU_REGION_NAMES } from "@/lib/constants/states";
import { type CountryId } from "@/lib/constants/countries";
import { useGameClock } from "@/contexts/useGameClock";
import { buildBlendClock } from "@/lib/elections/blendDetailViewModel";
import type { ElectionDetail } from "./ElectionDetailTypes";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

/** Static US state-id → display-name map sourced from the reference seed.
 *  Built once at module load — pure data, no runtime cost per render. */
const US_STATE_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  referenceStates.filter((s) => s.countryId === "US").map((s) => [s._id, s.name])
);

const MapLoadingSkeleton = () => (
  <div className="w-full animate-pulse rounded-xl border border-card-border bg-card p-6">
    <div className="h-4 w-32 rounded bg-card-border mb-4" />
    <div className="h-64 rounded-lg bg-card-border/50" />
  </div>
);

const PresidentialMapWithStateDetail = dynamic(
  () =>
    import("./PresidentialMapWithStateDetail").then((m) => ({
      default: m.PresidentialMapWithStateDetail,
    })),
  { ssr: false, loading: MapLoadingSkeleton }
);

const StateCountyMapCompact = dynamic(
  () =>
    import("./StateCountyMapCompact").then((m) => ({
      default: m.StateCountyMapCompact,
    })),
  { ssr: false, loading: MapLoadingSkeleton }
);

const StateCDMapCompact = dynamic(
  () =>
    import("./StateCDMapCompact").then((m) => ({
      default: m.StateCDMapCompact,
    })),
  { ssr: false, loading: MapLoadingSkeleton }
);

const StateSubdivisionMapCompact = dynamic(
  () =>
    import("./StateSubdivisionMapCompact").then((m) => ({
      default: m.StateSubdivisionMapCompact,
    })),
  { ssr: false, loading: MapLoadingSkeleton }
);

interface GeneralPhaseViewProps {
  election: ElectionDetail;
  electionId: string;
  localInPrimary: boolean;
  localIsEnded: boolean;
  amInRace: boolean;
  onSuccess: () => void;
  /**
   * Whether this view states the college standing and the per-ticket numbers
   * itself. False when a caller has already put both above it.
   */
  showCollegeSummary?: boolean;
}

export function GeneralPhaseView({
  election,
  electionId,
  localInPrimary,
  localIsEnded,
  amInRace,
  showCollegeSummary = true,
  onSuccess,
}: GeneralPhaseViewProps) {
  const resolveCountryName = useCountryDisplayName();
  // Derive country-specific UI gates from the election itself rather than
  // accept them as props. `isUS` drives presidential-only UI (running mate,
  // EC map, etc.); `isProjectedGeneral` drives the "Live Projection" vs
  // "Live Tally" copy — parliamentary lower-chamber elections allocate seats
  // by demographic reach (projected), while presidential / FPTP-per-seat
  // races show a running tally.
  const isUS = election.countryId === "US";
  const isProjectedGeneral = election.countryId !== "US";

  // Blend detail chrome. The countdowns come from the game clock rather than
  // the election payload: the two are fetched separately and can disagree for
  // a few seconds after a turn tick.
  const clock = useGameClock();
  const regionName =
    election.regionName ??
    (isUS ? US_STATE_NAME_BY_ID[election.state] : undefined) ??
    UK_REGION_NAMES[election.state] ??
    RU_REGION_NAMES[election.state] ??
    election.state;
  const countryName = resolveCountryName(election.countryId as CountryId);
  const primaryTimer =
    election.primaryEndTurn != null
      ? clock.formatRemainingTurns(election.primaryEndTurn)
      : clock.formatRemaining(election.primaryEndTime);
  const generalTimer =
    election.endTurn != null
      ? clock.formatRemainingTurns(election.endTurn)
      : clock.formatRemaining(election.endTime);
  // Ballots over the field the page actually lists — the tally can still hold
  // primary-losers' votes, which appear against no row.
  const blendBallots = election.generalVotes
    ? election.allCandidates.reduce(
        (sum, c) => sum + (election.generalVotes!.totalVotes[c.id] ?? 0),
        0
      )
    : 0;
  const blendElectorate = election.regionElectorate;
  const blendClockRows = buildBlendClock({
    primaryLabel: "Primary",
    primaryValue: election.inPrimary ? primaryTimer.text : "Completed",
    generalValue: localIsEnded ? "Completed" : generalTimer.text,
    isEnded: localIsEnded,
    inPrimary: localInPrimary,
    // Only when there is a real denominator; the hero fact carries the basis.
    turnoutPct:
      blendElectorate && blendElectorate.count > 0 && blendBallots > 0
        ? (blendBallots / blendElectorate.count) * 100
        : null,
    ballots: blendBallots,
  });
  // The running-mate selector is offered for any president-with-VP-ticket
  // country (US, Brazil, Nigeria) — not just the US. Ceremonial presidencies
  // without a VP office (Ireland, China) never show it. See ticket #0957.
  const showRunningMateSelector = countryHasPresidentialRunningMate(election.countryId);

  // Persuasion-driver inputs — shared by the presidential shell and the
  // state-race card. All fields are already on the client DTO (support is
  // fogged server-side for non-privileged viewers).
  const persuasionCandidates: PersuasionDriverCandidate[] = (election.allCandidates ?? []).map(
    (c) => ({
      id: c.id,
      characterId: c.characterId,
      name: c.characterName,
      party: c.party,
      partyColor: c.partyColor,
      partyEcon: c.partyEcon,
      partySocial: c.partySocial,
      economicPosition: c.economicPosition,
      socialPosition: c.socialPosition,
      favorability: c.favorability,
      politicalInfluence: c.politicalInfluence,
      nationalInfluence: c.nationalInfluence,
      isNPP: c.isNPP,
      sharePct: c.sharePct,
      support: c.support,
    })
  );
  const persuasionInputs: DriverDisplayInputs = {
    fundsByParty: election.fundsByParty,
    incumbentSeatShareByParty: election.incumbentSeatShareByParty,
    regByParty: election.persuasionRegByParty,
    medianVoter: election.medianVoter,
    presidentialCoattailPctByParty: election.presidentialCoattailPctByParty,
    gubernatorialCoattailPctByParty: election.gubernatorialCoattailPctByParty,
    midtermOppositionBoostPctByParty: election.midtermOppositionBoostPctByParty,
    incumbentPartyId: election.incumbentPartyId,
    incumbentApproval: election.incumbentApproval,
    legislativeIncumbentPartyId: election.legislativeIncumbentPartyId,
    legislativeIncumbentTenureTerms: election.legislativeIncumbentTenureTerms,
  };
  /* Persuasion Drivers for non-presidential general elections. The swing-flow
     engine + drivers already run server-side for every general race (see
     `tallyManagement.ts`). Single-state races (US Senate / Governor / House /
     State Senate, plus UK / JP / DE equivalents that populate
     `election.state`) render it directly under the tally, where it explains
     the numbers the viewer just read. President keeps the multi-state
     battleground shell above. */
  const persuasionDriversCard =
    !localInPrimary &&
    election.electionType !== "president" &&
    election.state &&
    election.allCandidates.length > 0 ? (
      <PersuasionDrivers
        stateId={election.state}
        stateName={(isUS ? US_STATE_NAME_BY_ID[election.state] : undefined) ?? election.state}
        candidates={persuasionCandidates}
        inputs={persuasionInputs}
      />
    ) : null;

  return (
    <div className="space-y-4">
      {/* The electoral map leads the presidential page, directly under the
          year + race title. It is the one view that answers "who is winning"
          at a glance, and it used to sit below the mood gauge, the factor
          ledger and the battleground shell: three analysis cards that only
          make sense once you have seen the map they decompose. */}
      {isUS && election.electionType === "president" && !localInPrimary && (
        <PresidentialMapWithStateDetail
          electionId={electionId}
          electoralMapData={election.generalVotes?.electoralMapData ?? {}}
          electoralVotesByCandidate={election.generalVotes?.electoralVotesByCandidate}
          candidateNames={election.generalVotes?.candidateNames ?? {}}
          candidateParties={election.generalVotes?.candidateParties ?? {}}
          candidateColors={election.generalVotes?.candidateColors ?? {}}
          stateVoteData={election.generalVotes?.stateVoteData}
          stateVotesOverTime={election.generalVotes?.stateVotesOverTime}
          candidateTravelStates={Object.fromEntries(
            election.allCandidates.filter((c) => c.travelState).map((c) => [c.id, c.travelState!])
          )}
        />
      )}

      {showRunningMateSelector &&
        election.electionType === "president" &&
        amInRace &&
        !localIsEnded &&
        (() => {
          const myCandidate = election.allCandidates.find((c) => c.isYou);
          return myCandidate ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <RunningMateSelector
                electionId={electionId}
                currentRunningMateCharacterId={myCandidate.runningMateCharacterId ?? null}
                currentRunningMateName={myCandidate.runningMateName ?? null}
                onSuccess={onSuccess}
              />
            </div>
          ) : null;
        })()}

      <div className="space-y-3">
        <CampaignSeasonBanner
          election={election}
          localInPrimary={localInPrimary}
          localIsEnded={localIsEnded}
        />

        {/* Names the tally table it introduces, so it is dropped alongside it
            rather than left heading a section with no tally under it. */}
        {showCollegeSummary && (
          <div>
            <h2 className="text-lg font-semibold">
              {localIsEnded
                ? "Final Election Results"
                : isProjectedGeneral
                  ? "General Election — Live Projection"
                  : "General Election — Live Tally"}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {isProjectedGeneral
                ? "Seats projected by demographic reach and regional support each turn."
                : "Votes allocated by demographic reach each turn. Final 4 turns = 25%; earlier turns = 75%."}
            </p>
          </div>
        )}

        {/* Phase 5b shell — battleground tiers + Reg / Persuasion side panels.
            Mounted alongside the existing PresidentialMapWithStateDetail per
            D5; the two coexist (different emphasis: this one for margin tiers
            + drivers, the existing one for EV totals + state-detail modal). */}
        {isUS &&
          election.electionType === "president" &&
          !localInPrimary &&
          !localIsEnded &&
          (() => {
            const college = collegeSizeFromEvByState(election.generalVotes?.evByState);
            const risk = assessContingentEvRisk(
              election.generalVotes?.electoralVotesByCandidate,
              college > 0 ? electoralMajorityFor(college) : 270
            );
            return risk?.atRisk ? (
              <ContingentRiskBanner
                risk={risk}
                candidateNames={election.generalVotes?.candidateNames ?? {}}
              />
            ) : null;
          })()}

        {/* National Mood — the economy's push on the incumbent party, read off
            the tally snapshot the engine wrote. Sits with the driver panels so
            the national channel is visible before election day. Renders for the
            live race and for resolved races that carry the snapshot; older
            races have no field and the card returns null. */}
        {election.electionType === "president" && !localInPrimary && (
          <NationalMoodGauge data={election.economicReferendum} />
        )}

        {/* Factor Ledger — the read-only decomposition of each candidate's
            projected votes into named factors, teed off the engine's own math.
            Sits beside National Mood; renders null for races with no ledger. */}
        {election.electionType === "president" && !localInPrimary && (
          <FactorLedgerCard
            data={election.factorLedger}
            candidates={Object.entries(election.generalVotes?.candidateNames ?? {}).map(
              ([id, name]) => ({
                id,
                name,
                color: election.generalVotes?.candidateColors?.[id] ?? "#9CA3AF",
              })
            )}
          />
        )}

        {isUS && election.electionType === "president" && !localInPrimary && (
          <GeneralElectionShellClient
            countryId="US"
            persuasionCandidates={persuasionCandidates}
            persuasionInputs={persuasionInputs}
            viewModel={buildGeneralElectionViewModel({
              candidates: Object.entries(election.generalVotes?.candidateNames ?? {}).map(
                ([id, name]) => {
                  const partyId = election.generalVotes?.candidateParties?.[id] ?? "";
                  return {
                    id,
                    name,
                    color: election.generalVotes?.candidateColors?.[id] ?? "#9CA3AF",
                    partyAbbr: election.partyDisplayById?.[partyId]?.abbr ?? (partyId || "?"),
                  };
                }
              ),
              stateVoteData: Object.fromEntries(
                Object.entries(election.generalVotes?.stateVoteData ?? {}).map(([stateId, d]) => [
                  stateId,
                  d.votesByCandidate,
                ])
              ),
              // Per-state registration-lean breakdown, computed server-side in
              // `_enrichElection` from `statePartyOrg.registration` + the
              // `stateRegistrationPool` buckets. Undefined for states without
              // seeded registration → the card shows its honest 'no data
              // tracked' placeholder per state.
              regByState: election.regByState,
              partyDisplayById: election.partyDisplayById,
              stateNameById: US_STATE_NAME_BY_ID,
            })}
          />
        )}

        {election.generalVotes ? (
          <GeneralElectionPanel
            afterTally={persuasionDriversCard}
            tally={election.generalVotes}
            candidates={election.allCandidates}
            isEnded={localIsEnded}
            totalSeats={election.totalSeats}
            electionType={election.electionType}
            electionId={election.id}
            myCharId={election.myCharId}
            myEndorsedCandidateId={election.myEndorsedCandidateId}
            countryId={(election.countryId ?? "US") as "US" | "UK" | "DE"}
            regionName={regionName}
            countryName={countryName}
            year={election.electionYear}
            clockRows={blendClockRows}
            electorate={blendElectorate}
            partyDisplayById={election.partyDisplayById}
            showCollegeSummary={showCollegeSummary}
          />
        ) : (
          <GeneralElectionNoTallyPanel
            candidates={election.allCandidates}
            isEnded={localIsEnded}
            totalSeats={election.totalSeats}
            electionId={election.id}
            electionType={election.electionType}
            myCharId={election.myCharId}
            myEndorsedCandidateId={election.myEndorsedCandidateId}
          />
        )}

        {/* Sub-region maps close the page, under the results and trend charts.
            election.id (not the route param): the URL may be a seat id that
            resolves to the CURRENT cycle, while Previous/Next can be showing a
            past election — the map must query the election on screen. */}

        {/* County map for US senate, governor, and state senate races */}
        {isUS &&
          !localInPrimary &&
          ["senate", "governor", "stateSenate"].includes(election.electionType) && (
            <StateCountyMapCompact
              electionId={election.id}
              state={election.state}
              electionType={election.electionType}
              countryId={election.countryId ?? "US"}
            />
          )}

        {/* CD map for US house races */}
        {isUS && !localInPrimary && election.electionType === "house" && (
          <StateCDMapCompact
            electionId={election.id}
            state={election.state}
            countryId={election.countryId ?? "US"}
          />
        )}

        {/* Sub-region map for non-US races with subdivision data (e.g. UK constituencies).
            The registry decides support; the compact card hides itself on 404. */}
        {!isUS &&
          !localInPrimary &&
          election.state &&
          election.countryId &&
          getSubdivisionMode(election.countryId, election.electionType) && (
            <StateSubdivisionMapCompact
              electionId={election.id}
              state={election.state}
              countryId={election.countryId}
              stateName={UK_REGION_NAMES[election.state] ?? RU_REGION_NAMES[election.state]}
            />
          )}
      </div>
    </div>
  );
}
