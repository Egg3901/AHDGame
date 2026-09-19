"use client";

import { useCallback, useEffect, useState } from "react";
import { regionPartyApiUrl } from "@/lib/urls";
import { useToast } from "@/contexts/ToastContext";
import {
  InfluencePanelLoading,
  InfluencePanelError,
} from "@/components/influence/InfluencePanelShared";
import type { ActionOption, NPPOption } from "@/components/influence/types";
import { NppRosterPanel } from "@/components/influence/NppRosterPanel";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

interface StatePartyInfluenceData {
  partyId: string;
  partyName: string;
  stateId: string;
  politicalStrength: number;
  treasury: number;
  nppActionPoints: number;
  nppActionPointCap: number;
  nppActionPointRegen: number;
  actions: ActionOption[];
  npps: NPPOption[];
}

interface StatePartyInfluencePanelProps {
  countryId: string;
  stateId: string;
  stateName: string;
  partyId: string;
  partyColor: string;
  onPartyRefresh?: () => void | Promise<void>;
}

export function StatePartyInfluencePanel({
  countryId,
  stateId,
  stateName,
  partyId,
  partyColor,
  onPartyRefresh,
}: StatePartyInfluencePanelProps) {
  const currencyCode = COUNTRY_CONFIGS[countryId.toUpperCase() as CountryId]?.currencyCode ?? "USD";
  const { showToast } = useToast();
  const [data, setData] = useState<StatePartyInfluenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {
      try {
        // Background refreshes (after an action) skip the full-panel loading swap so
        // the roster stays mounted and the NPP selection is preserved.
        if (!background) setLoading(true);
        setError("");
        const res = await fetch(`${regionPartyApiUrl(countryId, stateId, partyId)}/influence`);
        if (res.ok) {
          setData(await res.json());
        } else if (res.status === 401 || res.status === 403) {
          setData(null);
        } else {
          const json = await res.json();
          setError(json.error || "Failed to load state party NPP management");
        }
      } catch {
        setError("Network error");
      } finally {
        if (!background) setLoading(false);
      }
    },
    [countryId, partyId, stateId]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExecute = useCallback(
    async (nppId: string, type: ActionOption["type"]) => {
      try {
        const res = await fetch(`${regionPartyApiUrl(countryId, stateId, partyId)}/influence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nppId, influenceType: type, fundAmount: 0, context: {} }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          if (json.message) showToast(json.message, json.success ? "success" : "info");
          await fetchData({ background: true });
          await onPartyRefresh?.();
          return { ok: true };
        }
        setError(json.error || "Failed to execute state party influence");
        return { ok: false };
      } catch {
        setError("Network error");
        return { ok: false };
      }
    },
    [countryId, stateId, partyId, fetchData, onPartyRefresh, showToast]
  );

  if (!loading && !data && !error) return null;
  if (loading) return <InfluencePanelLoading />;
  if (error && !data) return <InfluencePanelError message={error} />;
  if (!data) return null;

  const rosterNpps = data.npps.map((n) => ({ ...n, homeState: stateId }));

  return (
    <div
      className="rounded-xl border p-6"
      style={{ borderColor: `${partyColor}50`, backgroundColor: `${partyColor}10` }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">State Party NPP Management</h2>
        <div className="flex items-center gap-4 text-sm">
          <span>
            <span className="text-muted">Action Points: </span>
            <span className="font-medium">
              {data.nppActionPoints ?? 0} / {data.nppActionPointCap ?? 0}
            </span>
            <span className="ml-1 text-xs text-muted">(+{data.nppActionPointRegen ?? 0}/turn)</span>
          </span>
        </div>
      </div>

      <div className="mb-4 rounded-lg bg-secondary/10 p-3 text-sm text-secondary">
        State party leadership can manage same-party NPPs who call {stateName} home. Favorability
        and influence work is direct, while loyalty and cooperation requests get a modest local edge
        behind the scenes.
      </div>

      {error && <InfluencePanelError message={error} />}

      {data.npps.length === 0 ? (
        <div className="py-4 text-center text-muted">
          No same-party NPPs in {stateName} currently qualify for state party management.
        </div>
      ) : (
        <NppRosterPanel
          scope="state"
          npps={rosterNpps}
          actions={data.actions}
          currency={currencyCode}
          onExecute={handleExecute}
        />
      )}
    </div>
  );
}
