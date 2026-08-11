"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RaceList,
  type Race,
} from "@/app/country/[code]/region/[id]/office/tabs/endorsements/RaceList";
import type { CountryId } from "@/lib/constants/countries";
import { GUBERNATORIAL_ACTION_CAP } from "@/lib/constants/governorOffice";

interface ActiveEndorsement {
  _id: string;
  electionId: string;
  candidateId: string;
  candidateName: string;
  targetStateId: string;
}

interface StateOpt {
  id: string;
  name: string;
}

interface ApiResponse {
  countryId: CountryId;
  viewerIsLeader: boolean;
  viewerIsAdmin: boolean;
  myParty: string | null;
  gubernatorialActions: number;
  actionCost: number;
  states: StateOpt[];
  selectedState: string | null;
  activeEndorsements: ActiveEndorsement[];
  availableRaces: Race[];
}

interface Props {
  countryId: CountryId;
}

/**
 * Federal-scope endorsements tab. The sitting head of government (President /
 * PM / Chancellor) can endorse sub-presidential candidates in any state
 * filtered via the dropdown. Cross-party endorsements blocked server-side.
 */
export function WhiteHouseEndorsementsTab({ countryId }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<string>("");
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (stateId: string) => {
      setLoading(true);
      try {
        const url = new URL(
          `/api/country/${countryId.toLowerCase()}/executive/endorsements`,
          window.location.origin
        );
        if (stateId) url.searchParams.set("state", stateId);
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as ApiResponse;
          setData(json);
          if (!selectedState && json.states.length > 0) {
            setSelectedState(json.states[0].id);
          }
        } else {
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [countryId, selectedState]
  );

  useEffect(() => {
    void fetchData(selectedState);
  }, [fetchData, selectedState]);

  async function withdraw(id: string) {
    setWithdrawingId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryId.toLowerCase()}/executive/endorsements/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Withdraw failed.");
      } else {
        await fetchData(selectedState);
      }
    } finally {
      setWithdrawingId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted">
        Loading endorsements…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-sm text-muted text-center">
        Unable to load endorsements.
      </div>
    );
  }

  const endorseEndpoint = `/api/country/${countryId.toLowerCase()}/executive/endorsements`;
  const canEndorse = data.viewerIsLeader && data.gubernatorialActions >= data.actionCost;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">
          Office AP{" "}
          <span className="font-semibold text-foreground">{data.gubernatorialActions}</span>/
          {GUBERNATORIAL_ACTION_CAP} · Cost{" "}
          <span className="font-semibold text-foreground">{data.actionCost}</span> per endorsement
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="exec-endorse-state" className="text-xs text-muted">
            Filter by state
          </label>
          <select
            id="exec-endorse-state"
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm"
          >
            {data.states.length === 0 && <option value="">— No states —</option>}
            {data.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Active endorsements</h2>
        {error && <p className="text-sm text-error mb-2">{error}</p>}
        {data.activeEndorsements.length === 0 ? (
          <p className="text-sm text-muted">No active endorsements.</p>
        ) : (
          <ul className="space-y-2">
            {data.activeEndorsements.map((e) => (
              <li
                key={e._id}
                className="rounded-lg border border-card-border bg-card p-3 flex items-center justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium">{e.candidateName}</div>
                  <div className="text-xs text-muted">State: {e.targetStateId}</div>
                </div>
                <button
                  onClick={() => withdraw(e._id)}
                  disabled={!data.viewerIsLeader || withdrawingId === e._id}
                  className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:bg-background/60 disabled:opacity-50"
                >
                  {withdrawingId === e._id ? "Withdrawing…" : "Withdraw"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">
          Eligible races{data.selectedState ? ` in ${data.selectedState}` : ""}
        </h2>
        {!canEndorse && data.viewerIsLeader && (
          <p className="mb-2 text-xs text-warning">
            Insufficient Office AP — endorsements require {data.actionCost} AP.
          </p>
        )}
        <RaceList
          races={data.availableRaces}
          countryId={countryId}
          stateId={data.selectedState ?? ""}
          viewerIsHolder={canEndorse}
          onChange={() => fetchData(selectedState)}
          endorseEndpoint={endorseEndpoint}
        />
      </section>
    </div>
  );
}
