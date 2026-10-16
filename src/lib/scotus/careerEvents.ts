import type { CareerEvent } from "@/lib/db/types/character";

/** Career-history label for a Supreme Court seat. Judicial seats have no OfficeType. */
export function scotusSeatCareerLabel(seatNumber: number): string {
  return `Supreme Court Justice (Seat ${seatNumber})`;
}

/**
 * The career-history entry for a confirmation. An "appointed" event without an
 * office lands on the Executive tab of the profile, next to other appointments.
 */
export function buildScotusConfirmationCareerEvent(input: {
  seatNumber: number;
  party?: string;
  partyCountryId: string;
  date: Date;
}): CareerEvent {
  return {
    type: "appointed",
    officeLabel: scotusSeatCareerLabel(input.seatNumber),
    ...(input.party ? { party: input.party, partyCountryId: input.partyCountryId } : {}),
    date: input.date,
  };
}

/** True when the history already holds the confirmation for this seat. */
export function hasScotusConfirmationEvent(
  history: readonly CareerEvent[] | undefined,
  seatNumber: number
): boolean {
  const label = scotusSeatCareerLabel(seatNumber);
  return (history ?? []).some((e) => e.type === "appointed" && e.officeLabel === label);
}
