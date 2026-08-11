"use client";

import { PartyLogo } from "@/components/PartyLogo";
import type { CountryId } from "@/lib/constants/countries";
import {
  ALIGNMENT_META,
  alignmentBand,
  compassDistance,
  type CompassPoint,
} from "@/lib/registration/alignment";
import { registeredPlayersLabel } from "../register/components/playerCountLabels";
import type { PartyOption } from "../register/components/registerTypes";
import { FieldCaption } from "./creatorPrimitives";

/** Badge for a party's standing in a one-party state. */
const REGIME_BADGE: Record<"ruling" | "approved" | "banned", { label: string; cls: string }> = {
  ruling: { label: "Ruling", cls: "text-success border-success/40 bg-success/10" },
  approved: { label: "Approved", cls: "text-warning border-warning/40 bg-warning/10" },
  banned: { label: "Banned", cls: "text-error border-error/40 bg-error/10" },
};

interface PartyPickerProps {
  countryId: string;
  value: string;
  onChange: (partyId: string) => void;
  majorParties: PartyOption[];
  communityParties: PartyOption[];
  /** Candidate position — drives the per-party alignment badge. */
  position: CompassPoint;
  /** In a one-party state the regime badge matters more than policy distance. */
  isOnePartyState?: boolean;
}

function partyPoint(party: PartyOption): CompassPoint | null {
  if (party.economicPosition == null || party.socialPosition == null) return null;
  return { economic: party.economicPosition, social: party.socialPosition };
}

export function PartyPicker({
  countryId,
  value,
  onChange,
  majorParties,
  communityParties,
  position,
  isOnePartyState = false,
}: PartyPickerProps) {
  const country = countryId.toUpperCase() as CountryId;

  return (
    <div>
      <FieldCaption
        hint={
          isOnePartyState
            ? "Standing under the regime"
            : "Alignment is measured against your policy pin"
        }
      >
        Party affiliation
      </FieldCaption>

      <div className="space-y-3">
        <PartyRow
          id="independent"
          name="Independent"
          color="var(--color-muted)"
          countryId={country}
          note={
            isOnePartyState
              ? "Zero vote weight here. You cannot be fielded for the legislature."
              : "No party machine. You must caucus to run for most offices."
          }
          selected={value === "independent"}
          onSelect={onChange}
        />

        <PartyGroup title="Major parties">
          {majorParties.map((p) => (
            <PartyRow
              key={p.id}
              id={p.id}
              name={p.name}
              abbreviation={p.abbreviation}
              color={p.color}
              countryId={country}
              note={registeredPlayersLabel(p.playerCount)}
              point={partyPoint(p)}
              position={position}
              regimeStatus={isOnePartyState ? (p.regimeStatus ?? null) : null}
              selected={value === p.id}
              onSelect={onChange}
            />
          ))}
        </PartyGroup>

        {communityParties.length > 0 && (
          <PartyGroup title="Community parties">
            {communityParties.map((p) => (
              <PartyRow
                key={p.id}
                id={p.id}
                name={p.name}
                abbreviation={p.abbreviation}
                color={p.color}
                countryId={country}
                note={registeredPlayersLabel(p.playerCount)}
                point={partyPoint(p)}
                position={position}
                regimeStatus={isOnePartyState ? (p.regimeStatus ?? null) : null}
                selected={value === p.id}
                onSelect={onChange}
              />
            ))}
          </PartyGroup>
        )}
      </div>

      {value === "independent" && (
        <p
          className={`mt-3 rounded border px-3 py-2 text-body-sm ${
            isOnePartyState
              ? "border-error/40 bg-error/10 text-error"
              : "border-warning/30 bg-warning/10 text-warning"
          }`}
        >
          {isOnePartyState
            ? "Running independent in a one-party state means a 0.0× vote weight — you cannot win, and you cannot be fielded for the legislature. Join the ruling party and reform it from inside."
            : "Independents cannot stand for most offices until they join a party. You can switch later."}
        </p>
      )}
    </div>
  );
}

function PartyGroup({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-body-xs uppercase tracking-[0.16em] text-muted">
          {title}
        </span>
        <span className="h-px flex-1 bg-card-border" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function PartyRow({
  id,
  name,
  abbreviation,
  color,
  countryId,
  note,
  point,
  position,
  regimeStatus,
  selected,
  onSelect,
}: {
  id: string;
  name: string;
  abbreviation?: string;
  color: string;
  countryId: CountryId;
  note: string;
  point?: CompassPoint | null;
  position?: CompassPoint;
  regimeStatus?: "ruling" | "approved" | "banned" | null;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const distance = point && position ? compassDistance(position, point) : null;
  // In a one-party state the regime badge is the decisive fact, and two badges
  // plus a logo crush the party name to nothing. Policy distance is still shown
  // for every party in the compass legend.
  const meta = distance == null || regimeStatus ? null : ALIGNMENT_META[alignmentBand(distance)];

  // w-full/min-w-0: WebKit sizes a <button> shrink-to-fit even when its display
  // is flex, so the Independent row — the one PartyRow that is a block-flow
  // child rather than a stretched grid item — grew to its own content width and
  // ran off the right of the screen on iOS.
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      className={`flex w-full min-w-0 items-center gap-2.5 rounded border px-3 py-2 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/10"
          : "border-card-border bg-card-muted hover:border-primary/40"
      }`}
    >
      <PartyLogo
        partyId={id}
        partyColor={color}
        countryId={id === "independent" ? null : countryId}
        size="h-8 w-8"
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold">
          {abbreviation && (
            <span className="font-mono text-body-sm text-muted">{abbreviation} </span>
          )}
          {name}
        </span>
        <span className="block truncate text-body-xs text-muted">{note}</span>
      </span>
      {regimeStatus && (
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-body-xs font-semibold ${REGIME_BADGE[regimeStatus].cls}`}
        >
          {REGIME_BADGE[regimeStatus].label}
        </span>
      )}
      {/* The distance goes on the badge, matching the candidate file and the
          compass legend. A bare "Close" in a bordered pill next to a player
          count reads as "closed to new members" rather than as policy
          proximity. */}
      {meta && distance != null && (
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-body-xs font-semibold ${meta.toneClass}`}
          title={`Policy distance from your position: ${distance.toFixed(1)}`}
        >
          {meta.label} {distance.toFixed(1)}
        </span>
      )}
    </button>
  );
}
