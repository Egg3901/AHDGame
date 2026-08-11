"use client";

import { useEffect, useState } from "react";
import { SubdivisionMap } from "@/components/SubdivisionMap";

interface CdDistrict {
  cd: string;
  path: string;
  cookPVI: number;
}

interface CdDataResponse {
  viewBox: string;
  districts: CdDistrict[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: CdDataResponse }
  | { kind: "error"; message: string };

/**
 * House-tier drilldown: when a state is selected, fetch the state's CD
 * geometry and render every district shape colored by the party-primary
 * leader's color. House primaries are statewide in this codebase — every
 * district in the state receives the same fill — but rendering the
 * district shapes makes the visualization read as a district-level map
 * (and lays the groundwork for a future per-district primary projection
 * to slot in).
 */
export function HousePrimaryDistrictDrilldown({
  stateId,
  electionId: _electionId,
  candidateColors,
  candidateNames,
  leaderCandidateId,
  leaderMargin = 0,
}: {
  stateId: string;
  electionId: string | null;
  /** Map of candidateId → fill color. */
  candidateColors: Record<string, string>;
  /** Map of candidateId → display name. Used by the district hover tooltip. */
  candidateNames: Record<string, string>;
  /**
   * The candidate currently leading the state's primary. Every district
   * is attributed to this candidate since House primaries resolve
   * statewide — `null` if the contest has no candidates yet.
   */
  leaderCandidateId: string | null;
  /**
   * Margin in percentage points between the leader and the runner-up
   * (sharePct difference). Surfaced as the district tooltip's "Margin:"
   * field. Defaults to 0 — useful when there's only one candidate
   * filed, where there's no runner-up to subtract.
   */
  leaderMargin?: number;
}) {
  // The loaded data is keyed by the stateId it was fetched for, so a stale
  // response for a previously-selected state can't paint over the current
  // selection. Rendering compares `load.stateId === stateId` and shows the
  // loading skeleton when they diverge — no synchronous setState reset
  // needed inside the effect (which the react-hooks/set-state-in-effect
  // rule rejects).
  const [load, setLoad] = useState<{ stateId: string; state: LoadState }>({
    stateId,
    state: { kind: "loading" },
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/congressional-districts/${stateId.toUpperCase()}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`No CD data (${res.status})`);
        return res.json() as Promise<CdDataResponse>;
      })
      .then((data) => {
        setLoad({ stateId, state: { kind: "ready", data } });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setLoad({ stateId, state: { kind: "error", message: err.message } });
      });
    return () => controller.abort();
  }, [stateId]);

  const isCurrentLoad = load.stateId === stateId;
  const cdData = isCurrentLoad && load.state.kind === "ready" ? load.state.data : null;
  const loadError = isCurrentLoad && load.state.kind === "error" ? load.state.message : null;

  if (loadError) {
    return (
      <div className="rounded-md border border-card-border/40 bg-background/30 p-3 text-[11px] text-muted">
        District map unavailable for {stateId} ({loadError}).
      </div>
    );
  }

  if (!cdData) {
    return (
      <div className="rounded-md border border-card-border/40 bg-background/30 p-3 text-[11px] text-muted">
        Loading {stateId} district map…
      </div>
    );
  }

  // House primaries resolve statewide — every district in this state
  // shares the same primary leader. Pick the leader's id + color (or a
  // neutral grey if no candidates) and pre-build the district records the
  // shared SubdivisionMap component expects. The `winner` field for each
  // district is the leader's candidateId so the map's hover tooltip can
  // resolve it through `candidateNames` instead of rendering "Unknown".
  const leaderColor =
    leaderCandidateId && candidateColors[leaderCandidateId]
      ? candidateColors[leaderCandidateId]
      : "#2a2a2a";

  const districts = cdData.districts.map((d) => ({
    id: d.cd,
    name: d.cd,
    path: d.path,
    leanScalar: d.cookPVI,
    winner: leaderCandidateId ?? "",
    party: "primary-leader",
    margin: leaderMargin ?? 0,
  }));

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-card-border/40 bg-background/30 p-2">
        <SubdivisionMap
          viewBox={cdData.viewBox}
          subdivisions={districts}
          candidateNames={candidateNames}
          candidateParties={{ "primary-leader": "primary-leader" }}
          partyColors={{ "primary-leader": leaderColor }}
        />
      </div>
      <p className="text-[10px] text-muted/70 leading-relaxed">
        House primaries are tallied statewide. Each district shape is rendered for context but
        shares the state-level leader&apos;s color — per-district primary breakdowns aren&apos;t
        modeled yet. General-election district margins land on the per-state election page.
      </p>
    </div>
  );
}
