import type { Db } from "mongodb";
import type {
  Election,
  ElectionVoteTally,
  ElectionCandidate,
  State,
  PoliticalParty,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {} from "@/lib/constants";
import { loadApportionment } from "@/lib/elections/apportionment";
import { getGameStateCollection } from "@/lib/db/collections";

export interface MapPresidentialState {
  leadingParty: string;
  leadColor: string;
  candidateName: string;
  ev: number;
  tooltip: string[];
}

const DEFAULT_COLORS: Record<string, string> = {
  democrat: "#3B82F6",
  republican: "#EF4444",
  independent: "#9CA3AF",
  LAB: "#E4003B",
  CON: "#0087DC",
  LD: "#FAA61A",
  SNP: "#FFF95D",
  PC: "#3F8428",
  GREEN: "#02A95B",
  REF: "#12B6CF",
};

function partyColor(partyId: string, storedColor?: string): string {
  return DEFAULT_COLORS[partyId] ?? storedColor ?? "#8B5CF6";
}

export async function computePresidentialMap(
  db: Db,
  countryId: CountryId
): Promise<{
  presidential: Record<string, MapPresidentialState>;
  presidentialElectoralVotes?: Record<string, number>;
  presidentialCandidateNames?: Record<string, string>;
  presidentialCandidateParties?: Record<string, string>;
  presidentialCandidateColors?: Record<string, string>;
  /** Σ live apportionment EV units (omitted on the early no-data return → panel uses 538). */
  totalElectoralVotes?: number;
}> {
  const [parties, allStates] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
    db.collection<State>("states").find({ countryId }).toArray(),
  ]);

  const partyColorMap = new Map(
    parties.map((p) => [String(p.sequentialId), partyColor(String(p.sequentialId), p.color)])
  );
  const stateMap = new Map(allStates.map((s) => [s._id, s]));

  const presidentElection = await db.collection<Election>("elections").findOne(
    {
      countryId,
      state: countryId,
      status: { $in: ["active", "upcoming", "completed", "resolved"] },
    },
    { sort: { updatedAt: -1 } }
  );

  const presidential: Record<string, MapPresidentialState> = {};
  let presidentialElectoralVotes: Record<string, number> | undefined;
  let presidentialCandidateNames: Record<string, string> | undefined;
  let presidentialCandidateParties: Record<string, string> | undefined;
  let presidentialCandidateColors: Record<string, string> | undefined;

  if (!presidentElection) {
    return {
      presidential,
      presidentialElectoralVotes,
      presidentialCandidateNames,
      presidentialCandidateParties,
      presidentialCandidateColors,
    };
  }

  const [voteTally, electionCandidates] = await Promise.all([
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: presidentElection._id }),
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: presidentElection._id, status: { $in: ["active", "withdrawn"] } })
      .project({ _id: 1, characterName: 1 })
      .toArray(),
  ]);

  const totalVotesByUnit = voteTally?.totalVotesByUnit;
  const totalVotes = voteTally?.totalVotes ?? {};
  const tallyNames = voteTally?.candidateNames ?? {};
  const candidateNames: Record<string, string> = {};

  for (const c of electionCandidates) {
    candidateNames[c._id.toString()] = c.characterName;
  }
  for (const [k, v] of Object.entries(tallyNames)) {
    if (v) candidateNames[k] = v;
  }

  const candidateParties = voteTally?.candidateParties ?? {};

  // Resolve a candidate's hex colour the same way state `leadColor` is resolved
  // so the results bar matches the map. candidateParties stores party
  // sequentialId strings, which the client cannot map to hex on its own.
  const colorForCandidate = (candidateId: string): string => {
    const party = candidateParties[candidateId] ?? "independent";
    return partyColorMap.get(party) ?? partyColor(party);
  };
  const buildCandidateColors = (evByCandidate: Record<string, number>): Record<string, string> =>
    Object.fromEntries(Object.keys(evByCandidate).map((cid) => [cid, colorForCandidate(cid)]));

  // Live apportionment: census-updated `state.houseDistricts` (preset seed as
  // fallback). Equals the preset seed until a decennial census reapportions
  // (P1d-2; golden gate makes this a behavior-preserving swap).
  const gameState = await (await getGameStateCollection(db)).findOne({ _id: "current" });
  const evUnits = (await loadApportionment(db, gameState?.preset, gameState?.currentYear))
    .electoralVoteUnits;
  // State-set-driven electoral-college total: the sum of the LIVE apportionment
  // units (538 for the current 50-state set; fewer in an earlier/fewer-state era).
  // The map's Presidential panel uses this instead of a hardcoded 538/270.
  const totalElectoralVotes = evUnits.reduce((sum, u) => sum + u.ev, 0);

  const hasUnitVotes =
    totalVotesByUnit &&
    Object.values(totalVotesByUnit).some((uv) => Object.values(uv ?? {}).some((v) => v > 0));

  if (hasUnitVotes && totalVotesByUnit) {
    const evByStateAndCandidate = new Map<string, Map<string, number>>();
    const votesByStateAndCandidate = new Map<string, Map<string, number>>();

    for (const unit of evUnits) {
      const unitVotes = totalVotesByUnit[unit.unitId];
      if (!unitVotes) continue;
      const entries = Object.entries(unitVotes)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) continue;
      const winnerId = entries[0][0];
      const stateId = unit.stateId;

      if (!evByStateAndCandidate.has(stateId)) {
        evByStateAndCandidate.set(stateId, new Map());
        votesByStateAndCandidate.set(stateId, new Map());
      }

      const candidateEvMap = evByStateAndCandidate.get(stateId)!;
      candidateEvMap.set(winnerId, (candidateEvMap.get(winnerId) ?? 0) + unit.ev);

      const candidateVotesMap = votesByStateAndCandidate.get(stateId)!;
      for (const [cid, v] of Object.entries(unitVotes)) {
        if (v > 0) candidateVotesMap.set(cid, (candidateVotesMap.get(cid) ?? 0) + v);
      }
    }

    for (const [stateId, candidateEvs] of evByStateAndCandidate) {
      const entries = [...candidateEvs.entries()].sort((a, b) => b[1] - a[1]);
      const [winnerId, ev] = entries[0];
      const party = candidateParties[winnerId] ?? "independent";
      const color = partyColorMap.get(party) ?? partyColor(party);
      const name = candidateNames[winnerId] ?? "Unknown";
      const stateName = stateMap.get(stateId)?.name ?? stateId;
      const stateVotes = votesByStateAndCandidate.get(stateId);
      const totalStateVotes = stateVotes ? [...stateVotes.values()].reduce((s, v) => s + v, 0) : 0;
      const tooltipLines: string[] = [
        stateName,
        `${name}: ${ev} EV`,
        ...(entries.length > 1
          ? entries.slice(1).map(([cid, e]) => `${candidateNames[cid] ?? "Unknown"}: ${e} EV`)
          : []),
      ];

      if (totalStateVotes > 0 && stateVotes) {
        const voteEntries = [...stateVotes.entries()].sort((a, b) => b[1] - a[1]);
        tooltipLines.push("—");
        tooltipLines.push(
          ...voteEntries.map(([cid, v]) => {
            const pct = ((v / totalStateVotes) * 100).toFixed(1);
            return `${candidateNames[cid] ?? "Unknown"}: ${v.toLocaleString()} (${pct}%)`;
          })
        );
      }

      presidential[stateId] = {
        leadingParty: party,
        leadColor: color,
        candidateName: name,
        ev,
        tooltip: tooltipLines,
      };
    }

    const electoralVotesByCandidate: Record<string, number> = {};
    for (const candidateEvs of evByStateAndCandidate.values()) {
      for (const [cid, ev] of candidateEvs) {
        electoralVotesByCandidate[cid] = (electoralVotesByCandidate[cid] ?? 0) + ev;
      }
    }

    if (Object.keys(electoralVotesByCandidate).length > 0) {
      presidentialElectoralVotes = electoralVotesByCandidate;
      presidentialCandidateNames = candidateNames;
      presidentialCandidateParties = candidateParties;
      presidentialCandidateColors = buildCandidateColors(electoralVotesByCandidate);
    }
  } else if (Object.keys(totalVotes).length > 0) {
    const total = Object.values(totalVotes).reduce((s, v) => s + v, 0);
    if (total > 0) {
      const electoralVotesByCandidate: Record<string, number> = {};
      const sorted = Object.entries(totalVotes)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
      let remaining = totalElectoralVotes;

      for (let i = 0; i < sorted.length; i++) {
        const pct = sorted[i][1] / total;
        const ev = i === sorted.length - 1 ? remaining : Math.round(pct * totalElectoralVotes);
        electoralVotesByCandidate[sorted[i][0]] = Math.max(0, ev);
        remaining -= ev;
      }

      presidentialElectoralVotes = electoralVotesByCandidate;
      presidentialCandidateNames = candidateNames;
      presidentialCandidateParties = candidateParties;
      presidentialCandidateColors = buildCandidateColors(electoralVotesByCandidate);

      // Per-state EV totals from the active units bundle (sums ME/NE splits).
      const evByStateTotal = new Map<string, number>();
      for (const u of evUnits) {
        evByStateTotal.set(u.stateId, (evByStateTotal.get(u.stateId) ?? 0) + u.ev);
      }
      const stateEvList = [...evByStateTotal.entries()].sort((a, b) => b[1] - a[1]);
      let stateIdx = 0;

      for (const [cid, ev] of Object.entries(electoralVotesByCandidate)
        .filter(([, e]) => e > 0)
        .sort((a, b) => b[1] - a[1])) {
        let evAssigned = 0;
        while (evAssigned < ev && stateIdx < stateEvList.length) {
          const [stateId, stateEv] = stateEvList[stateIdx];
          const party = candidateParties[cid] ?? "independent";
          const color = partyColorMap.get(party) ?? partyColor(party);
          const name = candidateNames[cid] ?? "Unknown";
          presidential[stateId] = {
            leadingParty: party,
            leadColor: color,
            candidateName: name,
            ev: stateEv,
            tooltip: [`${name}: ${stateEv} EV (projected from national vote)`],
          };
          evAssigned += stateEv;
          stateIdx++;
        }
      }
    }
  }

  return {
    presidential,
    presidentialElectoralVotes,
    presidentialCandidateNames,
    presidentialCandidateParties,
    presidentialCandidateColors,
    totalElectoralVotes,
  };
}
