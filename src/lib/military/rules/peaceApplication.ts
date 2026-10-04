import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { PeaceApplicationPlan, PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import { principalOf } from "../principal";
import { sideWouldEmpty } from "../peaceOffer";
import type { Side } from "../occupation";

function rosterSideOf(
  conflict: Pick<ConflictDoc, "sideA" | "sideB">,
  country: CountryId
): Side | null {
  if ((conflict.sideA.countries as string[]).includes(country)) return "A";
  if ((conflict.sideB.countries as string[]).includes(country)) return "B";
  return null;
}

function opposingRosterOf(
  conflict: Pick<ConflictDoc, "sideA" | "sideB">,
  ally: CountryId,
  principal: CountryId
): CountryId[] {
  const onA = conflict.sideA.countries.includes(ally);
  const enemies = onA ? conflict.sideB.countries : conflict.sideA.countries;
  return enemies.filter((country) => country !== principal && country !== ally);
}

/** Freeze every consequence that depends on the pre-settlement rosters. */
export function buildPeaceApplicationPlan(
  offer: Pick<PeaceOfferDoc, "fromCountry" | "toCountry" | "leaver" | "term">,
  conflict: Pick<ConflictDoc, "sideA" | "sideB" | "treatyEntries" | "joinTurns">,
  acceptedTurn: number,
  acceptedBy: string
): PeaceApplicationPlan {
  const leaver = offer.leaver;
  const other = leaver === offer.fromCountry ? offer.toCountry : offer.fromCountry;
  const rosters = [...conflict.sideA.countries, ...conflict.sideB.countries] as CountryId[];
  const released = Array.from(
    new Set(
      (conflict.treatyEntries ?? [])
        .filter((entry) => entry.defending === leaver)
        .map((entry) => entry.countryId)
        .filter((country) => rosters.includes(country))
    )
  );
  const leaving = [leaver, ...released];
  const leavers = leaving.flatMap((country) => {
    const side = rosterSideOf(conflict, country);
    return side ? [{ countryId: country, side }] : [];
  });

  const trucePairs = [
    { first: leaver, second: other },
    ...released.flatMap((ally) =>
      opposingRosterOf(conflict, ally, leaver).map((enemy) => ({
        first: ally,
        second: enemy,
      }))
    ),
  ];

  const emptied = sideWouldEmpty(conflict as ConflictDoc, leaving);
  const leaverSide = rosterSideOf(conflict, leaver);
  const bothPrincipals =
    leaverSide !== null &&
    principalOf(conflict as ConflictDoc, leaverSide) === leaver &&
    principalOf(conflict as ConflictDoc, leaverSide === "A" ? "B" : "A") === other;
  const losingSide = emptied ?? leaverSide;
  const resolutionWinner =
    losingSide !== null && (emptied !== null || bothPrincipals)
      ? offer.term.kind === "white_peace"
        ? "stalemate"
        : losingSide === "A"
          ? "B"
          : "A"
      : null;

  return {
    phase: "claimed",
    acceptedBy,
    acceptedTurn,
    leavers,
    trucePairs,
    resolutionWinner,
    attackerNation: conflict.sideA.countries[0],
    defenderNation: conflict.sideB.countries[0],
  };
}
