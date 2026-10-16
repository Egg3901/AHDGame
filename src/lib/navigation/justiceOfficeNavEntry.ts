/** Nav-entry shape for a seated Supreme Court justice's office link. */
export interface JusticeOfficeNavEntry {
  countryCode: string;
  seatNumber: number;
}

/** Minimal `supremeCourtSeats` row needed to build the nav entry. */
export interface JusticeSeatRow {
  countryId: string;
  seatNumber: number;
}

/** Resolve the viewer's court seat into a nav entry, or null when they hold none. */
export function resolveJusticeOfficeNavEntry(
  seat: JusticeSeatRow | null | undefined
): JusticeOfficeNavEntry | null {
  if (!seat) return null;
  return { countryCode: seat.countryId.toLowerCase(), seatNumber: seat.seatNumber };
}
