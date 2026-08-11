"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OverviewViewModel } from "@/lib/states/overview/types";
import { useToast } from "@/contexts/ToastContext";
import { regionPartyApiUrl } from "@/lib/urls";
import { usePsSpendScope } from "@/components/state/politics/orgActions/usePsSpendScope";
import { useActionPreview } from "@/components/state/politics/orgActions/useActionPreview";
import { EstimateLine } from "@/components/state/politics/orgActions/EstimateLine";

const UNAFFILIATED_COLOR = "var(--card-border)";

type BuildOrgPreview = { ok: true; effectiveCost: number; projectedGain: number } | { ok: false };

/**
 * Narrative card that pairs with the all-party Org pie. Mirrors the
 * Registration Pool legend's row format (color dot + party abbr + %),
 * with the focus party's standing summary and a Build Org CTA underneath.
 *
 * "Org Pool" header label matches the pie's bottom label so the visual
 * pair reads as a single concept. Governor / regional-executive chip is
 * intentionally omitted here — it's already shown in the state header
 * strip directly above the tabs.
 *
 * The Build Org button spends Political Strength inline (no navigation):
 * each click grows the viewer's party from the Unaffiliated pool and poaches
 * rivals (the unified action — there is no separate Contest).
 */
export function PoliticalSummaryCard({
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

  const { focusPartyAbbr, narrative, partyOrg, unaffiliatedPct } = vm;
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
      `${focusPartyAbbr} ranks #${narrative.rank} of ${narrative.totalParties} — ` +
      `gap to leader ${narrative.gapToTop.toFixed(1)} pts.`
    );
  })();

  // Pool legend rows: every party with a non-zero Org slice + the
  // unaffiliated remainder. Same format as the Registration Pool legend
  // so the two cards read as a matched pair.
  const orgRows = [
    ...partyOrg
      .filter((p) => p.orgPct > 0)
      .map((p) => ({ key: p.id, label: p.abbr, color: p.color, value: p.orgPct })),
  ];
  if (unaffiliatedPct > 0) {
    orgRows.push({
      key: "unaffiliated",
      label: "Unaffiliated",
      color: UNAFFILIATED_COLOR,
      value: unaffiliatedPct,
    });
  }

  const buildOrgUrl = viewerPartyId
    ? `/api/country/${vm.countryId.toLowerCase()}/region/${vm.stateId.toUpperCase()}/party/${encodeURIComponent(viewerPartyId)}/build-org`
    : null;

  // Pre-click projection for the compact estimate line. `bumpKey` bumps after
  // each spend so the next-click estimate refreshes (alongside router.refresh()
  // for the pie).
  const apiBase = viewerPartyId ? regionPartyApiUrl(vm.countryId, vm.stateId, viewerPartyId) : null;
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
        showToast(d.error ?? "Build Org failed", "error");
        return;
      }
      showToast(
        `+${(d.orgGain as number).toFixed(2)} Org for ${(d.psCost as number).toFixed(0)} PS`,
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

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Org Pool</div>
      {orgRows.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {orgRows.map((r) => (
            <li key={r.key} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: r.color }}
                aria-hidden
              />
              <span className="flex-1 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums">{r.value.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 text-xs leading-snug text-[var(--muted)]">{standingLine}</div>

      <div className="mt-3 flex flex-wrap gap-2">
        {eligibleScopes?.state || eligibleScopes?.national ? (
          <>
            {eligibleScopes?.state && (
              <button
                type="button"
                onClick={() => handleBuildOrg("state")}
                disabled={buildOrgDisabled}
                className="rounded-md border border-[var(--card-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--card)]/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                title={
                  poolPS
                    ? `Build Org from state pool (${poolPS.statePoolPS.toFixed(0)} PS)`
                    : buildOrgTitle
                }
              >
                {busy ? "Building…" : "Build Org · State PS"}
              </button>
            )}
            {eligibleScopes?.national && (
              <button
                type="button"
                onClick={() => handleBuildOrg("national")}
                disabled={buildOrgDisabled}
                className="rounded-md border border-[var(--card-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--card)]/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                title={
                  poolPS
                    ? `Build Org from national pool (${poolPS.nationalPoolPS.toFixed(0)} PS)`
                    : buildOrgTitle
                }
              >
                {busy ? "Building…" : "Build Org · Nat'l PS"}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => handleBuildOrg()}
            disabled={buildOrgDisabled}
            className="rounded-md border border-[var(--card-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--card)]/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            title={buildOrgTitle}
          >
            {busy ? "Building…" : "Build Org"}
          </button>
        )}
      </div>

      {estimate?.ok ? (
        <div className="mt-2 space-y-0.5">
          <EstimateLine
            label="Build"
            costPS={estimate.effectiveCost}
            gain={{ sign: "+", value: estimate.projectedGain, unit: "Org" }}
          />
        </div>
      ) : null}
    </div>
  );
}
