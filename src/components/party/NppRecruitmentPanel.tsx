"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/contexts/ToastContext";
import { Skeleton } from "@/components/ui";
import { useGameClock } from "@/contexts/useGameClock";
import { regionApiSubUrl, partyApiUrl } from "@/lib/urls";
import { NppRecruitSegment } from "@/components/influence/NppRecruitSegment";
import { NppSlotTierTable } from "@/components/influence/NppSlotTierTable";
import { formatLocalFunds } from "@/lib/actions";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

interface NppRecruitmentPanelProps {
  partyId: string;
  countryId: string;
  stateId?: string;
  isNational: boolean;
}

// Response shapes from the APIs
interface RecruitmentStatus {
  cooldownUntil: string | null;
  cooldownRemaining: number | null; // seconds
  partyNPPCount: number;
  canRecruit: boolean;
  isLeadership: boolean;
  // Action Point pool (scope-appropriate)
  actionCost?: number;
  fundCost?: number;
  nppActionPoints?: number;
  nppActionPointCap?: number;
  nppActionPointRegen?: number;
  // State-only fields
  stateNPPCount?: number;
  stateOrg?: number;
  maxSlots?: number;
  availableSlots?: number;
  stateTreasury?: number;
  isStateLeadership?: boolean;
}

interface StateOption {
  stateId: string;
  stateName: string;
  stateOrg: number;
  currentNPPs: number;
  maxSlots: number;
  availableSlots: number;
  actionCost: number;
  canRecruit: boolean;
  hasStateLeadership: boolean;
}

interface StatesData {
  states: StateOption[];
  nppActionPoints: number;
  nppActionPointCap: number;
  nppActionPointRegen: number;
  recruitFundCost: number;
  partyTreasury: number;
  partyNPPCount: number;
}

export function NppRecruitmentPanel({
  partyId,
  countryId,
  stateId,
  isNational,
}: NppRecruitmentPanelProps) {
  const currencyCode = COUNTRY_CONFIGS[countryId.toUpperCase() as CountryId]?.currencyCode ?? "USD";
  const { showToast } = useToast();
  const clock = useGameClock();

  const [status, setStatus] = useState<RecruitmentStatus | null>(null);
  const [statesData, setStatesData] = useState<StatesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStateId, setSelectedStateId] = useState("");
  const [recruiting, setRecruiting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const statusUrl = isNational
    ? `${partyApiUrl(countryId, partyId)}/recruitment`
    : stateId
      ? regionApiSubUrl(countryId, stateId, `party/${partyId}/recruitment`)
      : null;

  const statesUrl = isNational ? `${partyApiUrl(countryId, partyId)}/recruitment/states` : null;

  const fetchData = useCallback(async () => {
    if (!statusUrl) return;
    setLoading(true);
    try {
      const res = await fetch(statusUrl);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // 403 means not leadership — surface that, don't show an error toast
        if (res.status === 403) {
          setStatus(null);
          setLoading(false);
          return;
        }
        throw new Error(body?.error ?? `Failed to load recruitment status (${res.status})`);
      }
      const data: RecruitmentStatus = await res.json();
      setStatus(data);

      if (statesUrl) {
        const sRes = await fetch(statesUrl);
        if (sRes.ok) {
          const sData: StatesData = await sRes.json();
          setStatesData(sData);
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load recruitment data", "error");
    } finally {
      setLoading(false);
    }
  }, [statusUrl, statesUrl, showToast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, refreshKey]);

  const handleRecruit = async () => {
    setRecruiting(true);
    try {
      let url: string;
      let body: Record<string, unknown>;

      if (isNational) {
        url = `${partyApiUrl(countryId, partyId)}/recruitment/recruit`;
        body = { stateId: selectedStateId };
      } else if (stateId) {
        url = regionApiSubUrl(countryId, stateId!, `party/${partyId}/recruitment`);
        body = {};
      } else {
        showToast("Invalid configuration", "error");
        return;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        showToast(`Successfully recruited ${data.npp?.name ?? "new NPP"}!`, "success");
        setSelectedStateId("");
      } else {
        showToast(data.error ?? "Recruitment failed", "error");
      }
      // Always refresh to show current state (funds, cooldown) regardless of outcome
      setRefreshKey((k) => k + 1);
    } catch {
      showToast("Network error", "error");
    } finally {
      setRecruiting(false);
    }
  };

  const recruitInState = async (targetStateId: string): Promise<{ ok: boolean }> => {
    setRecruiting(true);
    try {
      const res = await fetch(`${partyApiUrl(countryId, partyId)}/recruitment/recruit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId: targetStateId }),
      });
      const d = await res.json().catch(() => ({}));
      showToast(
        res.ok
          ? `Successfully recruited ${d.npp?.name ?? "new NPP"}!`
          : (d.error ?? "Recruitment failed"),
        res.ok ? "success" : "error"
      );
      setRefreshKey((k) => k + 1);
      return { ok: res.ok };
    } catch {
      showToast("Network error", "error");
      return { ok: false };
    } finally {
      setRecruiting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[16rem] space-y-4">
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-14" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-36" />
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // User is not leadership — show informational message
  const isLeader = isNational ? status?.isLeadership : status?.isStateLeadership;

  if (!status || !isLeader) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted">
        Only party leadership can recruit NPP candidates.
      </div>
    );
  }

  // Cooldown info
  const cooldownSeconds = status.cooldownRemaining ?? 0;
  const hasCooldown = cooldownSeconds > 0;
  const cooldownHours = Math.ceil(cooldownSeconds / 3600);

  // For state panel: derive cost/slot info directly from status
  const stateActionCost = status.actionCost ?? 0;
  const stateAvailableSlots = status.availableSlots ?? 0;

  // For national panel: cost comes from selected state (segment owns its own UI).
  const selectedStateData = statesData?.states.find((s) => s.stateId === selectedStateId) ?? null;

  const canRecruitNow = isNational
    ? !hasCooldown && !!selectedStateId && !!selectedStateData?.canRecruit
    : !hasCooldown && status.canRecruit;

  return (
    <div className="space-y-4">
      {/* Cooldown bar */}
      {hasCooldown && status.cooldownUntil && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Recruitment on Cooldown</span>
            <span className="text-muted">
              {cooldownHours} hour{cooldownHours !== 1 ? "s" : ""} remaining
            </span>
          </div>
          <div className="w-full bg-muted/20 rounded-full h-2 overflow-hidden">
            {/* Progress bar: we don't have total cooldown duration here, so just show an
                indeterminate pulsing bar */}
            <div className="h-full bg-primary/60 rounded-full animate-pulse w-full" />
          </div>
          <p className="text-xs text-muted">
            Available after {clock.formatAbsoluteDeadline(status.cooldownUntil)}
          </p>
        </div>
      )}

      {/* State NPP info (state panel only) */}
      {!isNational && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Slots used</span>
            <span>
              {status.stateNPPCount ?? 0} / {status.maxSlots ?? 0}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Available slots</span>
            <span>{stateAvailableSlots}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">State org level</span>
            <span>{status.stateOrg ?? 0}</span>
          </div>
        </div>
      )}

      {/* Slot cap reference table (state panel) */}
      {!isNational && <NppSlotTierTable currentOrg={status.stateOrg ?? 0} />}

      {/* National: restyled recruit segment (state picker + slots/quality/cost + recruit). */}
      {isNational && statesData && !hasCooldown && (
        <NppRecruitSegment
          states={statesData.states}
          actionPoints={statesData.nppActionPoints}
          recruitFund={statesData.recruitFundCost}
          treasury={statesData.partyTreasury}
          currency={currencyCode}
          onRecruit={recruitInState}
        />
      )}

      {/* Cost display (state panel only — national uses the recruit segment above) */}
      {!isNational && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-1 text-sm">
          <p className="font-medium mb-2">Recruitment Cost</p>
          <div className="flex justify-between">
            <span className="text-muted">Action Points</span>
            <span>{stateActionCost}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Funds</span>
            <span className="text-green-400">
              {formatLocalFunds(status.fundCost ?? 0, currencyCode)}
            </span>
          </div>
          <div className="border-t border-card-border pt-1 mt-1" />
          <div className="flex justify-between text-muted">
            <span>State party Action Points</span>
            <span>
              {status.nppActionPoints ?? 0}
              {status.nppActionPointCap != null && ` / ${status.nppActionPointCap}`}
              {status.nppActionPointRegen != null && (
                <span className="ml-1 text-xs">(+{status.nppActionPointRegen}/turn)</span>
              )}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>State party treasury</span>
            <span>{formatLocalFunds(status.stateTreasury ?? 0, currencyCode)}</span>
          </div>
        </div>
      )}

      {/* Recruit button (state panel only) */}
      {!isNational && (
        <button
          onClick={handleRecruit}
          disabled={!canRecruitNow || recruiting}
          className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-medium transition-colors bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {recruiting
            ? "Recruiting..."
            : hasCooldown
              ? `On Cooldown (${cooldownHours}h remaining)`
              : "Recruit NPP Candidate"}
        </button>
      )}

      {/* No slots message for state panel */}
      {!isNational && !hasCooldown && stateAvailableSlots === 0 && (
        <p className="text-sm text-muted italic">No recruitment slots available in this state.</p>
      )}
    </div>
  );
}
