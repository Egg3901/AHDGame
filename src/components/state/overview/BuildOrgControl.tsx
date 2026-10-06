"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OverviewViewModel } from "@/lib/states/overview/types";
import { useToast } from "@/contexts/ToastContext";
import { regionPartyApiUrl } from "@/lib/urls";
import { usePsSpendScope } from "@/components/state/politics/orgActions/usePsSpendScope";
import { useActionPreview } from "@/components/state/politics/orgActions/useActionPreview";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { apiErrorText } from "@/lib/errors/catalog";

type BuildOrgPreview =
  | {
      ok: true;
      effectiveCost: number;
      projectedGain: number;
      contributionUnits: number;
      /** Cash price of the next click. Absent on a pre-2026-09-02 response. */
      cashPrice?: number;
      /** Below 1 when the treasury can only part-fund the cash price. */
      fundedFraction?: number;
    }
  | { ok: false };

/**
 * The Organization pool's call to action: the viewer party's standing, the
 * Build Org button(s) and the next-click estimate. Sits under the pool's
 * legend on the Overview tab, so it carries no heading or legend of its own.
 *
 * The Build Org button spends Political Strength inline (no navigation):
 * each click deposits one fixed unit into the viewer party's regional bucket.
 */
export function BuildOrgControl({
  vm,
  viewerPartyId,
}: {
  vm: OverviewViewModel;
  viewerPartyId?: string | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [bumpKey, setBumpKey] = useState(0);
  // Authoritative next-click estimate returned by the last successful spend.
  // Applied immediately so the estimate line can't lag the escalating pressure
  // ladder during rapid building; cleared once the async refetch below lands a
  // fresh server projection (which reconciles cross-surface / cross-turn changes).
  const [liveEstimate, setLiveEstimate] = useState<BuildOrgPreview | null>(null);

  // Which PS pools the viewer may spend from here (state / national / both).
  // Only a character holding BOTH a national and a state role for this party
  // gets the dual State/National buttons; everyone else keeps the single-button
  // form. Failure degrades gracefully (server resolves the canonical pool).
  const { eligibleScopes, poolPS } = usePsSpendScope(
    vm.countryId,
    vm.stateId,
    viewerPartyId ?? null,
    !!viewerPartyId
  );

  const { focusPartyAbbr, narrative, partyOrg } = vm;
  const isLeader = narrative.rank === 1;
  // Detect a top-Org tie: more than one party shares the leader's orgPct
  // (within a small epsilon to absorb floating-point noise from the
  // server's `Math.round(* 100) / 100` precision).
  const topOrgPct = partyOrg[0]?.orgPct ?? 0;
  const TIE_EPSILON = 0.01;
  const tiedAtTop = partyOrg.filter((p) => Math.abs(p.orgPct - topOrgPct) <= TIE_EPSILON);
  const isTie = tiedAtTop.length > 1;

  const standingLine = (() => {
    if (!focusPartyAbbr) return "No party currently has organization in this state.";
    if (isLeader && isTie) {
      const others = tiedAtTop.filter((p) => p.abbr !== focusPartyAbbr).map((p) => p.abbr);
      const otherList =
        others.length === 1
          ? others[0]
          : others.length === 2
            ? `${others[0]} and ${others[1]}`
            : `${others.slice(0, -1).join(", ")}, and ${others[others.length - 1]}`;
      return `${focusPartyAbbr} is tied with ${otherList} at ${topOrgPct.toFixed(1)}% Org.`;
    }
    if (isLeader) {
      return `${focusPartyAbbr} leads the state with ${topOrgPct.toFixed(1)}% Org.`;
    }
    return (
      `${focusPartyAbbr} ranks ${narrative.rank} of ${narrative.totalParties}, ` +
      `${narrative.gapToTop.toFixed(1)} points behind the leader.`
    );
  })();

  const buildOrgUrl = viewerPartyId
    ? `/api/country/${vm.countryId.toLowerCase()}/region/${vm.stateId.toUpperCase()}/party/${encodeURIComponent(viewerPartyId)}/build-org`
    : null;

  // Pre-click projection for the compact estimate line. `bumpKey` bumps after
  // each spend so the next-click estimate refreshes (alongside router.refresh()
  // for the pie).
  const apiBase = viewerPartyId ? regionPartyApiUrl(vm.countryId, vm.stateId, viewerPartyId) : null;
  // Build Org bills a treasury denominated in the country's own currency.
  const buildOrgCurrency =
    COUNTRY_CURRENCY_MAP[vm.countryId.toUpperCase() as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
  const { preview: buildPreview } = useActionPreview<BuildOrgPreview>(
    apiBase ? `${apiBase}/build-org/preview` : null,
    { enabled: !!apiBase, refetchKey: bumpKey }
  );

  // Once a fresh refetch resolves, defer to it (it reflects any cross-surface or
  // cross-turn pressure changes the optimistic value can't see).
  useEffect(() => {
    setLiveEstimate(null);
  }, [buildPreview]);

  // Prefer the just-committed authoritative estimate over the (possibly stale)
  // refetched one.
  const estimate = liveEstimate ?? buildPreview;

  const handleBuildOrg = async (psPool?: "state" | "national") => {
    if (!buildOrgUrl) return;
    setBusy(true);
    try {
      const r = await fetch(buildOrgUrl, {
        method: "POST",
        headers: psPool ? { "Content-Type": "application/json" } : undefined,
        body: psPool ? JSON.stringify({ psPool }) : undefined,
      });
      const d = await r.json();
      if (!r.ok) {
        showToast(apiErrorText(d, "Build Org failed"), "error");
        return;
      }
      const cashCost = d.cashCost as number | undefined;
      const cash =
        cashCost !== undefined
          ? ` and ${CURRENCY_SYMBOLS[buildOrgCurrency as keyof typeof CURRENCY_SYMBOLS] ?? "$"}${Math.round(cashCost).toLocaleString("en-US")}`
          : "";
      showToast(
        `+${(d.contributionUnits as number).toFixed(0)} Org unit, share ${(d.orgGain as number) >= 0 ? "+" : ""}${(d.orgGain as number).toFixed(2)}% for ${(d.psCost as number).toFixed(0)} PS${cash}`,
        "success"
      );
      // Apply the server's next-click estimate immediately so the line reflects
      // the escalated pressure ladder without waiting on the async refetch.
      setLiveEstimate((d.nextPreview as BuildOrgPreview | undefined) ?? null);
      setBumpKey((k) => k + 1);
      router.refresh();
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusy(false);
    }
  };

  // Gate on party membership, not on whether the party already holds an Org
  // row here. A party can have genuine presence (a player / NPP / official)
  // in a state with no seeded Org row (e.g. CDU in Bayern); the Build Org
  // route bootstraps the 0% row on first use. Presence itself is enforced
  // server-side — the route rejects with a clear message when the party has no
  // foothold, so we don't duplicate that check client-side.
  const buildOrgDisabled = !viewerPartyId || busy;
  const buildOrgTitle = !viewerPartyId
    ? "Join a party to build Org in this state"
    : "Spend Political Strength to grow your party's Org in this state (requires a player or official here)";

  const buttonClass =
    "rounded-lg bg-primary px-3.5 py-2 text-body font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mt-4 space-y-3">
      <p className="text-body text-muted">{standingLine}</p>

      <div className="flex flex-wrap items-center gap-2">
        {eligibleScopes?.state || eligibleScopes?.national ? (
          <>
            {eligibleScopes?.state && (
              <button
                type="button"
                onClick={() => handleBuildOrg("state")}
                disabled={buildOrgDisabled}
                className={buttonClass}
                title={
                  poolPS
                    ? `Build Org from state pool (${poolPS.statePoolPS.toFixed(0)} PS)`
                    : buildOrgTitle
                }
              >
                {busy ? "Building…" : "Build org with state PS"}
              </button>
            )}
            {eligibleScopes?.national && (
              <button
                type="button"
                onClick={() => handleBuildOrg("national")}
                disabled={buildOrgDisabled}
                className={buttonClass}
                title={
                  poolPS
                    ? `Build Org from national pool (${poolPS.nationalPoolPS.toFixed(0)} PS)`
                    : buildOrgTitle
                }
              >
                {busy ? "Building…" : "Build org with national PS"}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => handleBuildOrg()}
            disabled={buildOrgDisabled}
            className={buttonClass}
            title={buildOrgTitle}
          >
            {busy ? "Building…" : "Build org"}
          </button>
        )}
        {!viewerPartyId && (
          <span className="text-body-sm text-muted">Join a party to build Org here.</span>
        )}
      </div>

      {estimate?.ok ? (
        <div className="space-y-0.5">
          <p className="text-body-sm text-muted">
            Next click costs{" "}
            <span className="font-medium tabular-nums text-foreground">
              {estimate.effectiveCost.toFixed(0)} PS
              {estimate.cashPrice !== undefined
                ? ` and ${CURRENCY_SYMBOLS[buildOrgCurrency as keyof typeof CURRENCY_SYMBOLS] ?? "$"}${Math.round(estimate.cashPrice).toLocaleString("en-US")}`
                : ""}
            </span>{" "}
            for{" "}
            <span className="font-medium tabular-nums text-foreground">
              +{estimate.contributionUnits.toFixed(0)} unit (
              {estimate.projectedGain >= 0 ? "+" : ""}
              {estimate.projectedGain.toFixed(2)}% share)
            </span>
            .
          </p>
          {estimate.fundedFraction !== undefined && estimate.fundedFraction < 1 ? (
            <span className="block text-body-sm text-warning">
              Partly funded: the treasury covers {Math.round(estimate.fundedFraction * 100)}% of
              this click.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
