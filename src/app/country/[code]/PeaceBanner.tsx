import Link from "next/link";
import type { CountryPeaceNotice } from "@/lib/military/countryPeaceNotice";

/**
 * The strip that says a peace decision is waiting on the reader, under the wartime
 * strip on every one of this country's pages.
 *
 * STACKED under the war strip rather than replacing it, because a country can be at
 * war and holding an offer at the same time, and collapsing the two would drop
 * whichever mattered more. Sits in the country LAYOUT for the same reason the war
 * strip does: a pending settlement is a fact about the country, not about the tab
 * you happen to be reading, so it cannot be forgotten on the next surface somebody
 * adds.
 *
 * SEAT GATED, unlike the strip above it. `loadCountryPeaceNotice` returns null for
 * anyone who cannot act, so this component never renders for a reader who would only
 * be told about a decision they cannot take.
 *
 * Three colours for three meanings: a won war uses the warning tone because it is on
 * a clock, an incoming offer and an open invitation use info because neither expires
 * without warning.
 *
 * Copy rules: no em or en dashes, no calendar years, and durations in turns.
 */
export function PeaceBanner({
  notice,
  countryName,
}: {
  notice: CountryPeaceNotice;
  countryName: string;
}) {
  const { href, label, sentence, tone } = describe(notice, countryName);
  const palette =
    tone === "urgent"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-info/30 bg-info/10 text-info";

  return (
    <div className={`border-b px-4 py-2 text-center text-sm ${palette}`}>
      <span>{sentence} </span>
      <Link href={href} className="font-semibold underline underline-offset-2 hover:opacity-80">
        {label}
      </Link>
    </div>
  );
}

function describe(
  notice: CountryPeaceNotice,
  countryName: string
): { href: string; label: string; sentence: string; tone: "urgent" | "info" } {
  if (notice.kind === "window_open") {
    // Links to the war record, where the terms are chosen, rather than to the peace
    // panel: imposing is not negotiating and does not happen in the same place.
    const href =
      notice.conflictNumber !== null
        ? `/world/conflicts/${notice.conflictNumber}`
        : "/world/conflicts";
    return {
      href,
      label: "Name your terms",
      sentence:
        `${countryName} has won ${notice.warName} and may impose terms. ` +
        `This closes in ${notice.turnsLeft} ${notice.turnsLeft === 1 ? "turn" : "turns"}.`,
      tone: "urgent",
    };
  }

  if (notice.kind === "offer_incoming") {
    return {
      // Resolved server-side from WHICH seat authorized this reader: the head of
      // government and the foreign minister act on different surfaces.
      href: notice.href,
      label: "Review the terms",
      sentence:
        notice.count > 1
          ? `${notice.count} peace offers are waiting on ${countryName}.`
          : `Peace terms have been offered to ${countryName}.`,
      tone: "info",
    };
  }

  return {
    href: notice.href,
    label: "Offer terms",
    sentence: `${countryName} can open peace talks in this war.`,
    tone: "info",
  };
}
