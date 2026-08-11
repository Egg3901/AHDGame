"use client";

import { useState } from "react";

import type { State } from "@/lib/db/types";
import { OfficialCard } from "./OfficialCard";
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

export function SenateSection({
  state,
  senators,
  label = "Senate",
  memberTitle = "Senator",
  isMultiSeat = false,
}: {
  state: State;
  senators: SerializedOfficial[];
  label?: string;
  memberTitle?: string;
  isMultiSeat?: boolean;
}) {
  const totalSeats = isMultiSeat ? senators.reduce((sum, s) => sum + (s.seatsHeld ?? 1), 0) : 2;
  const filledCount = isMultiSeat
    ? senators.filter((s) => s.characterId || s.nppId).length
    : senators.length;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{label}</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            {isMultiSeat ? `${filledCount} reps · ${totalSeats} seats` : "2 seats"}
          </span>
        </div>
      </div>
      {senators.length > 0 ? (
        <div
          className={`grid gap-4 sm:gap-6 ${isMultiSeat ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-2"}`}
        >
          {senators.map((senator) => {
            const seats = senator.seatsHeld ?? 1;
            const subtitle = isMultiSeat
              ? seatCountLabel(seats)
              : `Class ${senator.senateClass ?? "—"}`;
            return (
              <OfficialCard
                key={senator._id}
                official={senator}
                title={memberTitle}
                subtitle={subtitle}
                isVacant={!senator.characterId && !senator.nppId}
                countryId={state.countryId}
              />
            );
          })}
        </div>
      ) : (
        <div className="py-12 text-center text-muted">
          <p>No {label.toLowerCase()} seats initialized yet.</p>
          <p className="text-sm mt-1">Admin needs to initialize elected officials.</p>
        </div>
      )}
    </div>
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
  const [houseExpanded, setHouseExpanded] = useState(false);
  const filledReps = houseReps.filter((r) => r.characterId || r.nppId);

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{label}</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">
            {filledReps.length} rep
            {filledReps.length !== 1 ? "s" : ""} · {state.houseDistricts} seats
          </span>
        </div>
      </div>
      {filledReps.length > 0 ? (
        <>
          <div
            className={`grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 overflow-y-auto pr-1 ${!houseExpanded ? "max-h-[420px]" : ""}`}
          >
            {filledReps.map((rep) => {
              const seats = rep.seatsHeld ?? 1;
              const seatLabel = seatCountLabel(seats);
              return (
                <OfficialCard
                  key={rep._id}
                  official={rep}
                  title={memberTitle}
                  subtitle={seatLabel}
                  isVacant={false}
                  countryId={state.countryId}
                />
              );
            })}
          </div>
          {filledReps.length > 8 && (
            <button
              type="button"
              onClick={() => setHouseExpanded((v) => !v)}
              className="mt-3 text-sm text-muted hover:text-foreground transition-colors"
            >
              {houseExpanded ? "Show less" : `Show all ${filledReps.length} representatives`}
            </button>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-muted">
          <p>Vacant</p>
        </div>
      )}
    </div>
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
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{label}</h2>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          1 seat
        </span>
      </div>
      <div className="flex justify-center">
        <OfficialCard
          official={
            governor
              ? ({
                  _id: governor._id,
                  characterId: governor.characterId,
                  characterName: governor.characterName ?? undefined,
                  party: governor.party ?? undefined,
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
      </div>
    </div>
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
  const [stateSenateExpanded, setStateSenateExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{label}</h2>
        <span className="text-sm text-muted">
          {stateSenators.length} member{stateSenators.length !== 1 ? "s" : ""}
        </span>
      </div>
      {stateSenators.length > 0 ? (
        <>
          <div
            className={`grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 overflow-y-auto pr-1 ${!stateSenateExpanded ? "max-h-[420px]" : ""}`}
          >
            {stateSenators.map((senator) => {
              const seats = senator.seatsHeld ?? 1;
              const seatLabel = seatCountLabel(seats);
              return (
                <OfficialCard
                  key={senator._id}
                  official={senator}
                  title="State Senator"
                  subtitle={seatLabel}
                  isVacant={!senator.characterId && !senator.nppId}
                  countryId={state.countryId}
                />
              );
            })}
          </div>
          {stateSenators.length > 8 && (
            <button
              type="button"
              onClick={() => setStateSenateExpanded((v) => !v)}
              className="mt-3 text-sm text-muted hover:text-foreground transition-colors"
            >
              {stateSenateExpanded ? "Show less" : `Show all ${stateSenators.length} members`}
            </button>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-muted">
          <p>Vacant</p>
        </div>
      )}
    </div>
  );
}
