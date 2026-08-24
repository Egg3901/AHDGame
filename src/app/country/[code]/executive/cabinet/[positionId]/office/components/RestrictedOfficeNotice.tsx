"use client";

/**
 * What stands in for a cabinet office's body when the viewer may not read it.
 *
 * The office letterhead still renders above this: the seat, its department and
 * its holder are roster facts published elsewhere. Everything the department
 * actually knows stops here, and the server never sent it in the first place,
 * so this notice describes a payload that is genuinely absent rather than
 * hiding one that arrived.
 */
export function RestrictedOfficeNotice({
  seatName,
  allowedTitles,
  countryName,
}: {
  seatName: string;
  /** Bare office titles, head of government first. Empty renders the short form. */
  allowedTitles: string[];
  countryName: string;
}) {
  // "Taoiseach and Uachtarán of Ireland" reads better than repeating the country
  // once per title, so the titles join first and the country is appended once.
  const holders =
    allowedTitles.length > 0
      ? `${allowedTitles.join(" and ")}${countryName ? ` of ${countryName}` : ""}`
      : null;

  const explanation = holders
    ? `Only the seated ${seatName}, along with the ${holders}, may view this office.`
    : `Only the seated ${seatName} may view this office.`;

  return (
    <div className="rounded-xl border border-card-border bg-card p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] text-gov-soft">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 5a3 3 0 1 1 6 0v3H9V7z" />
        </svg>
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">Office records restricted</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{explanation}</p>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted">
        Departmental figures, standing orders and programme detail are not published outside the
        office.
      </p>
    </div>
  );
}
