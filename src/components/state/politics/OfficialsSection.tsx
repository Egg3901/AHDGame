"use client";

import { useState } from "react";

import type { State } from "@/lib/db/types";
import { OfficialRow } from "./OfficialRow";
import type { SerializedOfficial } from "../StatePageTabsTypes";

/**
 * Subtitle for a holder in a multi-seat holding type (House, multi-seat
 * Senate, State Senate, Regional Council, …): the raw seat count they hold.
 * A single seat is "1 seat" — never "At-large", which only describes a
 * lone seat for the whole jurisdiction, not a 1-of-many holding.
 */
function seatCountLabel(seats: number): string {
  return `${seats} seat${seats === 1 ? "" : "s"}`;
}

/** Lists longer than this show the first rows and a "Show all" control. */
const COLLAPSED_ROWS = 8;

function Chamber({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-card-border bg-card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 border-b border-card-border pb-3">
        <h3 className="text-heading-sm font-semibold text-foreground">{title}</h3>
        <span className="shrink-0 text-body-sm text-muted">{meta}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyChamber({ children }: { children: React.ReactNode }) {
  return <div className="py-4 text-body text-muted">{children}</div>;
}

function CollapsibleRows({
  count,
  noun,
  children,
}: {
  count: number;
  noun: string;
  children: (limit: number) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? count : COLLAPSED_ROWS;
  return (
    <>
      <ul className="divide-y divide-card-border">{children(limit)}</ul>
      {count > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 text-body font-medium text-foreground underline decoration-card-border underline-offset-4 hover:decoration-foreground"
        >
          {expanded ? "Show fewer" : `Show all ${count} ${noun}`}
        </button>
      )}
    </>
  );
}

export function SenateSection({
  state,
  senators,
  label = "Senate",
  memberTitle = "Senator",
  isMultiSeat = false,
  isElected = true,
  configuredSeats = 2,
  description,
}: {
  state: State;
  senators: SerializedOfficial[];
  label?: string;
  memberTitle?: string;
  isMultiSeat?: boolean;
  isElected?: boolean;
  configuredSeats?: number;
  description?: string;
}) {
  const totalSeats = isMultiSeat ? senators.reduce((sum, s) => sum + (s.seatsHeld ?? 1), 0) : 2;
  const filledCount = isMultiSeat
    ? senators.filter((s) => s.characterId || s.nppId).length
    : senators.length;
  const meta = !isElected
    ? `${configuredSeats} members · unelected`
    : isMultiSeat
      ? `${filledCount} reps · ${totalSeats} seats`
      : // One region's seats: the national chamber size (configuredSeats, 100 for
        // the US Senate) is not what this region holds.
        `${senators.length > 0 ? senators.length : 2} seats`;

  return (
    <Chamber title={label} meta={meta}>
      {!isElected ? (
        <EmptyChamber>
          <p>{description ?? `${label} is an unelected national institution.`}</p>
          <p className="mt-1 text-body-sm">It does not have regional elected-official seats.</p>
        </EmptyChamber>
      ) : senators.length > 0 ? (
        <CollapsibleRows count={senators.length} noun="members">
          {(limit) =>
            senators
              .slice(0, limit)
              .map((senator) => (
                <OfficialRow
                  key={senator._id}
                  official={senator}
                  title={memberTitle}
                  subtitle={
                    isMultiSeat
                      ? seatCountLabel(senator.seatsHeld ?? 1)
                      : `Class ${senator.senateClass ?? "unknown"}`
                  }
                  isVacant={!senator.characterId && !senator.nppId}
                  countryId={state.countryId}
                />
              ))
          }
        </CollapsibleRows>
      ) : (
        <EmptyChamber>
          <p>No {label.toLowerCase()} seats initialized yet.</p>
          <p className="mt-1 text-body-sm">Admin needs to initialize elected officials.</p>
        </EmptyChamber>
      )}
    </Chamber>
  );
}

export function HouseSection({
  state,
  houseReps,
  label = "House",
  memberTitle = "Representative",
}: {
  state: State;
  houseReps: SerializedOfficial[];
  label?: string;
  memberTitle?: string;
}) {
  const filledReps = houseReps.filter((r) => r.characterId || r.nppId);

  return (
    <Chamber
      title={label}
      meta={`${filledReps.length} rep${filledReps.length !== 1 ? "s" : ""} · ${state.houseDistricts} seats`}
    >
      {filledReps.length > 0 ? (
        <CollapsibleRows count={filledReps.length} noun="representatives">
          {(limit) =>
            filledReps
              .slice(0, limit)
              .map((rep) => (
                <OfficialRow
                  key={rep._id}
                  official={rep}
                  title={memberTitle}
                  subtitle={seatCountLabel(rep.seatsHeld ?? 1)}
                  isVacant={false}
                  countryId={state.countryId}
                />
              ))
          }
        </CollapsibleRows>
      ) : (
        <EmptyChamber>Vacant</EmptyChamber>
      )}
    </Chamber>
  );
}

export function GovernorSection({
  state,
  governor,
  /**
   * Display label for the regional chief executive — "Governor" (US/JP),
   * "Minister-President" (DE), "First Minister" (UK devolved). Defaults to
   * "Governor" for legacy callers; new callers should pass the
   * country-aware label from {@link getRegionalBillAssentTitle}.
   */
  label = "Governor",
  /**
   * Office key for the official record (governor / ministerPresident / …).
   * Falls back to "governor" to preserve existing US/JP behavior.
   */
  officeType = "governor",
}: {
  state: State;
  governor: {
    _id: string;
    characterId: string | null;
    characterName: string | null;
    party: string | null;
    partyAbbreviation: string | null;
    partyColor?: string | null;
    avatarUrl: string | null;
    isNPP: boolean;
    nppId: string | null;
  } | null;
  label?: string;
  officeType?: string;
}) {
  return (
    <Chamber title={label} meta="1 seat">
      <ul>
        <OfficialRow
          official={
            governor
              ? ({
                  _id: governor._id,
                  characterId: governor.characterId,
                  characterName: governor.characterName ?? undefined,
                  party: governor.party ?? undefined,
                  partyAbbreviation: governor.partyAbbreviation ?? undefined,
                  partyColor: governor.partyColor ?? undefined,
                  avatarUrl: governor.avatarUrl ?? undefined,
                  isNPP: governor.isNPP,
                  nppId: governor.nppId,
                  officeType,
                  state: state._id,
                } as SerializedOfficial)
              : null
          }
          title={label}
          isVacant={!governor?.characterId && !governor?.nppId}
          countryId={state.countryId}
        />
      </ul>
    </Chamber>
  );
}

export function StateSenateSection({
  state,
  stateSenators,
  label = "State Senate",
}: {
  state: State;
  stateSenators: SerializedOfficial[];
  label?: string;
}) {
  return (
    <Chamber
      title={label}
      meta={`${stateSenators.length} member${stateSenators.length !== 1 ? "s" : ""}`}
    >
      {stateSenators.length > 0 ? (
        <CollapsibleRows count={stateSenators.length} noun="members">
          {(limit) =>
            stateSenators
              .slice(0, limit)
              .map((senator) => (
                <OfficialRow
                  key={senator._id}
                  official={senator}
                  title="State senator"
                  subtitle={seatCountLabel(senator.seatsHeld ?? 1)}
                  isVacant={!senator.characterId && !senator.nppId}
                  countryId={state.countryId}
                />
              ))
          }
        </CollapsibleRows>
      ) : (
        <EmptyChamber>Vacant</EmptyChamber>
      )}
    </Chamber>
  );
}
