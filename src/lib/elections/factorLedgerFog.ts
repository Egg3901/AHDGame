/**
 * Fog-of-war for the presidential factor ledger.
 *
 * The national factor waterfall is public for every candidate — it is the
 * headline "why is this candidate ahead" breakdown. But two slices leak more
 * than a spectator should see, so they are stripped for candidates the viewer
 * does not own (admins own everyone):
 *
 *  - `bucketAppeal` — where a candidate's support comes from by census bucket.
 *  - the per-unit breakdown (`byCandidateUnit`) — the state-by-state ledger.
 *
 * This mirrors the Support fog on the persuasion card: opponents' internals
 * stay hidden while the shared, already-public national picture is kept.
 */

import type { FactorLedgerSnapshot } from "@/lib/electionEngine/factorLedger";

export function applyFactorLedgerFogOfWar(
  snapshot: FactorLedgerSnapshot,
  ownedCandidateIds: ReadonlySet<string>
): FactorLedgerSnapshot {
  const byCandidateNational = snapshot.byCandidateNational.map((c) =>
    ownedCandidateIds.has(c.candidateId)
      ? c
      : {
          candidateId: c.candidateId,
          nominalWeight: c.nominalWeight,
          finalVotes: c.finalVotes,
          factors: c.factors,
        }
  );

  return {
    recordedTurn: snapshot.recordedTurn,
    byCandidateNational,
    ...(snapshot.byCandidateUnit
      ? {
          byCandidateUnit: snapshot.byCandidateUnit.filter((u) =>
            ownedCandidateIds.has(u.candidateId)
          ),
        }
      : {}),
  };
}
