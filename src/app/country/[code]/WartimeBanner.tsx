import Link from "next/link";
import type { CountryWarNotice } from "@/lib/military/countryAtWar";

/**
 * The strip that says this country is at war, under the navbar on every one of
 * its pages.
 *
 * Sits in the country LAYOUT rather than on the pages, so it cannot be forgotten
 * on the next surface somebody adds — a war is a fact about the country, not
 * about the tab you happen to be reading. Same shape as the admin and econ-only
 * strips already there, in the error colour rather than warning: those two are
 * notes about your access, this one is about the country itself.
 *
 * WORDING TURNS ON WHAT IS TRUE. A belligerent is at war; a country that is only
 * the ground somebody else is fighting over is not at war but is certainly not at
 * peace, and saying it "is involved in" a war would misdescribe an occupied
 * neutral. One war names itself and links to its record; several link to the
 * conflicts board, because picking one of them to feature would be arbitrary.
 */
export function WartimeBanner({ notice }: { notice: CountryWarNotice }) {
  const href =
    notice.conflictNumber !== null
      ? `/world/conflicts/${notice.conflictNumber}`
      : "/world/conflicts";

  return (
    <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-center text-sm text-error">
      <span>{sentence(notice)} </span>
      <Link href={href} className="font-semibold underline underline-offset-2 hover:opacity-80">
        {notice.conflictNumber !== null ? "See the war" : "See the conflicts"}
      </Link>
    </div>
  );
}

function sentence(notice: CountryWarNotice): string {
  if (notice.count > 1) {
    return notice.hostOnly
      ? `${notice.count} armed conflicts are being fought on this country's territory.`
      : `This country is currently involved in ${notice.count} armed conflicts.`;
  }
  // A named war reads better than the generic line, and the name is already public
  // on the conflicts board. A colon, not a dash: this is player-facing copy and the
  // project bars em and en dashes there.
  const named = notice.name ? `: ${notice.name}` : "";
  return notice.hostOnly
    ? `An armed conflict is being fought on this country's territory${named}.`
    : `This country is currently involved in an armed conflict${named}.`;
}
