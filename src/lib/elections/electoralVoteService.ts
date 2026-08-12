import type { Db } from "mongodb";
import type { ElectionVoteTally, PoliticalParty } from "@/lib/db/types";
import { ELECTORAL_VOTE_UNITS, TOTAL_ELECTORAL_VOTES } from "@/lib/constants";
import { getPartyHex } from "@/lib/utils/politics";

export interface ElectoralMapState {
  color: string;
  label: string;
  tooltip: string[];
}

export interface StateVoteData {
  votesByCandidate: Record<string, number>;
  evByCandidate: Record<string, number>;
}

export interface EvByTurnPoint {
  turn: number;
  electoralVotesByCandidate: Record<string, number>;
}

export interface StateTurnSnapshot {
  turn: number;
  recordedAt: Date;
  cumulativeVotes: Record<string, number>;
  sharesPct: Record<string, number>;
}

export interface ElectoralVoteResult {
  electoralVotesByCandidate?: Record<string, number>;
  electoralMapData?: Record<string, ElectoralMapState>;
  stateVoteData?: Record<string, StateVoteData>;
  evByTurn?: EvByTurnPoint[];
  stateVotesOverTime?: Record<string, StateTurnSnapshot[]>;
}

export async function computeElectoralVotes(
  db: Db,
  voteTally: ElectionVoteTally | null,
  candidateNameMap: Map<string, string>,
  partyMap: Map<string, PoliticalParty>,
  units: { unitId: string; ev: number; stateId: string }[] = ELECTORAL_VOTE_UNITS
): Promise<ElectoralVoteResult> {
  if (!voteTally) {
    return {};
  }

  const getName = (cid: string): string => {
    const activeName = candidateNameMap.get(cid);
    if (activeName) return activeName;
    const tallyName = voteTally.candidateNames?.[cid];
    if (tallyName) return tallyName;
    const party = voteTally.candidateParties?.[cid];
    return party ? `Former ${party} candidate` : "Withdrawn candidate";
  };

  const partyColorForMap = (partyId: string, storedColor?: string): string => {
    return getPartyHex(partyId, storedColor);
  };

  let electoralVotesByCandidate: Record<string, number> | undefined =
    voteTally.electoralVotesByCandidate;

  const hasUnitVotes =
    voteTally.totalVotesByUnit &&
    Object.values(voteTally.totalVotesByUnit).some((uv) =>
      Object.values(uv ?? {}).some((v) => v > 0)
    );

  const needsEvCompute =
    !electoralVotesByCandidate || Object.keys(electoralVotesByCandidate).length === 0;

  // Compute electoral votes if not already computed
  if (needsEvCompute) {
    if (hasUnitVotes && voteTally.totalVotesByUnit) {
      electoralVotesByCandidate = {};
      for (const unit of units) {
        const unitVotes: Record<string, number> | undefined =
          voteTally.totalVotesByUnit[unit.unitId];
        if (!unitVotes) continue;
        const entries = Object.entries(unitVotes)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1]);
        if (entries.length > 0) {
          const winnerId = entries[0][0];
          electoralVotesByCandidate[winnerId] =
            (electoralVotesByCandidate[winnerId] ?? 0) + unit.ev;
        }
      }
    } else if (voteTally.totalVotes && Object.keys(voteTally.totalVotes).length > 0) {
      const total = Object.values(voteTally.totalVotes).reduce((s, v) => s + v, 0);
      if (total > 0) {
        electoralVotesByCandidate = {};
        const sorted = Object.entries(voteTally.totalVotes)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1]);
        let remaining = TOTAL_ELECTORAL_VOTES;
        for (let i = 0; i < sorted.length; i++) {
          const pct = sorted[i][1] / total;
          const ev = i === sorted.length - 1 ? remaining : Math.round(pct * TOTAL_ELECTORAL_VOTES);
          electoralVotesByCandidate[sorted[i][0]] = Math.max(0, ev);
          remaining -= ev;
        }
      }
    }
  }

  // Compute electoral map data
  let electoralMapData: Record<string, ElectoralMapState> | undefined;
  let stateVoteData: Record<string, StateVoteData> | undefined;

  if (hasUnitVotes || electoralVotesByCandidate) {
    const states = await db
      .collection<{ _id: string; name?: string }>("states")
      .find({}, { projection: { _id: 1, name: 1 } })
      .toArray();
    const stateNameMap = new Map(states.map((s) => [s._id, s.name ?? s._id]));

    if (hasUnitVotes && voteTally.totalVotesByUnit) {
      const evByStateAndCandidate = new Map<string, Map<string, number>>();
      const votesByStateAndCandidate = new Map<string, Map<string, number>>();

      for (const unit of units) {
        const unitVotes: Record<string, number> | undefined =
          voteTally.totalVotesByUnit[unit.unitId];
        if (!unitVotes) continue;
        const entries = Object.entries(unitVotes)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1]);
        const stateId = unit.stateId;

        if (!votesByStateAndCandidate.has(stateId)) {
          votesByStateAndCandidate.set(stateId, new Map());
        }
        const voteMap = votesByStateAndCandidate.get(stateId)!;
        for (const [cid, v] of Object.entries(unitVotes)) {
          voteMap.set(cid, (voteMap.get(cid) ?? 0) + v);
        }

        if (entries.length === 0) continue;
        const winnerId = entries[0][0];
        if (!evByStateAndCandidate.has(stateId)) {
          evByStateAndCandidate.set(stateId, new Map());
        }
        const stateMap = evByStateAndCandidate.get(stateId)!;
        stateMap.set(winnerId, (stateMap.get(winnerId) ?? 0) + unit.ev);
      }

      electoralMapData = {};
      for (const [stateId, candidateEvs] of evByStateAndCandidate) {
        const entries = [...candidateEvs.entries()].sort((a, b) => b[1] - a[1]);
        const [winnerId, ev] = entries[0];
        const party = voteTally.candidateParties?.[winnerId] ?? "independent";
        const partyObj = partyMap.get(party);
        const color = partyColorForMap(party, partyObj?.color);
        const name = getName(winnerId);
        const stateName = stateNameMap.get(stateId) ?? stateId;
        const voteMap = votesByStateAndCandidate.get(stateId);
        const totalVotes = voteMap ? [...voteMap.values()].reduce((s, v) => s + v, 0) : 0;
        const tooltipLines: string[] = [];

        if (voteMap && totalVotes > 0) {
          const sortedByVotes = [...voteMap.entries()]
            .filter(([cid]) => candidateNameMap.has(cid))
            .sort((a, b) => b[1] - a[1]);
          for (const [cid, votes] of sortedByVotes) {
            const pct = Math.round((votes / totalVotes) * 1000) / 10;
            const cname = getName(cid);
            const evForCandidate = candidateEvs.get(cid) ?? 0;
            tooltipLines.push(
              evForCandidate > 0
                ? `${cname}: ${votes.toLocaleString()} votes (${pct}%) · ${evForCandidate} EV`
                : `${cname}: ${votes.toLocaleString()} votes (${pct}%)`
            );
          }
        } else {
          tooltipLines.push(`${name}: ${ev} EV`);
          for (const [cid, e] of entries.slice(1)) {
            tooltipLines.push(`${getName(cid)}: ${e} EV`);
          }
        }

        electoralMapData[stateId] = { color, label: stateName, tooltip: tooltipLines };
      }

      stateVoteData = {};
      for (const [sid, voteMap] of votesByStateAndCandidate) {
        const evMap = evByStateAndCandidate.get(sid);
        stateVoteData[sid] = {
          votesByCandidate: Object.fromEntries(voteMap),
          evByCandidate: evMap ? Object.fromEntries(evMap) : {},
        };
      }
    } else if (electoralVotesByCandidate && Object.keys(electoralVotesByCandidate).length > 0) {
      const sorted = Object.entries(electoralVotesByCandidate)
        .filter(([, ev]) => ev > 0)
        .sort((a, b) => b[1] - a[1]);
      // Per-state EV totals derived from the active units bundle (sums ME/NE
      // at-large + district EV back into a single per-state figure).
      const evByStateTotal = new Map<string, number>();
      for (const u of units) {
        evByStateTotal.set(u.stateId, (evByStateTotal.get(u.stateId) ?? 0) + u.ev);
      }
      const stateEvList = [...evByStateTotal.entries()].sort((a, b) => b[1] - a[1]);
      let stateIdx = 0;
      electoralMapData = {};

      for (const [cid, ev] of sorted) {
        let evAssigned = 0;
        while (evAssigned < ev && stateIdx < stateEvList.length) {
          const [stateId, stateEv] = stateEvList[stateIdx];
          const party = voteTally.candidateParties?.[cid] ?? "independent";
          const partyObj = partyMap.get(party);
          const color = partyColorForMap(party, partyObj?.color);
          const name = getName(cid);
          const stateName = stateNameMap.get(stateId) ?? stateId;
          electoralMapData[stateId] = {
            color,
            label: stateName,
            tooltip: [`${name}: ${stateEv} EV (projected from national vote)`],
          };
          evAssigned += stateEv;
          stateIdx++;
        }
      }
    }
  }

  // Compute evByTurn and stateVotesOverTime from unitTurnSnapshots
  let evByTurn: EvByTurnPoint[] | undefined;
  let stateVotesOverTime: Record<string, StateTurnSnapshot[]> | undefined;

  if (voteTally.unitTurnSnapshots && Object.keys(voteTally.unitTurnSnapshots).length > 0) {
    const unitSnaps = voteTally.unitTurnSnapshots;
    const turnToIndex = new Map<number, number>();
    const allTurns = new Set<number>();
    for (const snaps of Object.values(unitSnaps)) {
      for (let i = 0; i < snaps.length; i++) {
        allTurns.add(snaps[i].turn);
      }
    }
    const sortedTurns = [...allTurns].sort((a, b) => a - b);
    sortedTurns.forEach((t, i) => turnToIndex.set(t, i));

    evByTurn = sortedTurns.map((turn) => {
      const evByCand: Record<string, number> = {};
      for (const unit of units) {
        const snaps = unitSnaps[unit.unitId];
        if (!snaps) continue;
        const snap = snaps.find((s) => s.turn === turn);
        if (!snap?.cumulativeVotes) continue;
        const entries = Object.entries(snap.cumulativeVotes)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1]);
        if (entries.length > 0) {
          const winnerId = entries[0][0];
          evByCand[winnerId] = (evByCand[winnerId] ?? 0) + unit.ev;
        }
      }
      return { turn, electoralVotesByCandidate: evByCand };
    });

    stateVotesOverTime = {};
    const stateUnits = new Map<string, typeof units>();
    for (const unit of units) {
      const list = stateUnits.get(unit.stateId) ?? [];
      list.push(unit);
      stateUnits.set(unit.stateId, list);
    }

    for (const [stateId, units] of stateUnits) {
      const turnToAgg: Map<number, { recordedAt: Date; votes: Record<string, number> }> = new Map();
      for (const unit of units) {
        const snaps = (unitSnaps[unit.unitId] ?? []).slice(-96);
        for (const s of snaps) {
          const agg = turnToAgg.get(s.turn);
          if (agg) {
            for (const [cid, v] of Object.entries(s.cumulativeVotes)) {
              agg.votes[cid] = (agg.votes[cid] ?? 0) + v;
            }
          } else {
            turnToAgg.set(s.turn, { recordedAt: s.recordedAt, votes: { ...s.cumulativeVotes } });
          }
        }
      }
      stateVotesOverTime[stateId] = [...turnToAgg.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([turn, { recordedAt, votes }]) => {
          const total = Object.values(votes).reduce((a, b) => a + b, 0);
          const sharesPct: Record<string, number> = {};
          for (const [cid, v] of Object.entries(votes)) {
            sharesPct[cid] = total > 0 ? Math.round((v / total) * 1000) / 10 : 0;
          }
          return { turn, recordedAt, cumulativeVotes: votes, sharesPct };
        });
    }
  }

  return {
    electoralVotesByCandidate,
    electoralMapData,
    stateVoteData,
    evByTurn,
    stateVotesOverTime,
  };
}
