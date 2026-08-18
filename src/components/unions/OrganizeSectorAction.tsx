"use client";

import { useEffect, useState } from "react";
import { organizeSectorTreasuryCost } from "@/lib/unions/organizeSectorEconomy";

interface MyUnion {
  id: string;
  countryId: string;
  sectorType: string;
  name: string;
  /** Action points a targeted sector drive costs, quoted by the union route. */
  organizeActionCost: number;
}

interface OrganizeSectorActionProps {
  countryId: string;
  sectorType: string;
  sectorId: string;
  /** Current workforce; used to quote a size-scaled treasury cost. */
  workers?: number;
  /** Current unionization 0-100; used when reinforcing an already-held shop. */
  unionization?: number;
  /** Union currently holding this sector's representation, or null if none. */
  representingUnionId?: string | null;
  representingUnionName?: string | null;
  /** Called after a successful organize/raid, so the caller can refetch the sector. */
  onOrganized?: () => void;
}

/**
 * Lets a union head organize (or raid) ONE sector directly from the sector's
 * own view, rather than needing to already hold every sector in an industry
 * before anything shows up on the union page. Invisible to everyone else: it
 * self-checks whether the viewing character heads a union matching this
 * sector's country and industry before rendering anything.
 *
 * Costs are quoted from `GET /api/unions/[id]`, which returns the targeted
 * drive's own action-point and treasury price rather than the cheaper
 * rank-and-file organize drive's. The treasury charge is stated up front and
 * called out as payable win or lose on a raid, because a failed raid still
 * bills the attacker and finding that out afterwards would feel like a bug.
 */
export function OrganizeSectorAction({
  countryId,
  sectorType,
  sectorId,
  workers,
  unionization,
  representingUnionId,
  representingUnionName,
  onOrganized,
}: OrganizeSectorActionProps) {
  const [myUnion, setMyUnion] = useState<MyUnion | null>(null);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMyUnion() {
      try {
        const meRes = await fetch("/api/character/me");
        if (!meRes.ok) return;
        const meData = await meRes.json();
        const unionId: string | null = meData.character?.unionLeaderOf ?? null;
        if (!unionId) return;
        const unionRes = await fetch(`/api/unions/${unionId}`);
        if (!unionRes.ok) return;
        const unionData = await unionRes.json();
        if (cancelled || !unionData.union) return;
        setMyUnion({
          id: unionData.union.id,
          countryId: unionData.union.countryId,
          sectorType: unionData.union.sectorType,
          name: unionData.union.name,
          organizeActionCost:
            unionData.union.organizeSectorActionCost ?? unionData.union.organizeActionCost ?? 0,
        });
      } catch {
        // Silent: this is a self-gating affordance, not a data surface that
        // owes anyone an error state when it can't determine eligibility.
      } finally {
        if (!cancelled) setChecked(true);
      }
    }
    loadMyUnion();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!checked) return null;
  const eligible = myUnion && myUnion.countryId === countryId && myUnion.sectorType === sectorType;
  if (!eligible || !myUnion) return null;

  const alreadyOurs = representingUnionId != null && representingUnionId === myUnion.id;
  const isRaid = representingUnionId != null && !alreadyOurs;
  const treasuryCost = organizeSectorTreasuryCost({
    workers,
    unionization,
    isOwnSector: alreadyOurs,
  });

  async function handleOrganize() {
    if (!myUnion) return;
    setPending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/unions/${myUnion.id}/organize-sector`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectorId }),
      });
      const data = await res.json();
      setResult({
        ok: res.ok,
        text: res.ok
          ? (data.message ?? (isRaid ? "Raid succeeded." : "Sector organized."))
          : (data.error ?? (isRaid ? "The raid failed." : "Failed to organize this sector.")),
      });
      if (res.ok) onOrganized?.();
    } catch {
      setResult({ ok: false, text: "Network error. Nothing was spent." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <h3 className="mb-1 text-sm font-bold text-foreground">Union Organizing</h3>
      <p className="mb-2 text-xs text-muted">
        You lead <span className="font-medium text-foreground">{myUnion.name}</span>, which
        organizes this industry in this country.
      </p>

      {alreadyOurs ? (
        <>
          <p className="mb-2 text-xs text-muted">
            Your union already organizes this sector. Another drive raises unionization further.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={handleOrganize}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? "Working…" : "Organize This Sector"}
          </button>
          <span className="ml-2 text-[11px] text-muted">
            Costs {myUnion.organizeActionCost} action points and{" "}
            {treasuryCost.toLocaleString("en-US")} from the treasury
          </span>
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">
            {isRaid ? (
              <>
                Currently represented by{" "}
                <span className="font-medium text-foreground">
                  {representingUnionName ?? "a rival union"}
                </span>
                . Organizing here is a raid: your union tries to take representation of this sector
                away from theirs. A failed raid still costs the same.
              </>
            ) : (
              "This sector is currently unrepresented."
            )}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={handleOrganize}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
              isRaid ? "bg-error hover:bg-error/90" : "bg-primary hover:bg-primary/90"
            }`}
          >
            {pending ? "Working…" : isRaid ? "Raid This Sector" : "Organize This Sector"}
          </button>
          <span className="ml-2 text-[11px] text-muted">
            Costs {myUnion.organizeActionCost} action points and{" "}
            {treasuryCost.toLocaleString("en-US")} from the treasury
            {isRaid ? ", win or lose" : ""}
          </span>
        </>
      )}

      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`mt-2 text-xs font-medium ${result.ok ? "text-success" : "text-error"}`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
