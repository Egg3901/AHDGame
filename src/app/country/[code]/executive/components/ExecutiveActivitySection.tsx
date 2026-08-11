"use client";

import { useEffect, useState } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getExecutiveSurface, termClockBadge } from "@/lib/constants/executiveSurface";
import { getExecutiveTermLimit } from "@/lib/elections/executiveTermLimits";
import { executiveApiUrl } from "@/lib/urls";
import { fetchJson } from "@/lib/observability/fetchJson";
import { InstrumentStrip, type InstrumentTile } from "./InstrumentStrip";
import { ActsLedger, type LedgerAct } from "./ActsLedger";
import { ExecutiveRoster, type RosterRow } from "./ExecutiveRoster";

interface CabinetPositionLike {
  id: string;
  name: string;
  member: {
    characterName: string;
    sequentialId?: number | null;
    characterId: string;
    avatarUrl?: string | null;
  } | null;
  nomination?: { status?: string } | null;
}

/** "ORDER IN COUNCIL" → "Order in Council" (small words stay lowercase). */
function titleCaseActLabel(label: string): string {
  const small = new Set(["in", "of", "the"]);
  return label
    .toLowerCase()
    .split(" ")
    .map((word, index) =>
      index > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

export interface ExecutiveClockTile {
  value: string;
  subline?: string;
  progressPct?: number;
  /** Current executive term (1-based) when the hub can state it — drives the TERM n OF x badge. */
  currentTerm?: number;
}

/**
 * X instruments + acts ledger + slim roster (locked composite) — the shared,
 * self-fetching body of every executive page. Per-country naming (clock,
 * desk, chip labels, roster title) comes from getExecutiveSurface; data comes
 * from the acts route, the cabinet API, and the approval API. Every tile and
 * panel degrades independently when its source is missing.
 */
export function ExecutiveActivitySection({
  countryId,
  cabinetSource,
  clock,
  ledgerFooter,
}: {
  countryId: CountryId;
  /**
   * Which cabinet API feeds the roster — declared by the rendering hub (not
   * inferred from static config) so a runtime regime conversion keeps the
   * data source aligned with the surface that rendered it.
   */
  cabinetSource: "presidential" | "parliamentary";
  /** Clock tile content from the hub (tenure/formation info); degrades when absent. */
  clock?: ExecutiveClockTile;
  ledgerFooter?: { href: string; label: string };
}) {
  const surface = getExecutiveSurface(countryId);
  const [acts, setActs] = useState<LedgerAct[] | null>(null);
  const [deskCount, setDeskCount] = useState<number | null>(null);
  const [roster, setRoster] = useState<{ rows: RosterRow[]; filled: number; total: number } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ acts?: LedgerAct[]; deskCount?: number }>(
      `/api/country/${countryId.toLowerCase()}/executive/acts`,
      { feature: "executive-acts" }
    )
      .then((json) => {
        if (cancelled || !json) return;
        setActs(json.acts ?? []);
        setDeskCount(typeof json.deskCount === "number" ? json.deskCount : null);
      })
      .catch(() => {});
    // Presidential surfaces use the Senate-confirmation cabinet API;
    // parliamentary and one-party surfaces use the direct-appointment one.
    const cabinetUrl =
      cabinetSource === "presidential"
        ? `/api/whitehouse/cabinet?country=${countryId.toLowerCase()}`
        : `${executiveApiUrl(countryId)}/cabinet`;
    fetchJson<{ positions?: CabinetPositionLike[] }>(cabinetUrl, {
      feature: "executive-cabinet",
    })
      .then((json) => {
        if (cancelled || !Array.isArray(json?.positions)) return;
        const positions = json.positions as CabinetPositionLike[];
        setRoster({
          rows: positions.map((position) => ({
            role: position.name,
            holder: position.member
              ? {
                  name: position.member.characterName,
                  href: `/character/${position.member.sequentialId ?? position.member.characterId}`,
                  avatarUrl: position.member.avatarUrl ?? undefined,
                }
              : null,
            pending: position.nomination?.status === "active",
          })),
          filled: positions.filter((position) => position.member).length,
          total: positions.length,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [countryId, cabinetSource]);

  // Badge only when this page's executive IS the term-limited office: the
  // configured executiveTermLimit applies to the head of state (e.g. IE's
  // Uachtarán), which is the page's executive only in presidential systems.
  const surfaceTermLimit =
    COUNTRY_CONFIGS[countryId].governmentType === "presidential"
      ? (getExecutiveTermLimit(countryId) ?? undefined)
      : undefined;
  const badge = termClockBadge(surfaceTermLimit, clock?.currentTerm);
  const tiles: InstrumentTile[] = [
    // Clock tile renders only when the hub supplies real data — no dash tiles.
    ...(clock
      ? [
          {
            label: surface.clock.label,
            value: clock.value,
            badge: badge?.badge,
            progressPct: clock.progressPct,
            subline: [clock.subline ?? surface.clock.countdownNoun, badge?.subline]
              .filter(Boolean)
              .join(" · "),
          },
        ]
      : []),
    // No Mandate/approval tile — the masthead's Approval stat (with the
    // hoverable breakdown) already carries it; duplicating it here was noise.
    {
      label: surface.deskLabel,
      value:
        deskCount !== null
          ? surface.deskKind === "bills"
            ? `${deskCount} ${deskCount === 1 ? "bill" : "bills"}`
            : `${deskCount} active`
          : "—",
      valueClass: deskCount ? "text-warning" : "text-muted",
      subline:
        surface.deskKind === "bills" ? "awaiting executive action" : "national orders in force",
    },
    {
      label: surface.rosterTitle,
      value: roster ? `${roster.filled}/${roster.total}` : "—",
      subline: roster
        ? `${roster.total - roster.filled} ${roster.total - roster.filled === 1 ? "vacancy" : "vacancies"}${
            roster.rows.some((row) => row.pending) ? " · nomination pending" : ""
          }`
        : undefined,
    },
  ];

  return (
    <div className="space-y-4">
      <InstrumentStrip tiles={tiles} />
      <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_0.85fr]">
        <ActsLedger
          acts={acts ?? []}
          actLabels={surface.actLabels}
          ordersFilterLabel={titleCaseActLabel(surface.actLabels.order)}
          footer={ledgerFooter}
        />
        <ExecutiveRoster
          title={surface.rosterTitle}
          rows={(roster?.rows ?? []).slice(0, 8)}
          filled={roster?.filled}
          total={roster?.total}
          footer={{
            href: `${COUNTRY_CONFIGS[countryId].executivePath}/cabinet`,
            label: "All positions",
          }}
        />
      </div>
    </div>
  );
}
